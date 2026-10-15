"""Immutable workflow templates stored as independent flows."""
import json

from app.core.database import get_connection
from app.domain.workflow import FlowValidationError
from app.repositories.workflows import copy_flow_definition, get_flow
from app.services.security import utc_now_iso


class BlueprintConflictError(ValueError):
    pass


def list_blueprints(include_inactive: bool = False) -> list[dict[str, object]]:
    with get_connection() as connection:
        rows = connection.execute(
            """SELECT id, name, description, is_shared, updated_at, draft_config FROM flows
               WHERE kind = 'template' AND status != 'archived' AND (is_shared = 1 OR ?)
               ORDER BY updated_at DESC, id""", (include_inactive,),
        ).fetchall()
    return [{
        'id': row['id'], 'name': row['name'], 'description': row['description'],
        'active': bool(row['is_shared']), 'updatedAt': row['updated_at'],
        'nodeCount': len(json.loads(row['draft_config']).get('nodes', [])),
    } for row in rows]


def publish_blueprint(source_id: str, name: str, description: str, actor_id: int) -> str:
    name, description = name.strip(), description.strip()
    if not name or len(name) > 120 or len(description) > 500:
        raise FlowValidationError('模板名称需为 1–120 字，简介不能超过 500 字')

    def finalize(connection, template_id):
        connection.execute(
            "UPDATE flows SET description = ?, is_shared = 1 WHERE id = ? AND kind = 'template'",
            (description, template_id),
        )
        connection.execute(
            """INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after_data, created_at)
               VALUES (?, 'workflow_template_published', 'workflow_template', ?, ?, ?)""",
            (str(actor_id), template_id, json.dumps({'sourceFlowId': source_id}), utc_now_iso()),
        )

    return copy_flow_definition(
        source_id, name, actor_id, str(actor_id), str(actor_id),
        target_kind='template', clear_dates=True, finalize=finalize,
    )


def set_blueprint_active(blueprint_id: str, active: bool, actor_id: int) -> None:
    with get_connection() as connection:
        connection.execute('BEGIN IMMEDIATE')
        result = connection.execute(
            """UPDATE flows SET is_shared = ?, updated_at = ?
               WHERE id = ? AND kind = 'template' AND status != 'archived'""",
            (int(active), utc_now_iso(), blueprint_id),
        )
        if result.rowcount != 1:
            raise KeyError(blueprint_id)
        connection.execute(
            """INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after_data, created_at)
               VALUES (?, 'workflow_template_availability', 'workflow_template', ?, ?, ?)""",
            (str(actor_id), blueprint_id, json.dumps({'active': active}), utc_now_iso()),
        )


def use_blueprint(blueprint_id: str, teacher_id: int) -> dict[str, object]:
    with get_connection() as connection:
        template = connection.execute(
            "SELECT * FROM flows WHERE id = ? AND kind = 'template' AND is_shared = 1 AND status != 'archived'",
            (blueprint_id,),
        ).fetchone()
        if template is None:
            raise KeyError(blueprint_id)

    def finalize(connection, new_flow_id):
        if connection.execute(
            "SELECT 1 FROM flows WHERE id = ? AND kind = 'template' AND is_shared = 1 AND status != 'archived'",
            (blueprint_id,),
        ).fetchone() is None:
            raise BlueprintConflictError('模板已下架或删除，请刷新后重试')

    new_id = copy_flow_definition(
        blueprint_id, template['name'], teacher_id, template['owner_id'], str(teacher_id),
        source_kind='template', auto_name=True, clear_dates=True, finalize=finalize,
    )
    return get_flow(new_id, teacher_id)


def delete_blueprint(blueprint_id: str, actor_id: int) -> None:
    """Archive the fixed definition; retain its assets and all independent copies."""
    with get_connection() as connection:
        connection.execute('BEGIN IMMEDIATE')
        template = connection.execute(
            "SELECT id, name, description, is_shared FROM flows WHERE id = ? AND kind = 'template' AND status != 'archived'",
            (blueprint_id,),
        ).fetchone()
        if template is None:
            raise KeyError(blueprint_id)
        now = utc_now_iso()
        connection.execute("UPDATE flows SET status = 'archived', is_shared = 0, updated_at = ? WHERE id = ?", (now, blueprint_id))
        connection.execute(
            """INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before_data, created_at)
               VALUES (?, 'workflow_template_deleted', 'workflow_template', ?, ?, ?)""",
            (str(actor_id), blueprint_id, json.dumps(dict(template), ensure_ascii=False), now),
        )
