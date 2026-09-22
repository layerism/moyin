import json
import sqlite3
import uuid

from app.core.database import get_connection
from app.services.security import utc_now_iso


class WorkflowGroupConflictError(ValueError):
    pass


def _snapshot(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _group_view(row: sqlite3.Row) -> dict[str, object]:
    return {
        "id": row["id"],
        "name": row["name"],
        "flowCount": int(row["flow_count"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _select_group(
    connection: sqlite3.Connection, group_id: str, teacher_id: int
) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT g.*, COUNT(f.id) AS flow_count
        FROM workflow_groups g
        LEFT JOIN flows f ON f.group_id = g.id AND f.status != 'archived'
        WHERE g.id = ? AND g.owner_teacher_id = ?
        GROUP BY g.id
        """,
        (group_id, teacher_id),
    ).fetchone()


def require_owned_workflow_group(
    connection: sqlite3.Connection, group_id: str, teacher_id: int
) -> sqlite3.Row:
    row = connection.execute(
        "SELECT * FROM workflow_groups WHERE id = ? AND owner_teacher_id = ?",
        (group_id, teacher_id),
    ).fetchone()
    if row is None:
        raise KeyError(group_id)
    return row


def list_workflow_groups(teacher_id: int) -> list[dict[str, object]]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT g.*, COUNT(f.id) AS flow_count
            FROM workflow_groups g
            LEFT JOIN flows f ON f.group_id = g.id AND f.status != 'archived'
            WHERE g.owner_teacher_id = ?
            GROUP BY g.id
            ORDER BY g.created_at, g.id
            """,
            (teacher_id,),
        ).fetchall()
    return [_group_view(row) for row in rows]


def create_workflow_group(name: str, teacher_id: int) -> dict[str, object]:
    group_name = name.strip()
    if not group_name or len(group_name) > 60:
        raise ValueError("分组名称不能为空且不能超过 60 个字符")
    group_id = str(uuid.uuid4())
    now = utc_now_iso()
    try:
        with get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """
                INSERT INTO workflow_groups
                    (id, owner_teacher_id, name, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (group_id, teacher_id, group_name, now, now),
            )
            connection.execute(
                """
                INSERT INTO audit_logs
                    (actor_id, action, entity_type, entity_id, after_data, created_at)
                VALUES (?, 'workflow_group_created', 'workflow_group', ?, ?, ?)
                """,
                (str(teacher_id), group_id, _snapshot({"id": group_id, "name": group_name}), now),
            )
            row = _select_group(connection, group_id, teacher_id)
    except sqlite3.IntegrityError as exc:
        raise WorkflowGroupConflictError("已存在同名分组") from exc
    if row is None:
        raise KeyError(group_id)
    return _group_view(row)


def rename_workflow_group(
    group_id: str, name: str, teacher_id: int
) -> dict[str, object]:
    group_name = name.strip()
    if not group_name or len(group_name) > 60:
        raise ValueError("分组名称不能为空且不能超过 60 个字符")
    now = utc_now_iso()
    try:
        with get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            current = require_owned_workflow_group(connection, group_id, teacher_id)
            if current["name"] != group_name:
                connection.execute(
                    "UPDATE workflow_groups SET name = ?, updated_at = ? WHERE id = ?",
                    (group_name, now, group_id),
                )
                connection.execute(
                    """
                    INSERT INTO audit_logs
                        (actor_id, action, entity_type, entity_id,
                         before_data, after_data, created_at)
                    VALUES (?, 'workflow_group_renamed', 'workflow_group', ?, ?, ?, ?)
                    """,
                    (
                        str(teacher_id),
                        group_id,
                        _snapshot({"name": current["name"]}),
                        _snapshot({"name": group_name}),
                        now,
                    ),
                )
            row = _select_group(connection, group_id, teacher_id)
    except sqlite3.IntegrityError as exc:
        raise WorkflowGroupConflictError("已存在同名分组") from exc
    if row is None:
        raise KeyError(group_id)
    return _group_view(row)


def delete_workflow_group(group_id: str, teacher_id: int) -> None:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        group = require_owned_workflow_group(connection, group_id, teacher_id)
        flow_count = connection.execute(
            "SELECT COUNT(*) AS count FROM flows WHERE group_id = ?",
            (group_id,),
        ).fetchone()["count"]
        if flow_count:
            raise WorkflowGroupConflictError("组内有流程，不能删除")
        connection.execute("DELETE FROM workflow_groups WHERE id = ?", (group_id,))
        connection.execute(
            """
            INSERT INTO audit_logs
                (actor_id, action, entity_type, entity_id, before_data, created_at)
            VALUES (?, 'workflow_group_deleted', 'workflow_group', ?, ?, ?)
            """,
            (str(teacher_id), group_id, _snapshot({"id": group_id, "name": group["name"]}), now),
        )


def move_flow_to_group(
    flow_id: str, group_id: str | None, teacher_id: int
) -> dict[str, object]:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        flow = connection.execute(
            """
            SELECT id, group_id FROM flows
            WHERE id = ? AND owner_id = ? AND status != 'archived'
            """,
            (flow_id, str(teacher_id)),
        ).fetchone()
        if flow is None:
            raise KeyError(flow_id)
        if group_id is not None:
            require_owned_workflow_group(connection, group_id, teacher_id)
        if flow["group_id"] != group_id:
            connection.execute(
                "UPDATE flows SET group_id = ?, updated_at = ? WHERE id = ?",
                (group_id, now, flow_id),
            )
            connection.execute(
                """
                INSERT INTO audit_logs
                    (actor_id, action, entity_type, entity_id,
                     before_data, after_data, created_at)
                VALUES (?, 'workflow_group_moved', 'flow_group', ?, ?, ?, ?)
                """,
                (
                    str(teacher_id),
                    flow_id,
                    _snapshot({"previousGroupId": flow["group_id"]}),
                    _snapshot({"groupId": group_id}),
                    now,
                ),
            )
    from app.repositories.workflows import get_flow

    return get_flow(flow_id, teacher_id)
