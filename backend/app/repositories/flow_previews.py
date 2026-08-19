import hashlib
import json
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.database import get_connection
from app.domain.workflow_runtime import incoming_nodes
from app.repositories.audit_policies import sync_preview_audit_policies
from app.repositories.flow_instances import get_instance
from app.repositories.workflows import canonical_json, prepare_runtime_config
from app.services.security import hash_password, utc_now_iso


class PreviewConflictError(ValueError):
    pass


class PreviewSessionError(PermissionError):
    pass


def list_expired_preview_teacher_ids() -> list[int]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT teacher_account_id FROM flow_preview_sessions
            WHERE expires_at <= ?
            """,
            (utc_now_iso(),),
        ).fetchall()
    return [int(row["teacher_account_id"]) for row in rows]


def mark_preview_for_cleanup(teacher_id: int) -> list[str]:
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        session = connection.execute(
            """
            SELECT flow_instance_id FROM flow_preview_sessions
            WHERE teacher_account_id = ?
            """,
            (teacher_id,),
        ).fetchone()
        if session is None:
            return []
        connection.execute(
            """
            UPDATE flow_preview_sessions SET status = 'cleaning'
            WHERE teacher_account_id = ?
            """,
            (teacher_id,),
        )
        rows = connection.execute(
            """
            SELECT u.storage_key
            FROM uploaded_files u
            JOIN node_instances n ON n.id = u.node_instance_id
            WHERE n.flow_instance_id = ?
            ORDER BY u.created_at, u.id
            """,
            (session["flow_instance_id"],),
        ).fetchall()
    return [str(row["storage_key"]) for row in rows]


def delete_marked_preview(teacher_id: int) -> None:
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        session = connection.execute(
            """
            SELECT p.flow_version_id, p.flow_instance_id
            FROM flow_preview_sessions p
            JOIN flow_versions v ON v.id = p.flow_version_id
            JOIN student_accounts a ON a.id = p.preview_student_account_id
            WHERE p.teacher_account_id = ? AND p.status = 'cleaning'
              AND v.status = 'preview' AND a.account_kind = 'preview'
              AND a.preview_owner_teacher_id = p.teacher_account_id
            """,
            (teacher_id,),
        ).fetchone()
        if session is None:
            return
        connection.execute(
            "DELETE FROM flow_preview_sessions WHERE teacher_account_id = ?",
            (teacher_id,),
        )
        connection.execute(
            "DELETE FROM flow_instances WHERE id = ?",
            (session["flow_instance_id"],),
        )
        connection.execute(
            """
            DELETE FROM flow_versions
            WHERE id = ? AND status = 'preview'
            """,
            (session["flow_version_id"],),
        )


def _preview_student(connection: Any, teacher_id: int, now: str) -> Any:
    row = connection.execute(
        """
        SELECT id, student_no, name FROM student_accounts
        WHERE account_kind = 'preview' AND preview_owner_teacher_id = ?
        """,
        (teacher_id,),
    ).fetchone()
    if row is not None:
        return row
    student_no = f"preview-student-{teacher_id}"
    cursor = connection.execute(
        """
        INSERT INTO student_accounts
            (student_no, name, password_hash, status, account_kind,
             preview_owner_teacher_id, created_at, updated_at)
        VALUES (?, '学生预览测试', ?, 'active', 'preview', ?, ?, ?)
        """,
        (
            student_no,
            hash_password(secrets.token_urlsafe(32)),
            teacher_id,
            now,
            now,
        ),
    )
    return connection.execute(
        "SELECT id, student_no, name FROM student_accounts WHERE id = ?",
        (cursor.lastrowid,),
    ).fetchone()


def create_preview(flow_id: str, teacher_id: int) -> tuple[dict[str, object], str]:
    now = utc_now_iso()
    expires_at = (datetime.now(UTC) + timedelta(hours=24)).isoformat()
    version_id = str(uuid.uuid4())
    instance_id = str(uuid.uuid4())
    session_id = str(uuid.uuid4())
    raw_token = secrets.token_urlsafe(32)
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        existing = connection.execute(
            "SELECT 1 FROM flow_preview_sessions WHERE teacher_account_id = ?",
            (teacher_id,),
        ).fetchone()
        if existing is not None:
            raise PreviewConflictError("旧预览尚未完成清理，请重试")
        flow = connection.execute(
            """
            SELECT id, draft_config FROM flows
            WHERE id = ? AND owner_id = ? AND status != 'archived'
            """,
            (flow_id, str(teacher_id)),
        ).fetchone()
        if flow is None:
            raise KeyError(flow_id)
        config = json.loads(flow["draft_config"])
        version_templates = prepare_runtime_config(connection, flow_id, config)
        sync_preview_audit_policies(connection, flow_id, config, teacher_id, now)
        snapshot = canonical_json(config)
        config_hash = hashlib.sha256(snapshot.encode("utf-8")).hexdigest()
        preview_student = _preview_student(connection, teacher_id, now)
        connection.execute(
            """
            INSERT INTO flow_versions
                (id, flow_id, version_no, config_snapshot, config_hash,
                 status, published_by, published_at)
            VALUES (?, ?, 0, ?, ?, 'preview', ?, ?)
            """,
            (version_id, flow_id, snapshot, config_hash, str(teacher_id), now),
        )
        for node_key, asset_id in version_templates.items():
            connection.execute(
                """
                INSERT INTO flow_version_templates
                    (flow_version_id, node_key, template_asset_id)
                VALUES (?, ?, ?)
                """,
                (version_id, node_key, asset_id),
            )
        connection.execute(
            """
            INSERT INTO flow_instances
                (id, flow_version_id, student_account_id, started_at, last_active_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (instance_id, version_id, preview_student["id"], now, now),
        )
        incoming = incoming_nodes(config)
        for node in config["nodes"]:
            status = "available" if not incoming[node["id"]] else "locked"
            connection.execute(
                """
                INSERT INTO node_instances
                    (id, flow_instance_id, node_key, status, opened_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    instance_id,
                    node["id"],
                    status,
                    now if status == "available" else None,
                ),
            )
        connection.execute(
            """
            INSERT INTO flow_preview_sessions
                (id, teacher_account_id, preview_student_account_id, flow_id,
                 flow_version_id, flow_instance_id, token_hash, status,
                 expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
            """,
            (
                session_id,
                teacher_id,
                preview_student["id"],
                flow_id,
                version_id,
                instance_id,
                hashlib.sha256(raw_token.encode("utf-8")).hexdigest(),
                expires_at,
                now,
            ),
        )
    return get_instance(instance_id, int(preview_student["id"])), raw_token


def resolve_preview_actor(raw_token: str, teacher_id: int) -> dict[str, object]:
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT a.id, a.student_no, a.name, p.flow_instance_id
            FROM flow_preview_sessions p
            JOIN student_accounts a ON a.id = p.preview_student_account_id
            JOIN flows f ON f.id = p.flow_id
            WHERE p.token_hash = ? AND p.teacher_account_id = ?
              AND p.status = 'active' AND p.expires_at > ?
              AND a.account_kind = 'preview'
              AND a.preview_owner_teacher_id = p.teacher_account_id
              AND f.owner_id = CAST(p.teacher_account_id AS TEXT)
            """,
            (token_hash, teacher_id, utc_now_iso()),
        ).fetchone()
    if row is None:
        raise PreviewSessionError("预览会话已失效，请返回教师页面重新预览")
    return {
        "id": row["id"],
        "studentNo": row["student_no"],
        "name": row["name"],
        "preview": True,
        "previewInstanceId": row["flow_instance_id"],
    }


def preview_session_is_active(connection: Any, flow_instance_id: str) -> bool:
    row = connection.execute(
        """
        SELECT 1 FROM flow_preview_sessions
        WHERE flow_instance_id = ? AND status = 'active' AND expires_at > ?
        """,
        (flow_instance_id, utc_now_iso()),
    ).fetchone()
    return row is not None
