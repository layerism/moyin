import hashlib
import json
import secrets
import uuid
from typing import Any

from app.core.database import get_connection
from app.domain.workflow import FlowValidationError, validate_flow_config
from app.domain.workflow_revision import (
    analyze_revision,
    assert_published_nodes_present,
)
from app.services.security import utc_now_iso


class ArchivedFlowError(ValueError):
    pass


class DuplicateFlowNameError(ValueError):
    pass


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _latest_published_version(connection: Any, flow_id: str, teacher_id: int) -> Any:
    return connection.execute(
        """
        SELECT v.id, v.version_no, v.config_snapshot, v.config_hash
        FROM flow_versions v
        JOIN flows f ON f.id = v.flow_id
        WHERE v.flow_id = ? AND f.owner_id = ? AND v.status = 'published'
        ORDER BY v.version_no DESC
        LIMIT 1
        """,
        (flow_id, str(teacher_id)),
    ).fetchone()


def _owned_flow(connection: Any, flow_id: str, teacher_id: int) -> Any:
    return connection.execute(
        "SELECT * FROM flows WHERE id = ? AND owner_id = ?",
        (flow_id, str(teacher_id)),
    ).fetchone()


def create_flow(name: str, description: str, teacher_id: int) -> dict[str, object]:
    flow_id = str(uuid.uuid4())
    owner_id = str(teacher_id)
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        existing = connection.execute(
            """
            SELECT 1 FROM flows
            WHERE owner_id = ? AND name = ? AND status != 'archived'
            LIMIT 1
            """,
            (owner_id, name),
        ).fetchone()
        if existing is not None:
            raise DuplicateFlowNameError("已存在同名流程")
        connection.execute(
            """
            INSERT INTO flows (id, name, description, owner_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (flow_id, name, description, owner_id, now, now),
        )
    return get_flow(flow_id, teacher_id)


def get_flow(flow_id: str, teacher_id: int) -> dict[str, object]:
    with get_connection() as connection:
        row = _owned_flow(connection, flow_id, teacher_id)
        if row is None:
            raise KeyError(flow_id)
        published = _latest_published_version(connection, flow_id, teacher_id)
        token = (
            connection.execute(
                """
                SELECT token_value FROM share_tokens
                WHERE flow_version_id = ? AND status = 'active'
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (published["id"],),
            ).fetchone()
            if published
            else None
        )
    draft_config = json.loads(row["draft_config"])
    published_config = json.loads(published["config_snapshot"]) if published else None
    draft_hash = hashlib.sha256(canonical_json(draft_config).encode("utf-8")).hexdigest()
    return {
        "id": row["id"],
        "name": row["name"],
        "publishedVersionId": published["id"] if published else None,
        "publishedNodeIds": [node["id"] for node in published_config.get("nodes", [])]
        if published_config
        else [],
        "publishedVersionNo": published["version_no"] if published else None,
        "hasUnpublishedChanges": bool(published and published["config_hash"] != draft_hash),
        "shareUrl": f"/s/{token['token_value']}" if token and token["token_value"] else "",
        "description": row["description"],
        "status": row["status"],
        "config": draft_config,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def list_flows(teacher_id: int) -> list[dict[str, object]]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id FROM flows
            WHERE owner_id = ? AND status != 'archived'
            ORDER BY created_at DESC
            """,
            (str(teacher_id),),
        ).fetchall()
    return [get_flow(row["id"], teacher_id) for row in rows]


def save_draft(flow_id: str, config: dict[str, Any], teacher_id: int) -> dict[str, object]:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        flow = _owned_flow(connection, flow_id, teacher_id)
        if flow is None:
            raise KeyError(flow_id)
        if flow["status"] == "archived":
            raise ArchivedFlowError("已归档流程不可编辑")
        published = _latest_published_version(connection, flow_id, teacher_id)
        if published:
            assert_published_nodes_present(json.loads(published["config_snapshot"]), config)
        cursor = connection.execute(
            """
            UPDATE flows SET draft_config = ?, updated_at = ?
            WHERE id = ? AND owner_id = ?
            """,
            (canonical_json(config), now, flow_id, str(teacher_id)),
        )
        if cursor.rowcount == 0:
            raise KeyError(flow_id)
    return get_flow(flow_id, teacher_id)


def publish_flow(flow_id: str, teacher_id: int) -> dict[str, object]:
    version_id = str(uuid.uuid4())
    share_token_id = str(uuid.uuid4())
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = utc_now_iso()

    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        flow = _owned_flow(connection, flow_id, teacher_id)
        if flow is None:
            raise KeyError(flow_id)
        if flow["status"] == "archived":
            raise ArchivedFlowError("已归档流程不可发布")
        config = json.loads(flow["draft_config"])
        published = _latest_published_version(connection, flow_id, teacher_id)
        if published:
            assert_published_nodes_present(json.loads(published["config_snapshot"]), config)
        validate_flow_config(config)
        active_roster_count = connection.execute(
            """
            SELECT COUNT(*) AS count FROM flow_roster_entries
            WHERE flow_id = ? AND status = 'active'
            """,
            (flow_id,),
        ).fetchone()["count"]
        if active_roster_count == 0:
            raise FlowValidationError("请先导入学生名单")
        snapshot = canonical_json(config)
        config_hash = hashlib.sha256(snapshot.encode("utf-8")).hexdigest()
        row = connection.execute(
            "SELECT COALESCE(MAX(version_no), 0) + 1 AS next_no FROM flow_versions WHERE flow_id = ?",
            (flow_id,),
        ).fetchone()
        version_no = int(row["next_no"])
        connection.execute(
            """
            INSERT INTO flow_versions
                (id, flow_id, version_no, config_snapshot, config_hash, published_by, published_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (version_id, flow_id, version_no, snapshot, config_hash, str(teacher_id), now),
        )
        for node in config["nodes"]:
            connection.execute(
                """
                INSERT INTO flow_node_runtime_configs
                    (flow_version_id, node_key, deadline_at, updated_by, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (version_id, node["id"], node.get("deadlineAt"), str(teacher_id), now),
            )
        connection.execute(
            """
            INSERT INTO share_tokens
                (id, flow_version_id, token_hash, token_value, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (share_token_id, version_id, token_hash, token, str(teacher_id), now),
        )
        connection.execute(
            """
            UPDATE flows SET status = 'published', updated_at = ?
            WHERE id = ? AND owner_id = ?
            """,
            (now, flow_id, str(teacher_id)),
        )
    return {
        "flowId": flow_id,
        "flowVersionId": version_id,
        "versionNo": version_no,
        "token": token,
        "shareUrl": f"/s/{token}",
        "configHash": config_hash,
    }


def get_revision_impact(flow_id: str, teacher_id: int) -> dict[str, object]:
    with get_connection() as connection:
        flow = connection.execute(
            "SELECT draft_config FROM flows WHERE id = ? AND owner_id = ?",
            (flow_id, str(teacher_id)),
        ).fetchone()
        if flow is None:
            raise KeyError(flow_id)
        published = _latest_published_version(connection, flow_id, teacher_id)
        if published is None:
            return {
                "currentVersionId": None,
                "currentVersionNo": None,
                "nextVersionNo": 1,
                "addedNodeIds": [],
                "changedNodeIds": [],
                "predecessorChangedNodeIds": [],
                "invalidatedNodeIds": [],
                "affectedStudentCount": 0,
            }

        impact = analyze_revision(
            json.loads(published["config_snapshot"]), json.loads(flow["draft_config"])
        )
        affected_student_count = 0
        if impact["invalidatedNodeIds"]:
            affected_student_count = connection.execute(
                """
                SELECT COUNT(DISTINCT id) AS count
                FROM flow_instances
                WHERE flow_version_id = ?
                """,
                (published["id"],),
            ).fetchone()["count"]

    return {
        "currentVersionId": published["id"],
        "currentVersionNo": published["version_no"],
        "nextVersionNo": published["version_no"] + 1,
        **impact,
        "affectedStudentCount": affected_student_count,
    }


def delete_flow(flow_id: str, teacher_id: int) -> None:
    now = utc_now_iso()
    with get_connection() as connection:
        row = connection.execute(
            "SELECT name, status FROM flows WHERE id = ? AND owner_id = ?",
            (flow_id, str(teacher_id)),
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
            """
            DELETE FROM audit_logs
            WHERE entity_type IN ('flow', 'flow_roster') AND entity_id = ?
            """,
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
