import re
import uuid
from typing import Any

from app.core.database import get_connection
from app.domain.workflow_runtime import node_by_key
from app.repositories.flow_roster import assert_student_roster_access
from app.services.security import utc_now_iso


CONTENT_ASSET_TYPES = {"image/jpeg", "image/png", "image/webp"}
CONTENT_ASSET_LIMIT_BYTES = 5 * 1024 * 1024
_ASSET_REFERENCE = re.compile(r"asset://([A-Za-z0-9-]+)")


class ContentAssetError(ValueError):
    pass


def get_editable_content_node(
    flow_id: str, node_key: str, teacher_id: int
) -> dict[str, Any]:
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
        import json

        node = node_by_key(json.loads(flow["draft_config"]), node_key)
        if node.get("kind") != "answer_sheet":
            raise ContentAssetError("当前节点不支持题图")
        historical = connection.execute(
            """
            SELECT config_snapshot FROM flow_versions
            WHERE flow_id = ? AND status = 'published'
            """,
            (flow_id,),
        ).fetchall()
        for version in historical:
            if any(
                item.get("id") == node_key
                for item in json.loads(version["config_snapshot"]).get("nodes", [])
            ):
                raise ContentAssetError("已发布答题卡节点不可新增或替换题图")
        return dict(node)


def referenced_content_asset_ids(node: dict[str, Any]) -> set[str]:
    if node.get("kind") != "answer_sheet":
        return set()
    references: set[str] = set()
    for question in node.get("answerSheet", {}).get("questions", []):
        if not isinstance(question, dict):
            continue
        references.update(_ASSET_REFERENCE.findall(str(question.get("content") or "")))
        for option in question.get("options", []):
            if isinstance(option, dict):
                references.update(
                    _ASSET_REFERENCE.findall(str(option.get("content") or ""))
                )
    return references


def validate_content_assets(
    connection: Any, flow_id: str, config: dict[str, Any]
) -> dict[str, set[str]]:
    result: dict[str, set[str]] = {}
    for node in config.get("nodes", []):
        references = referenced_content_asset_ids(node)
        if not references:
            continue
        placeholders = ",".join("?" for _ in references)
        rows = connection.execute(
            f"""
            SELECT id FROM flow_content_assets
            WHERE flow_id = ? AND node_key = ? AND id IN ({placeholders})
            """,
            (flow_id, node["id"], *sorted(references)),
        ).fetchall()
        if {str(row["id"]) for row in rows} != references:
            raise ContentAssetError("答题卡包含不存在或不属于当前节点的图片")
        result[str(node["id"])] = references
    return result


def freeze_content_asset_refs(
    connection: Any,
    flow_id: str,
    flow_version_id: str,
    config: dict[str, Any],
) -> None:
    references = validate_content_assets(connection, flow_id, config)
    for node_key, asset_ids in references.items():
        for asset_id in sorted(asset_ids):
            connection.execute(
                """
                INSERT INTO flow_version_content_assets
                    (flow_version_id, node_key, content_asset_id)
                VALUES (?, ?, ?)
                """,
                (flow_version_id, node_key, asset_id),
            )


