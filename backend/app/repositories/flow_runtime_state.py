import json
from typing import Any

from app.domain.workflow_runtime import incoming_nodes, node_by_key, pending_node_status
from app.services.security import utc_now_iso


def effective_deadline(
    connection, instance_id: str, version_id: str, node_key: str
) -> str | None:
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


def advance_downstream(
    connection, instance_id: str, version_id: str, config: dict[str, Any]
) -> None:
    statuses = {
        row["node_key"]: row["status"]
        for row in connection.execute(
            "SELECT node_key, status FROM node_instances WHERE flow_instance_id = ?",
            (instance_id,),
        ).fetchall()
    }
    now = utc_now_iso()
    for node_key, predecessors in incoming_nodes(config).items():
        if statuses.get(node_key) not in {"locked", "scheduled", "expired"} or not predecessors:
            continue
        predecessors_approved = all(statuses.get(source) == "approved" for source in predecessors)
        deadline = effective_deadline(connection, instance_id, version_id, node_key)
        next_status = pending_node_status(
            predecessors_approved,
            node_by_key(config, node_key).get("startAt"),
            deadline,
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
        WHERE flow_instance_id = ? AND status != 'approved'
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
