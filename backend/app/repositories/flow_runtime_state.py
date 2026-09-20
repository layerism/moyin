import json
from typing import Any

from app.domain.flow_deadlines import resolve_deadlines
from app.repositories.branch_state import resolve_routes
from app.domain.workflow_runtime import node_by_key, pending_node_status
from app.services.security import utc_now_iso
from app.repositories.branch_state import sync_branch_states


def is_preview_instance(connection, instance_id: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM flow_preview_sessions WHERE flow_instance_id = ?",
        (instance_id,),
    ).fetchone()
    return row is not None


def effective_deadline(
    connection, instance_id: str, version_id: str, node_key: str
) -> str | None:
    if is_preview_instance(connection, instance_id):
        return None
    override = connection.execute(
        """
        SELECT deadline_at FROM student_deadline_overrides
        WHERE flow_instance_id = ? AND node_key = ?
        """,
        (instance_id, node_key),
    ).fetchone()
    if override is not None:
        return override["deadline_at"]
    return version_deadlines(connection, version_id).get(node_key)


def version_deadlines(connection, version_id: str) -> dict[str, str | None]:
    version = connection.execute(
        "SELECT config_snapshot FROM flow_versions WHERE id = ?", (version_id,)
    ).fetchone()
    config = json.loads(version["config_snapshot"])
    rows = connection.execute(
        "SELECT node_key, deadline_at FROM flow_node_runtime_configs WHERE flow_version_id = ?",
        (version_id,),
    ).fetchall()
    explicit = {row["node_key"]: row["deadline_at"] for row in rows}
    for node in config["nodes"]:
        if node["id"] in explicit:
            node["deadlineAt"] = explicit[node["id"]]
    deadlines = resolve_deadlines(config)
    # Branches transmit calendar constraints but have no submission deadline.
    for node in config["nodes"]:
        if node.get("kind") == "branch":
            deadlines[node["id"]] = None
    return deadlines


def advance_downstream(
    connection, instance_id: str, version_id: str, config: dict[str, Any]
) -> None:
    sync_branch_states(connection, instance_id, config)
    statuses = {
        row["node_key"]: row["status"]
        for row in connection.execute(
            "SELECT node_key, status FROM node_instances WHERE flow_instance_id = ?",
            (instance_id,),
        ).fetchall()
    }
    now = utc_now_iso()
    preview = is_preview_instance(connection, instance_id)
    incoming, _, ready = resolve_routes(connection, instance_id, config)
    for node_key, predecessors in incoming.items():
        if statuses.get(node_key) not in {"locked", "scheduled", "expired"} or not predecessors:
            continue
        predecessors_approved = node_key in ready
        deadline = effective_deadline(connection, instance_id, version_id, node_key)
        next_status = pending_node_status(
            predecessors_approved,
            None if preview else node_by_key(config, node_key).get("startAt"),
            deadline,
            kind=node_by_key(config, node_key).get("kind"),
        )
        if next_status != statuses.get(node_key):
            connection.execute(
                """
                UPDATE node_instances SET status = ?, opened_at = ?
                WHERE flow_instance_id = ? AND node_key = ?
                """,
                (next_status, now if next_status == "available" else None, instance_id, node_key),
            )
            statuses[node_key] = next_status


def complete_flow_if_ready(connection, instance_id: str, now: str) -> None:
    remaining = connection.execute(
        """
        SELECT COUNT(*) AS count FROM node_instances
        WHERE flow_instance_id = ? AND status NOT IN ('approved', 'skipped')
        """,
        (instance_id,),
    ).fetchone()["count"]
    if remaining == 0:
        connection.execute(
            """
            UPDATE flow_instances
            SET status = 'completed', completed_at = ? WHERE id = ?
            """,
            (now, instance_id),
        )


def version_config(connection, version_id: str) -> dict[str, Any]:
    row = connection.execute(
        "SELECT config_snapshot FROM flow_versions WHERE id = ?", (version_id,)
    ).fetchone()
    if row is None:
        raise KeyError(version_id)
    return json.loads(row["config_snapshot"])