def save_content_asset(
    connection: Any,
    *,
    flow_id: str,
    node_key: str,
    teacher_id: int,
    storage_key: str,
    original_name: str,
    content_type: str,
    size_bytes: int,
    sha256: str,
    etag: str,
) -> dict[str, object]:
    if content_type not in CONTENT_ASSET_TYPES:
        raise ContentAssetError("题图仅支持 PNG、JPEG 和 WebP")
    if not 0 < size_bytes <= CONTENT_ASSET_LIMIT_BYTES:
        raise ContentAssetError("题图大小不能超过 5 MB")
    flow = connection.execute(
        """
        SELECT draft_config FROM flows
        WHERE id = ? AND owner_id = ? AND status != 'archived'
        """,
        (flow_id, str(teacher_id)),
    ).fetchone()
    if flow is None:
        raise KeyError(flow_id)
    import json

    node = node_by_key(json.loads(flow["draft_config"]), node_key)
    if node.get("kind") != "answer_sheet":
        raise ContentAssetError("当前节点不支持题图")
    version_rows = connection.execute(
        """
        SELECT config_snapshot FROM flow_versions
        WHERE flow_id = ? AND status = 'published'
        """,
        (flow_id,),
    ).fetchall()
    published_node_ids = {
        str(published_node["id"])
        for version in version_rows
        for published_node in json.loads(version["config_snapshot"]).get("nodes", [])
    }
    if node_key in published_node_ids:
        raise ContentAssetError("已发布答题卡节点不可新增或替换题图")
    asset_id = str(uuid.uuid4())
    now = utc_now_iso()
    connection.execute(
        """
        INSERT INTO flow_content_assets
            (id, flow_id, node_key, storage_key, original_name, content_type,
             size_bytes, sha256, etag, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            asset_id,
            flow_id,
            node_key,
            storage_key,
            original_name,
            content_type,
            size_bytes,
            sha256,
            etag,
            teacher_id,
            now,
        ),
    )
    return {
        "assetId": asset_id,
        "originalName": original_name,
        "contentType": content_type,
        "sizeBytes": size_bytes,
        "sha256": sha256,
    }


def create_content_asset(**values: Any) -> dict[str, object]:
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        return save_content_asset(connection, **values)


def remove_content_asset(
    connection: Any, flow_id: str, asset_id: str, teacher_id: int
) -> dict[str, str]:
    row = connection.execute(
        """
        SELECT a.storage_key FROM flow_content_assets a
        JOIN flows f ON f.id = a.flow_id
        WHERE a.id = ? AND a.flow_id = ? AND f.owner_id = ? AND f.status != 'archived'
        """,
        (asset_id, flow_id, str(teacher_id)),
    ).fetchone()
    if row is None:
        raise KeyError(asset_id)
    referenced = connection.execute(
        "SELECT 1 FROM flow_version_content_assets WHERE content_asset_id = ?",
        (asset_id,),
    ).fetchone()
    if referenced is not None:
        raise ContentAssetError("已发布版本引用的题图不可删除")
    connection.execute("DELETE FROM flow_content_assets WHERE id = ?", (asset_id,))
    return {"storageKey": str(row["storage_key"])}


def delete_content_asset(
    flow_id: str, asset_id: str, teacher_id: int
) -> dict[str, str]:
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        return remove_content_asset(connection, flow_id, asset_id, teacher_id)


def get_version_content_asset(
    connection: Any, flow_version_id: str, node_key: str, asset_id: str
) -> dict[str, object]:
    row = connection.execute(
        """
        SELECT a.id, a.storage_key, a.original_name, a.content_type, a.size_bytes
        FROM flow_version_content_assets va
        JOIN flow_content_assets a ON a.id = va.content_asset_id
        WHERE va.flow_version_id = ? AND va.node_key = ? AND va.content_asset_id = ?
        """,
        (flow_version_id, node_key, asset_id),
    ).fetchone()
    if row is None:
        raise KeyError(asset_id)
    return dict(row)


def get_student_content_asset(
    instance_id: str, asset_id: str, student_id: int
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
            FROM flow_version_content_assets va
            JOIN flow_content_assets a ON a.id = va.content_asset_id
            WHERE va.flow_version_id = ? AND va.content_asset_id = ?
            """,
            (instance["flow_version_id"], asset_id),
        ).fetchone()
        if row is None:
            raise KeyError(asset_id)
        return dict(row)


def get_teacher_content_asset(
    flow_id: str, asset_id: str, teacher_id: int
) -> dict[str, object]:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT a.id, a.storage_key, a.original_name, a.content_type, a.size_bytes
            FROM flow_content_assets a
            JOIN flows f ON f.id = a.flow_id
            WHERE a.flow_id = ? AND a.id = ? AND f.owner_id = ?
              AND f.status != 'archived'
            """,
            (flow_id, asset_id, str(teacher_id)),
        ).fetchone()
        if row is None:
            raise KeyError(asset_id)
        return dict(row)
