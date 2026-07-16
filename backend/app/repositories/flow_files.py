import json
import uuid
from dataclasses import dataclass
from typing import Any

from app.core.database import get_connection
from app.domain.workflow_runtime import deadline_has_passed
from app.repositories.flow_roster import assert_student_roster_access
from app.services.security import utc_now_iso


class FileContextError(ValueError):
    pass


@dataclass(frozen=True)
class FileUploadContext:
    node_instance_id: str
    flow_instance_id: str
    flow_version_id: str
    flow_id: str
    node_key: str
    status: str
    config_node: dict[str, Any]


def get_upload_context(node_instance_id: str, student_id: int) -> FileUploadContext:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT n.id, n.status, n.flow_instance_id, n.node_key,
                   i.flow_version_id, i.student_account_id,
                   v.flow_id, v.config_snapshot
            FROM node_instances n
            JOIN flow_instances i ON i.id = n.flow_instance_id
            JOIN flow_versions v ON v.id = i.flow_version_id
            WHERE n.id = ? AND i.student_account_id = ? AND v.status = 'published'
            """,
            (node_instance_id, student_id),
        ).fetchone()
        if row is None:
            raise KeyError(node_instance_id)
        assert_student_roster_access(connection, row["flow_id"], student_id)
        config = json.loads(row["config_snapshot"])
        config_node = next(node for node in config["nodes"] if node["id"] == row["node_key"])
        if config_node.get("kind") != "file":
            raise FileContextError("当前节点不是文件上传节点")
        if row["status"] not in {"available", "draft", "rejected"}:
            raise FileContextError("当前节点不可上传文件")
        deadline = _effective_deadline(connection, row["flow_instance_id"], row["node_key"])
        if deadline_has_passed(deadline):
            raise FileContextError("节点已超过截止时间")
    return FileUploadContext(
        node_instance_id=row["id"],
        flow_instance_id=row["flow_instance_id"],
        flow_version_id=row["flow_version_id"],
        flow_id=row["flow_id"],
        node_key=row["node_key"],
        status=row["status"],
        config_node=config_node,
    )


def replace_uploaded_file(
    node_instance_id: str,
    student_id: int,
    storage_key: str,
    original_name: str,
    content_type: str,
    size_bytes: int,
    sha256: str,
    etag: str,
) -> tuple[dict[str, object], list[str]]:
    file_id = str(uuid.uuid4())
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        old_rows = connection.execute(
            """
            SELECT storage_key FROM uploaded_files
            WHERE node_instance_id = ? AND student_account_id = ? AND submission_id IS NULL
            """,
            (node_instance_id, student_id),
        ).fetchall()
        connection.execute(
            """
            DELETE FROM uploaded_files
            WHERE node_instance_id = ? AND student_account_id = ? AND submission_id IS NULL
            """,
            (node_instance_id, student_id),
        )
        connection.execute(
            """
            INSERT INTO uploaded_files
                (id, node_instance_id, student_account_id, storage_key,
                 original_name, content_type, size_bytes, sha256, etag, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                file_id,
                node_instance_id,
                student_id,
                storage_key,
                original_name,
                content_type,
                size_bytes,
                sha256,
                etag,
                now,
            ),
        )
    return (
        {
            "fileId": file_id,
            "originalName": original_name,
            "contentType": content_type,
            "sizeBytes": size_bytes,
            "sha256": sha256,
            "storageKey": storage_key,
        },
        [row["storage_key"] for row in old_rows],
    )


def get_uploaded_file_for_node(
    connection, file_id: str, node_instance_id: str, student_id: int
) -> dict[str, object] | None:
    row = connection.execute(
        """
        SELECT id, node_instance_id, student_account_id, submission_id,
               storage_key, original_name, content_type, size_bytes, sha256, etag
        FROM uploaded_files
        WHERE id = ? AND node_instance_id = ? AND student_account_id = ?
          AND submission_id IS NULL
        """,
        (file_id, node_instance_id, student_id),
    ).fetchone()
    if row is None:
        return None
    return dict(row)


def attach_uploaded_file(connection, file_id: str, submission_id: str) -> None:
    updated = connection.execute(
        """
        UPDATE uploaded_files SET submission_id = ?
        WHERE id = ? AND submission_id IS NULL
        """,
        (submission_id, file_id),
    ).rowcount
    if updated != 1:
        raise FileContextError("文件已提交或不存在")


def get_uploaded_file_for_download(file_id: str, student_id: int) -> dict[str, object]:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT u.*, v.flow_id
            FROM uploaded_files u
            JOIN node_instances n ON n.id = u.node_instance_id
            JOIN flow_instances i ON i.id = n.flow_instance_id
            JOIN flow_versions v ON v.id = i.flow_version_id
            WHERE u.id = ? AND u.student_account_id = ?
            """,
            (file_id, student_id),
        ).fetchone()
        if row is None:
            raise KeyError(file_id)
        assert_student_roster_access(connection, row["flow_id"], student_id)
    return dict(row)


def _effective_deadline(connection, instance_id: str, node_key: str) -> str | None:
    override = connection.execute(
        """
        SELECT deadline_at FROM student_deadline_overrides
        WHERE flow_instance_id = ? AND node_key = ?
        """,
        (instance_id, node_key),
    ).fetchone()
    if override is not None:
        return override["deadline_at"]
    runtime = connection.execute(
        """
        SELECT r.deadline_at FROM flow_node_runtime_configs r
        JOIN flow_instances i ON i.flow_version_id = r.flow_version_id
        WHERE i.id = ? AND r.node_key = ?
        """,
        (instance_id, node_key),
    ).fetchone()
    return runtime["deadline_at"] if runtime else None
