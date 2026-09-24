"""Private files linked from announcement Markdown and its version snapshots."""

import json
import re
import uuid
from typing import Any

from app.core.database import get_connection
from app.domain.workflow_runtime import node_by_key
from app.repositories.flow_roster import assert_student_roster_access
from app.services.security import utc_now_iso


ANNOUNCEMENT_FILE_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
ANNOUNCEMENT_FILE_LIMIT_BYTES = 50 * 1024 * 1024
ANNOUNCEMENT_FILE_LIMIT_COUNT = 10
_ASSET_TARGET = re.compile(r"asset://[A-Za-z0-9-]+")
_IMAGE_LINK = re.compile(r"!\[[^\]]*\]\(([^)\s]+)\)")
_FILE_LINK = re.compile(r"(?<!!)\[[^\]]*\]\((asset://[^)\s]+)\)")


class AnnouncementFileError(ValueError):
    pass


def referenced_announcement_file_ids(node: dict[str, Any]) -> set[str]:
    if node.get("kind") != "announcement":
        return set()
    markdown = str(node.get("requirement") or "")
    file_links = _FILE_LINK.findall(markdown)
    if any(_ASSET_TARGET.fullmatch(target) is None for target in file_links):
        raise AnnouncementFileError("公告附件引用格式无效")
    remaining = _IMAGE_LINK.sub("", markdown)
    remaining = _FILE_LINK.sub("", remaining)
    if "asset://" in remaining:
        raise AnnouncementFileError("公告包含无法识别的资源引用")
    references = {target.removeprefix("asset://") for target in file_links}
    if len(references) > ANNOUNCEMENT_FILE_LIMIT_COUNT:
        raise AnnouncementFileError("每个公告最多引用 10 份附件")
    return references


def validate_announcement_files(
    connection: Any, flow_id: str, config: dict[str, Any]
) -> dict[str, set[str]]:
    result: dict[str, set[str]] = {}
    for node in config.get("nodes", []):
        references = referenced_announcement_file_ids(node)
        if not references:
            continue
        placeholders = ",".join("?" for _ in references)
        rows = connection.execute(
            f"""
            SELECT id FROM flow_announcement_files
            WHERE flow_id = ? AND node_key = ? AND id IN ({placeholders})
            """,
            (flow_id, node["id"], *sorted(references)),
        ).fetchall()
        if {str(row["id"]) for row in rows} != references:
            raise AnnouncementFileError("公告包含不存在或不属于当前节点的附件")
        result[str(node["id"])] = references
    return result


def freeze_announcement_file_refs(
    connection: Any, flow_id: str, version_id: str, config: dict[str, Any]
) -> None:
    for node_key, asset_ids in validate_announcement_files(connection, flow_id, config).items():
        for asset_id in sorted(asset_ids):
            connection.execute(
                """
                INSERT INTO flow_version_announcement_files
                    (flow_version_id, node_key, announcement_file_id)
                VALUES (?, ?, ?)
                """,
                (version_id, node_key, asset_id),
            )


def get_editable_announcement_node(flow_id: str, node_key: str, teacher_id: int) -> None:
    with get_connection() as connection:
        flow = connection.execute(
            """
            SELECT draft_config FROM flows
            WHERE id = ? AND owner_id = ? AND status != 'archived'
            """,
            (flow_id, str(teacher_id)),
        ).fetchone()
        if flow is None:
            raise KeyError(flow_id)
        node = node_by_key(json.loads(flow["draft_config"]), node_key)
        if node.get("kind") != "announcement":
            raise AnnouncementFileError("当前节点不支持公告附件")


def create_announcement_file(
    *, flow_id: str, node_key: str, teacher_id: int, storage_key: str,
    original_name: str, content_type: str, size_bytes: int, sha256: str, etag: str,
) -> dict[str, object]:
    if content_type not in ANNOUNCEMENT_FILE_TYPES.values():
        raise AnnouncementFileError("附件仅支持 PDF、DOCX、XLSX 和 PPTX")
    if not 0 < size_bytes <= ANNOUNCEMENT_FILE_LIMIT_BYTES:
        raise AnnouncementFileError("附件大小不能超过 50 MB")
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        flow = connection.execute(
            """
            SELECT draft_config FROM flows
            WHERE id = ? AND owner_id = ? AND status != 'archived'
            """,
            (flow_id, str(teacher_id)),
        ).fetchone()
        if flow is None:
            raise KeyError(flow_id)
        node = node_by_key(json.loads(flow["draft_config"]), node_key)
        if node.get("kind") != "announcement":
            raise AnnouncementFileError("当前节点不支持公告附件")
        asset_id = str(uuid.uuid4())
        connection.execute(
            """
            INSERT INTO flow_announcement_files
                (id, flow_id, node_key, storage_key, original_name, content_type,
                 size_bytes, sha256, etag, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (asset_id, flow_id, node_key, storage_key, original_name, content_type,
             size_bytes, sha256, etag, teacher_id, utc_now_iso()),
        )
    return {
        "assetId": asset_id, "originalName": original_name,
        "contentType": content_type, "sizeBytes": size_bytes, "sha256": sha256,
    }


def get_teacher_announcement_file(
    flow_id: str, node_key: str, asset_id: str, teacher_id: int
) -> dict[str, object]:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT a.id, a.storage_key, a.original_name, a.content_type, a.size_bytes
            FROM flow_announcement_files a
            JOIN flows f ON f.id = a.flow_id
            WHERE a.flow_id = ? AND a.node_key = ? AND a.id = ?
              AND f.owner_id = ? AND f.status != 'archived'
            """,
            (flow_id, node_key, asset_id, str(teacher_id)),
        ).fetchone()
        if row is None:
            raise KeyError(asset_id)
        return dict(row)


def get_student_announcement_file(
    instance_id: str, node_key: str, asset_id: str, student_id: int
) -> dict[str, object]:
    with get_connection() as connection:
        instance = connection.execute(
            """
            SELECT i.flow_version_id, v.flow_id
            FROM flow_instances i
            JOIN flow_versions v ON v.id = i.flow_version_id
            WHERE i.id = ? AND i.student_account_id = ?
              AND v.status IN ('published', 'preview')
            """,
            (instance_id, student_id),
        ).fetchone()
        if instance is None:
            raise KeyError(asset_id)
        assert_student_roster_access(connection, str(instance["flow_id"]), student_id)
        row = connection.execute(
            """
            SELECT a.id, a.storage_key, a.original_name, a.content_type, a.size_bytes
            FROM flow_version_announcement_files va
            JOIN flow_announcement_files a
              ON a.id = va.announcement_file_id
             AND a.flow_id = ? AND a.node_key = va.node_key
            WHERE va.flow_version_id = ? AND va.node_key = ?
              AND va.announcement_file_id = ?
            """,
            (instance["flow_id"], instance["flow_version_id"], node_key, asset_id),
        ).fetchone()
        if row is None:
            raise KeyError(asset_id)
        return dict(row)
