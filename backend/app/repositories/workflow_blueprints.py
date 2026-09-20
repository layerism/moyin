"""Immutable template definitions stored under a non-user owner namespace."""
import json
import uuid

from app.core.database import get_connection
from app.domain.workflow import FlowValidationError
from app.repositories.workflows import copy_flow_definition, get_flow
from app.services.security import utc_now_iso

TEMPLATE_OWNER = "workflow-template-library"


class BlueprintConflictError(ValueError):
    pass


def list_blueprints(include_inactive: bool = False) -> list[dict[str, object]]:
    with get_connection() as connection:
        rows = connection.execute(
            """SELECT b.*, f.draft_config FROM workflow_blueprints b
               JOIN flows f ON f.id = b.snapshot_flow_id
               WHERE b.active = 1 OR ? ORDER BY b.updated_at DESC, b.id""",
            (include_inactive,),
        ).fetchall()
    return [{
        "id": row["id"], "name": row["name"], "description": row["description"],
        "active": bool(row["active"]), "updatedAt": row["updated_at"],
        "nodeCount": len(json.loads(row["draft_config"]).get("nodes", [])),
    } for row in rows]


def publish_blueprint(source_id: str, name: str, description: str, actor_id: int,
                      blueprint_id: str | None = None, *, editing: bool = False) -> str:
    name, description = name.strip(), description.strip()
    if not name or len(name) > 120 or len(description) > 500:
        raise FlowValidationError("模板名称需为 1–120 字，简介不能超过 500 字")
    with get_connection() as connection:
        previous = connection.execute(
            "SELECT snapshot_flow_id FROM workflow_blueprints WHERE id = ?", (blueprint_id,),
        ).fetchone() if blueprint_id else None
        if blueprint_id and previous is None:
            raise KeyError(blueprint_id)
        # Snapshot IDs identify content revisions; availability changes only update timestamps.
        if editing:
            draft = connection.execute(
                "SELECT * FROM workflow_blueprint_drafts WHERE blueprint_id = ? AND teacher_id = ? AND flow_id = ?",
                (blueprint_id, actor_id, source_id),
            ).fetchone()
            if draft is None:
                raise KeyError(source_id)
            if draft['base_snapshot_flow_id'] != previous['snapshot_flow_id']:
                raise BlueprintConflictError("模板已被其他管理员更新，请返回模板列表重新载入；当前草稿仍保留")

    template_id = blueprint_id or str(uuid.uuid4())

    def finalize(connection, snapshot_id):
        now = utc_now_iso()
        if previous is None:
            connection.execute(
                """INSERT INTO workflow_blueprints
                   (id, name, description, snapshot_flow_id, created_by, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (template_id, name, description, snapshot_id, actor_id, now, now),
            )
        else:
            changed = connection.execute(
                """UPDATE workflow_blueprints SET name = ?, description = ?, snapshot_flow_id = ?,
                   active = 1, updated_at = ? WHERE id = ? AND snapshot_flow_id = ?""",
                (name, description, snapshot_id, now, template_id, previous["snapshot_flow_id"]),
            )
            if changed.rowcount != 1:
                raise BlueprintConflictError("模板已被更新，请刷新后重试")
        if editing:
            changed = connection.execute(
                "DELETE FROM workflow_blueprint_drafts WHERE blueprint_id = ? AND teacher_id = ? AND flow_id = ?",
                (template_id, actor_id, source_id),
            )
            if changed.rowcount != 1:
                raise BlueprintConflictError("模板编辑草稿已变化，请重新载入")
            connection.execute("UPDATE flows SET status = 'archived' WHERE id = ?", (source_id,))
        connection.execute(
            """INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after_data, created_at)
               VALUES (?, 'workflow_template_published', 'workflow_template', ?, ?, ?)""",
            (str(actor_id), template_id, json.dumps({"snapshotFlowId": snapshot_id}), now),
        )
        connection.execute(
            """INSERT INTO workflow_blueprint_versions
               (id, blueprint_id, snapshot_flow_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)""",
            (str(uuid.uuid4()), template_id, snapshot_id, actor_id, now),
        )

    copy_flow_definition(source_id, str(uuid.uuid4()), actor_id, str(actor_id),
                         TEMPLATE_OWNER, clear_dates=True, finalize=finalize)
    return template_id


def set_blueprint_active(blueprint_id: str, active: bool, actor_id: int) -> None:
    with get_connection() as connection:
        result = connection.execute(
            "UPDATE workflow_blueprints SET active = ?, updated_at = ? WHERE id = ?",
            (active, utc_now_iso(), blueprint_id),
        )
        if result.rowcount != 1:
            raise KeyError(blueprint_id)
        connection.execute(
            """INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after_data, created_at)
               VALUES (?, 'workflow_template_availability', 'workflow_template', ?, ?, ?)""",
            (str(actor_id), blueprint_id, json.dumps({"active": active}), utc_now_iso()),
        )


def use_blueprint(blueprint_id: str, teacher_id: int) -> dict[str, object]:
    with get_connection() as connection:
        template = connection.execute(
            "SELECT * FROM workflow_blueprints WHERE id = ? AND active = 1", (blueprint_id,),
        ).fetchone()
        if template is None:
            raise KeyError(blueprint_id)

    def finalize(connection, new_flow_id):
        current = connection.execute(
            "SELECT snapshot_flow_id FROM workflow_blueprints WHERE id = ? AND active = 1",
            (blueprint_id,),
        ).fetchone()
        if current is None or current["snapshot_flow_id"] != template["snapshot_flow_id"]:
            raise BlueprintConflictError("模板已更新或下架，请刷新后重试")
        connection.execute("UPDATE flows SET description = ? WHERE id = ?",
                           (template["description"], new_flow_id))

    new_id = copy_flow_definition(
        template["snapshot_flow_id"], template["name"], teacher_id, TEMPLATE_OWNER,
        str(teacher_id), auto_name=True, clear_dates=True, finalize=finalize,
    )
    return get_flow(new_id, teacher_id)


def open_blueprint_draft(blueprint_id: str, teacher_id: int) -> dict[str, object]:
    with get_connection() as connection:
        template = connection.execute("SELECT * FROM workflow_blueprints WHERE id = ?", (blueprint_id,)).fetchone()
        if template is None:
            raise KeyError(blueprint_id)
        draft = connection.execute(
            "SELECT * FROM workflow_blueprint_drafts WHERE blueprint_id = ? AND teacher_id = ?",
            (blueprint_id, teacher_id),
        ).fetchone()
        if draft and draft['base_snapshot_flow_id'] != template['snapshot_flow_id']:
            raise BlueprintConflictError("模板已更新，旧编辑草稿仍保留；可放弃旧草稿后重新载入")
    if draft:
        flow_id = draft['flow_id']
    else:
        def finalize(connection, new_flow_id):
            current = connection.execute("SELECT * FROM workflow_blueprints WHERE id = ?", (blueprint_id,)).fetchone()
            if current is None or current['snapshot_flow_id'] != template['snapshot_flow_id']:
                raise BlueprintConflictError("模板已更新，请重新载入")
            if connection.execute("SELECT 1 FROM workflow_blueprint_drafts WHERE blueprint_id = ? AND teacher_id = ?", (blueprint_id, teacher_id)).fetchone():
                raise BlueprintConflictError("编辑草稿已创建，请重新载入")
            connection.execute(
                "INSERT INTO workflow_blueprint_drafts (blueprint_id, teacher_id, flow_id, base_snapshot_flow_id, base_updated_at) VALUES (?, ?, ?, ?, ?)",
                (blueprint_id, teacher_id, new_flow_id, template['snapshot_flow_id'], template['updated_at']),
            )
            connection.execute("UPDATE flows SET description = ? WHERE id = ?", (template['description'], new_flow_id))
        try:
            flow_id = copy_flow_definition(template['snapshot_flow_id'], template['name'][:110] + '（模板草稿）', teacher_id,
                                          TEMPLATE_OWNER, str(teacher_id), auto_name=True, clear_dates=True, finalize=finalize)
        except BlueprintConflictError:
            # Concurrent opens (including a refreshed tab) share the same editable draft.
            with get_connection() as connection:
                existing = connection.execute(
                    "SELECT flow_id FROM workflow_blueprint_drafts WHERE blueprint_id = ? AND teacher_id = ? AND base_snapshot_flow_id = ?",
                    (blueprint_id, teacher_id, template['snapshot_flow_id']),
                ).fetchone()
            if existing is None:
                raise
            flow_id = existing['flow_id']

    return {'flow': get_flow(flow_id, teacher_id), 'name': template['name'], 'description': template['description']}


def discard_blueprint_draft(blueprint_id: str, teacher_id: int) -> None:
    with get_connection() as connection:
        connection.execute('BEGIN IMMEDIATE')
        draft = connection.execute("SELECT flow_id FROM workflow_blueprint_drafts WHERE blueprint_id = ? AND teacher_id = ?", (blueprint_id, teacher_id)).fetchone()
        if draft:
            connection.execute("UPDATE flows SET status = 'archived' WHERE id = ?", (draft['flow_id'],))
            connection.execute("DELETE FROM workflow_blueprint_drafts WHERE blueprint_id = ? AND teacher_id = ?", (blueprint_id, teacher_id))


def delete_blueprint(blueprint_id: str, actor_id: int) -> None:
    """Remove the library entry; archive its private definitions, never users' copies."""
    with get_connection() as connection:
        connection.execute('BEGIN IMMEDIATE')
        template = connection.execute("SELECT * FROM workflow_blueprints WHERE id = ?", (blueprint_id,)).fetchone()
        if template is None:
            raise KeyError(blueprint_id)
        now = utc_now_iso()
        connection.execute(
            """UPDATE flows SET status = 'archived', updated_at = ? WHERE id IN (
                SELECT snapshot_flow_id FROM workflow_blueprints WHERE id = ?
                UNION SELECT snapshot_flow_id FROM workflow_blueprint_versions WHERE blueprint_id = ?
                UNION SELECT flow_id FROM workflow_blueprint_drafts WHERE blueprint_id = ?
            )""", (now, blueprint_id, blueprint_id, blueprint_id),
        )
        connection.execute("DELETE FROM workflow_blueprint_drafts WHERE blueprint_id = ?", (blueprint_id,))
        connection.execute("DELETE FROM workflow_blueprint_versions WHERE blueprint_id = ?", (blueprint_id,))
        connection.execute("DELETE FROM workflow_blueprints WHERE id = ?", (blueprint_id,))
        connection.execute(
            """INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before_data, created_at)
               VALUES (?, 'workflow_template_deleted', 'workflow_template', ?, ?, ?)""",
            (str(actor_id), blueprint_id, json.dumps(dict(template), ensure_ascii=False), now),
        )
