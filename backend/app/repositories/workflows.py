import hashlib
import json
import secrets
import uuid
from typing import Any

from app.core.database import get_connection
from app.domain.workflow import validate_flow_config
from app.services.security import utc_now_iso


class ArchivedFlowError(ValueError):
    pass


class DuplicateFlowNameError(ValueError):
    pass


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def create_flow(name: str, description: str) -> dict[str, object]:
    flow_id = str(uuid.uuid4())
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        existing = connection.execute(
            "SELECT 1 FROM flows WHERE name = ? AND status != 'archived' LIMIT 1", (name,)
        ).fetchone()
        if existing is not None:
            raise DuplicateFlowNameError("已存在同名流程")
        connection.execute(
            """
            INSERT INTO flows (id, name, description, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (flow_id, name, description, now, now),
        )
    return get_flow(flow_id)


def get_flow(flow_id: str) -> dict[str, object]:
    with get_connection() as connection:
        row = connection.execute("SELECT * FROM flows WHERE id = ?", (flow_id,)).fetchone()
    if row is None:
        raise KeyError(flow_id)
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "status": row["status"],
        "config": json.loads(row["draft_config"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def list_flows() -> list[dict[str, object]]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT id FROM flows WHERE status != 'archived' ORDER BY created_at DESC"
        ).fetchall()
    return [get_flow(row["id"]) for row in rows]


def save_draft(flow_id: str, config: dict[str, Any]) -> dict[str, object]:
    now = utc_now_iso()
    with get_connection() as connection:
        existing = connection.execute("SELECT status FROM flows WHERE id = ?", (flow_id,)).fetchone()
        if existing is None:
            raise KeyError(flow_id)
        if existing["status"] == "archived":
            raise ArchivedFlowError("已归档流程不可编辑")
        cursor = connection.execute(
            "UPDATE flows SET draft_config = ?, updated_at = ? WHERE id = ?",
            (canonical_json(config), now, flow_id),
        )
        if cursor.rowcount == 0:
            raise KeyError(flow_id)
    return get_flow(flow_id)


def publish_flow(flow_id: str) -> dict[str, object]:
    flow = get_flow(flow_id)
    if flow["status"] == "archived":
        raise ArchivedFlowError("已归档流程不可发布")
    config = flow["config"]
    assert isinstance(config, dict)
    validate_flow_config(config)
    snapshot = canonical_json(config)
    config_hash = hashlib.sha256(snapshot.encode("utf-8")).hexdigest()
    version_id = str(uuid.uuid4())
    share_token_id = str(uuid.uuid4())
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = utc_now_iso()

    with get_connection() as connection:
        row = connection.execute(
            "SELECT COALESCE(MAX(version_no), 0) + 1 AS next_no FROM flow_versions WHERE flow_id = ?",
            (flow_id,),
        ).fetchone()
        version_no = int(row["next_no"])
        connection.execute(
            """
            INSERT INTO flow_versions
                (id, flow_id, version_no, config_snapshot, config_hash, published_by, published_at)
            VALUES (?, ?, ?, ?, ?, 'teacher-local', ?)
            """,
            (version_id, flow_id, version_no, snapshot, config_hash, now),
        )
        for node in config["nodes"]:
            connection.execute(
                """
                INSERT INTO flow_node_runtime_configs
                    (flow_version_id, node_key, deadline_at, updated_by, updated_at)
                VALUES (?, ?, ?, 'teacher-local', ?)
                """,
                (version_id, node["id"], node.get("deadlineAt"), now),
            )
        connection.execute(
            """
            INSERT INTO share_tokens
                (id, flow_version_id, token_hash, created_by, created_at)
            VALUES (?, ?, ?, 'teacher-local', ?)
            """,
            (share_token_id, version_id, token_hash, now),
        )
        connection.execute(
            "UPDATE flows SET status = 'published', updated_at = ? WHERE id = ?",
            (now, flow_id),
        )
    return {
        "flowId": flow_id,
        "flowVersionId": version_id,
        "versionNo": version_no,
        "token": token,
        "shareUrl": f"/s/{token}",
        "configHash": config_hash,
    }


def delete_flow(flow_id: str, teacher_id: int) -> None:
    now = utc_now_iso()
    with get_connection() as connection:
        row = connection.execute(
            "SELECT name, status FROM flows WHERE id = ?", (flow_id,)
        ).fetchone()
        if row is None:
            raise KeyError(flow_id)

        version_ids = [
            version["id"]
            for version in connection.execute(
                "SELECT id FROM flow_versions WHERE flow_id = ?", (flow_id,)
            ).fetchall()
        ]
        instance_ids = [
            instance["id"]
            for instance in connection.execute(
                """
                SELECT i.id FROM flow_instances i
                JOIN flow_versions v ON v.id = i.flow_version_id
                WHERE v.flow_id = ?
                """,
                (flow_id,),
            ).fetchall()
        ]

        connection.execute(
            "DELETE FROM audit_logs WHERE entity_type = 'flow' AND entity_id = ?",
            (flow_id,),
        )
        for version_id in version_ids:
            connection.execute(
                "DELETE FROM audit_logs WHERE entity_id = ? OR entity_id LIKE ?",
                (version_id, f"{version_id}:%"),
            )
        for instance_id in instance_ids:
            connection.execute(
                "DELETE FROM audit_logs WHERE entity_id = ? OR entity_id LIKE ?",
                (instance_id, f"{instance_id}:%"),
            )

        connection.execute(
            """
            DELETE FROM submissions WHERE node_instance_id IN (
                SELECT n.id FROM node_instances n
                JOIN flow_instances i ON i.id = n.flow_instance_id
                JOIN flow_versions v ON v.id = i.flow_version_id
                WHERE v.flow_id = ?
            )
            """,
            (flow_id,),
        )
        connection.execute(
            """
            DELETE FROM node_drafts WHERE node_instance_id IN (
                SELECT n.id FROM node_instances n
                JOIN flow_instances i ON i.id = n.flow_instance_id
                JOIN flow_versions v ON v.id = i.flow_version_id
                WHERE v.flow_id = ?
            )
            """,
            (flow_id,),
        )
        connection.execute(
            """
            DELETE FROM student_deadline_overrides WHERE flow_instance_id IN (
                SELECT i.id FROM flow_instances i
                JOIN flow_versions v ON v.id = i.flow_version_id
                WHERE v.flow_id = ?
            )
            """,
            (flow_id,),
        )
        connection.execute(
            """
            DELETE FROM node_instances WHERE flow_instance_id IN (
                SELECT i.id FROM flow_instances i
                JOIN flow_versions v ON v.id = i.flow_version_id
                WHERE v.flow_id = ?
            )
            """,
            (flow_id,),
        )
        connection.execute(
            """
            DELETE FROM flow_instances WHERE flow_version_id IN (
                SELECT id FROM flow_versions WHERE flow_id = ?
            )
            """,
            (flow_id,),
        )
        connection.execute(
            """
            DELETE FROM flow_node_runtime_configs WHERE flow_version_id IN (
                SELECT id FROM flow_versions WHERE flow_id = ?
            )
            """,
            (flow_id,),
        )
        connection.execute(
            """
            DELETE FROM share_tokens WHERE flow_version_id IN (
                SELECT id FROM flow_versions WHERE flow_id = ?
            )
            """,
            (flow_id,),
        )
        connection.execute("DELETE FROM flow_versions WHERE flow_id = ?", (flow_id,))
        connection.execute("DELETE FROM flows WHERE id = ?", (flow_id,))
        connection.execute(
            """
            INSERT INTO audit_logs
                (actor_id, action, entity_type, entity_id, before_data, created_at)
            VALUES (?, 'delete', 'flow', ?, ?, ?)
            """,
            (
                str(teacher_id),
                flow_id,
                canonical_json({"name": row["name"], "status": row["status"]}),
                now,
            ),
        )


def resolve_share_token(token: str) -> dict[str, object]:
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT v.id AS version_id, v.flow_id, v.version_no, v.config_snapshot,
                   f.name, f.description
            FROM share_tokens t
            JOIN flow_versions v ON v.id = t.flow_version_id
            JOIN flows f ON f.id = v.flow_id
            WHERE t.token_hash = ? AND t.status = 'active'
              AND (t.expires_at IS NULL OR t.expires_at > ?)
              AND v.status = 'published'
            """,
            (token_hash, utc_now_iso()),
        ).fetchone()
    if row is None:
        raise KeyError(token)
    return {
        "flowId": row["flow_id"],
        "flowVersionId": row["version_id"],
        "versionNo": row["version_no"],
        "name": row["name"],
        "description": row["description"],
        "config": json.loads(row["config_snapshot"]),
    }
