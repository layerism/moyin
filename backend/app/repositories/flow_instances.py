import hashlib
import json
import uuid
from typing import Any

from app.core.database import get_connection
from app.domain.workflow_runtime import (
    deadline_has_passed,
    incoming_nodes,
    node_by_key,
    validate_submission,
)
from app.repositories.flow_files import (
    FileContextError,
    attach_uploaded_file,
    get_uploaded_file_for_node,
)
from app.repositories.flow_roster import assert_student_roster_access
from app.repositories.workflows import canonical_json
from app.services.security import utc_now_iso


class RuntimeConflictError(ValueError):
    pass


class RuntimeDeadlineError(ValueError):
    pass


def _version_config(connection, version_id: str) -> dict[str, Any]:
    row = connection.execute(
        "SELECT config_snapshot FROM flow_versions WHERE id = ?", (version_id,)
    ).fetchone()
    if row is None:
        raise KeyError(version_id)
    return json.loads(row["config_snapshot"])


def _effective_deadline(connection, instance_id: str, version_id: str, node_key: str) -> str | None:
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
        SELECT deadline_at FROM flow_node_runtime_configs
        WHERE flow_version_id = ? AND node_key = ?
        """,
        (version_id, node_key),
    ).fetchone()
    return runtime["deadline_at"] if runtime else None


def get_or_create_instance(token: str, student_id: int) -> dict[str, object]:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        shared = connection.execute(
            """
            SELECT v.id AS version_id, v.flow_id, v.config_snapshot
            FROM share_tokens t
            JOIN flow_versions v ON v.id = t.flow_version_id
            WHERE t.token_hash = ? AND t.status = 'active'
              AND (t.expires_at IS NULL OR t.expires_at > ?)
              AND v.status = 'published'
            """,
            (hashlib.sha256(token.encode("utf-8")).hexdigest(), now),
        ).fetchone()
        if shared is None:
            raise KeyError(token)
        version_id = shared["version_id"]
        config = json.loads(shared["config_snapshot"])
        assert_student_roster_access(connection, shared["flow_id"], student_id)
        row = connection.execute(
            """
            SELECT id FROM flow_instances
            WHERE flow_version_id = ? AND student_account_id = ?
            """,
            (version_id, student_id),
        ).fetchone()
        if row is None:
            instance_id = str(uuid.uuid4())
            connection.execute(
                """
                INSERT INTO flow_instances
                    (id, flow_version_id, student_account_id, started_at, last_active_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (instance_id, version_id, student_id, now, now),
            )
            incoming = incoming_nodes(config)
            for node in config["nodes"]:
                node_key = node["id"]
                status = "available" if not incoming[node_key] else "locked"
                deadline = _effective_deadline(connection, instance_id, version_id, node_key)
                if status == "available" and deadline_has_passed(deadline):
                    status = "expired"
                connection.execute(
                    """
                    INSERT INTO node_instances
                        (id, flow_instance_id, node_key, status, opened_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        str(uuid.uuid4()),
                        instance_id,
                        node_key,
                        status,
                        now if status == "available" else None,
                    ),
                )
        else:
            instance_id = row["id"]
            connection.execute(
                "UPDATE flow_instances SET last_active_at = ? WHERE id = ?", (now, instance_id)
            )
    return get_instance(instance_id, student_id)


def get_instance(instance_id: str, student_id: int | None = None) -> dict[str, object]:
    with get_connection() as connection:
        connection.execute("BEGIN")
        params: list[object] = [instance_id]
        student_filter = ""
        if student_id is not None:
            student_filter = " AND i.student_account_id = ?"
            params.append(student_id)
        instance = connection.execute(
            f"""
            SELECT i.*, a.student_no, a.name, v.config_snapshot, v.flow_id,
                   f.name AS flow_name, f.description
            FROM flow_instances i
            JOIN student_accounts a ON a.id = i.student_account_id
            JOIN flow_versions v ON v.id = i.flow_version_id
            JOIN flows f ON f.id = v.flow_id
            WHERE i.id = ?{student_filter}
            """,
            params,
        ).fetchone()
        if instance is None:
            raise KeyError(instance_id)
        if student_id is not None:
            assert_student_roster_access(connection, instance["flow_id"], student_id)
        config = json.loads(instance["config_snapshot"])
        node_rows = connection.execute(
            """
            SELECT n.*, d.payload AS draft_payload
            FROM node_instances n
            LEFT JOIN node_drafts d ON d.node_instance_id = n.id
            WHERE n.flow_instance_id = ?
            """,
            (instance_id,),
        ).fetchall()
        node_order = {node["id"]: index for index, node in enumerate(config["nodes"])}
        nodes = []
        for row in node_rows:
            deadline = _effective_deadline(
                connection, instance_id, instance["flow_version_id"], row["node_key"]
            )
            status = row["status"]
            if status in {"available", "draft"} and deadline_has_passed(deadline):
                status = "expired"
            nodes.append(
                {
                    "id": row["id"],
                    "nodeKey": row["node_key"],
                    "status": status,
                    "attemptNo": row["attempt_no"],
                    "draft": json.loads(row["draft_payload"]) if row["draft_payload"] else {},
                    "effectiveDeadline": deadline,
                    "submittedAt": row["submitted_at"],
                    "approvedAt": row["approved_at"],
                }
            )
        nodes.sort(key=lambda item: node_order[item["nodeKey"]])
    return {
        "id": instance["id"],
        "flowId": instance["flow_id"],
        "flowVersionId": instance["flow_version_id"],
        "name": instance["flow_name"],
        "description": instance["description"],
        "status": instance["status"],
        "student": {"studentNo": instance["student_no"], "name": instance["name"]},
        "config": config,
        "nodeInstances": nodes,
    }


def list_student_instances(student_id: int) -> list[dict[str, object]]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT i.id, i.status, i.last_active_at, f.name
            FROM flow_instances i
            JOIN student_accounts a ON a.id = i.student_account_id
            JOIN flow_versions v ON v.id = i.flow_version_id
            JOIN flows f ON f.id = v.flow_id
            JOIN flow_roster_entries r
              ON r.flow_id = f.id
             AND r.student_no = a.student_no
             AND r.name = a.name
             AND r.status = 'active'
            WHERE i.student_account_id = ?
            ORDER BY i.last_active_at DESC
            """,
            (student_id,),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "status": row["status"],
            "lastActiveAt": row["last_active_at"],
        }
        for row in rows
    ]


def save_node_draft(
    node_instance_id: str, student_id: int, payload: dict[str, Any]
) -> dict[str, object]:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            """
            SELECT n.id, n.status, n.flow_instance_id, v.flow_id
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
        if row["status"] not in {"available", "draft", "rejected"}:
            raise RuntimeConflictError("当前节点不可暂存")
        connection.execute(
            """
            INSERT INTO node_drafts (node_instance_id, payload, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(node_instance_id) DO UPDATE
            SET payload = excluded.payload, updated_at = excluded.updated_at
            """,
            (node_instance_id, canonical_json(payload), now),
        )
        connection.execute(
            "UPDATE node_instances SET status = 'draft' WHERE id = ?", (node_instance_id,)
        )
    return get_instance(row["flow_instance_id"], student_id)


def _advance_downstream(
    connection, instance_id: str, version_id: str, config: dict[str, Any]
) -> None:
    statuses = {
        row["node_key"]: row["status"]
        for row in connection.execute(
            "SELECT node_key, status FROM node_instances WHERE flow_instance_id = ?",
            (instance_id,),
        ).fetchall()
    }
    incoming = incoming_nodes(config)
    now = utc_now_iso()
    for node_key, predecessors in incoming.items():
        if statuses[node_key] != "locked" or not predecessors:
            continue
        if all(statuses[source] == "approved" for source in predecessors):
            deadline = _effective_deadline(connection, instance_id, version_id, node_key)
            next_status = "expired" if deadline_has_passed(deadline) else "available"
            connection.execute(
                "UPDATE node_instances SET status = ?, opened_at = ? WHERE flow_instance_id = ? AND node_key = ?",
                (next_status, now, instance_id, node_key),
            )


def submit_node(
    node_instance_id: str,
    student_id: int,
    payload: dict[str, Any],
    idempotency_key: str,
) -> dict[str, object]:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            """
            SELECT n.*, i.flow_version_id, i.student_account_id, v.flow_id
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
        duplicate = connection.execute(
            "SELECT id FROM submissions WHERE node_instance_id = ? AND idempotency_key = ?",
            (node_instance_id, idempotency_key),
        ).fetchone()
        if duplicate is None:
            deadline = _effective_deadline(
                connection,
                row["flow_instance_id"],
                row["flow_version_id"],
                row["node_key"],
            )
            if deadline_has_passed(deadline):
                raise RuntimeDeadlineError("节点已超过截止时间")
            if row["status"] not in {"available", "draft", "rejected", "expired"}:
                raise RuntimeConflictError("当前节点不可提交")
            config = _version_config(connection, row["flow_version_id"])
            node = node_by_key(config, row["node_key"])
            submission_payload = payload
            uploaded_file = None
            if node.get("kind") == "file":
                file_value = payload.get("file")
                if not isinstance(file_value, dict) or not file_value.get("fileId"):
                    raise RuntimeConflictError("请先上传文件")
                uploaded_file = get_uploaded_file_for_node(
                    connection,
                    str(file_value["fileId"]),
                    node_instance_id,
                    student_id,
                )
                if uploaded_file is None:
                    raise RuntimeConflictError("文件不存在、已提交或不属于当前节点")
                submission_payload = dict(payload)
                submission_payload["file"] = {
                    "fileId": uploaded_file["id"],
                    "name": uploaded_file["original_name"],
                    "size": uploaded_file["size_bytes"],
                    "type": uploaded_file["content_type"],
                }
            try:
                validate_submission(node, submission_payload)
            except ValueError as exc:
                raise RuntimeConflictError(str(exc)) from exc
            attempt_no = int(row["attempt_no"]) + 1
            submission_status = "approved" if node.get("autoApprove", True) else "reviewing"
            submission_id = str(uuid.uuid4())
            connection.execute(
                """
                INSERT INTO submissions
                    (id, node_instance_id, attempt_no, idempotency_key,
                     payload_snapshot, status, submitted_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    submission_id,
                    node_instance_id,
                    attempt_no,
                    idempotency_key,
                    canonical_json(submission_payload),
                    submission_status,
                    now,
                ),
            )
            if uploaded_file is not None:
                try:
                    attach_uploaded_file(connection, str(uploaded_file["id"]), submission_id)
                except FileContextError as exc:
                    raise RuntimeConflictError(str(exc)) from exc
            connection.execute(
                "DELETE FROM node_drafts WHERE node_instance_id = ?",
                (node_instance_id,),
            )
            connection.execute(
                """
                UPDATE node_instances
                SET status = ?, submitted_at = ?, approved_at = ?, attempt_no = ?
                WHERE id = ?
                """,
                (
                    submission_status,
                    now,
                    now if submission_status == "approved" else None,
                    attempt_no,
                    node_instance_id,
                ),
            )
            if submission_status == "approved":
                _advance_downstream(
                    connection,
                    row["flow_instance_id"],
                    row["flow_version_id"],
                    config,
                )
            remaining = connection.execute(
                """
                SELECT COUNT(*) AS count FROM node_instances
                WHERE flow_instance_id = ? AND status != 'approved'
                """,
                (row["flow_instance_id"],),
            ).fetchone()["count"]
            if remaining == 0:
                connection.execute(
                    """
                    UPDATE flow_instances
                    SET status = 'completed', completed_at = ? WHERE id = ?
                    """,
                    (now, row["flow_instance_id"]),
                )
    return get_instance(row["flow_instance_id"], student_id)


def set_student_deadline(
    instance_id: str,
    node_key: str,
    deadline_at: str,
    reason: str,
    teacher_id: int,
) -> dict[str, object]:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        exists = connection.execute(
            """
            SELECT i.id FROM flow_instances i
            JOIN flow_versions v ON v.id = i.flow_version_id
            JOIN flows f ON f.id = v.flow_id
            JOIN node_instances n
              ON n.flow_instance_id = i.id AND n.node_key = ?
            WHERE i.id = ? AND f.owner_id = ? AND v.status = 'published'
            """,
            (node_key, instance_id, str(teacher_id)),
        ).fetchone()
        if exists is None:
            raise KeyError(instance_id)
        connection.execute(
            """
            INSERT INTO student_deadline_overrides
                (flow_instance_id, node_key, deadline_at, reason, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(flow_instance_id, node_key) DO UPDATE
            SET deadline_at = excluded.deadline_at, reason = excluded.reason,
                created_by = excluded.created_by, created_at = excluded.created_at
            """,
            (instance_id, node_key, deadline_at, reason, str(teacher_id), now),
        )
        connection.execute(
            """
            UPDATE node_instances SET status = CASE
                WHEN EXISTS (SELECT 1 FROM node_drafts d WHERE d.node_instance_id = node_instances.id)
                THEN 'draft' ELSE 'available' END
            WHERE flow_instance_id = ? AND node_key = ? AND status = 'expired'
            """,
            (instance_id, node_key),
        )
        connection.execute(
            """
            INSERT INTO audit_logs
                (actor_id, action, entity_type, entity_id, after_data, reason, created_at)
            VALUES (?, 'deadline_override', 'node_instance', ?, ?, ?, ?)
            """,
            (
                str(teacher_id),
                f"{instance_id}:{node_key}",
                canonical_json({"deadlineAt": deadline_at}),
                reason,
                now,
            ),
        )
    return get_instance(instance_id)


def set_global_deadline(
    version_id: str,
    node_key: str,
    deadline_at: str,
    reason: str,
    teacher_id: int,
) -> None:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            """
            SELECT r.deadline_at FROM flow_node_runtime_configs r
            JOIN flow_versions v ON v.id = r.flow_version_id
            JOIN flows f ON f.id = v.flow_id
            WHERE r.flow_version_id = ? AND r.node_key = ? AND f.owner_id = ?
              AND v.status = 'published'
            """,
            (version_id, node_key, str(teacher_id)),
        ).fetchone()
        if row is None:
            raise KeyError(node_key)
        connection.execute(
            """
            UPDATE flow_node_runtime_configs
            SET deadline_at = ?, updated_by = ?, updated_at = ?
            WHERE flow_version_id = ? AND node_key = ?
            """,
            (deadline_at, str(teacher_id), now, version_id, node_key),
        )
        connection.execute(
            """
            INSERT INTO audit_logs
                (actor_id, action, entity_type, entity_id, before_data, after_data, reason, created_at)
            VALUES (?, 'deadline_update', 'flow_node_runtime', ?, ?, ?, ?, ?)
            """,
            (
                str(teacher_id),
                f"{version_id}:{node_key}",
                canonical_json({"deadlineAt": row["deadline_at"]}),
                canonical_json({"deadlineAt": deadline_at}),
                reason,
                now,
            ),
        )


def get_version_progress(version_id: str, teacher_id: int) -> dict[str, object]:
    with get_connection() as connection:
        version = connection.execute(
            """
            SELECT v.id, v.flow_id, f.name FROM flow_versions v
            JOIN flows f ON f.id = v.flow_id
            WHERE v.id = ? AND f.owner_id = ?
            """,
            (version_id, str(teacher_id)),
        ).fetchone()
        if version is None:
            raise KeyError(version_id)
        rows = connection.execute(
            """
            SELECT i.id, i.status, i.last_active_at, a.student_no, a.name,
                   SUM(CASE WHEN n.status = 'approved' THEN 1 ELSE 0 END) AS approved_count,
                   COUNT(n.id) AS total_count,
                   SUM(CASE WHEN n.status = 'expired' THEN 1 ELSE 0 END) AS expired_count
            FROM flow_instances i
            JOIN student_accounts a ON a.id = i.student_account_id
            JOIN node_instances n ON n.flow_instance_id = i.id
            WHERE i.flow_version_id = ?
            GROUP BY i.id, a.id
            ORDER BY a.student_no
            """,
            (version_id,),
        ).fetchall()
    return {
        "flowVersionId": version_id,
        "name": version["name"],
        "students": [
            {
                "instanceId": row["id"],
                "studentNo": row["student_no"],
                "name": row["name"],
                "status": row["status"],
                "approvedCount": row["approved_count"],
                "totalCount": row["total_count"],
                "expiredCount": row["expired_count"],
                "lastActiveAt": row["last_active_at"],
            }
            for row in rows
        ],
    }
