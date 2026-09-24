"""Mutable parameters for immutable published review-step structures."""
import json

from app.core.database import get_connection
from app.domain.file_review_steps import structured_steps
from app.services.audit_model_connections import SCRIPT_PROVIDERS
from app.services.audit_script_catalog import find_audit_script
from app.services.audit_script_parameters import validate_script_params
from app.services.node_models import validate_node_model
from app.services.security import utc_now_iso


class ReviewStepPolicyConflict(ValueError):
    pass


def _published_node(connection, flow_id, node_key, teacher_id):
    version = connection.execute(
        """SELECT v.config_snapshot FROM flow_versions v JOIN flows f ON f.id = v.flow_id
           WHERE v.flow_id = ? AND f.owner_id = ? AND f.status != 'archived'
             AND v.status = 'published' ORDER BY v.version_no DESC LIMIT 1""",
        (flow_id, str(teacher_id)),
    ).fetchone()
    if version is None:
        raise KeyError(node_key)
    node = next((item for item in json.loads(version['config_snapshot'])['nodes']
                 if item['id'] == node_key), None)
    if node is None or not structured_steps(node):
        raise KeyError(node_key)
    return node


def _stored_items(connection, flow_id, node_key):
    row = connection.execute(
        'SELECT steps_json, generation, updated_at FROM node_review_step_policies WHERE flow_id = ? AND node_key = ?',
        (flow_id, node_key),
    ).fetchone()
    return row, json.loads(row['steps_json']) if row else None


def effective_review_step_node(connection, flow_id, node):
    if not structured_steps(node):
        return node
    _, items = _stored_items(connection, flow_id, node['id'])
    if items is None:
        return node
    base_ai = [step for step in node['fileReviewSteps'] if step['kind'] != 'manual']
    if [(step['id'], step.get('auditScriptId')) for step in base_ai] != [
        (item['id'], item['auditScriptId']) for item in items
    ]:
        return node
    overrides = {item['id']: item for item in items}
    steps = [{**step, 'auditScriptParams': overrides[step['id']]['auditScriptParams'],
              'auditModelCardId': overrides[step['id']]['auditModelCardId']}
             if step['kind'] != 'manual' else step for step in node['fileReviewSteps']]
    return {**node, 'fileReviewSteps': steps}


def _response(connection, flow_id, node_key, node):
    row, _ = _stored_items(connection, flow_id, node_key)
    effective = effective_review_step_node(connection, flow_id, node)
    return {
        'flowId': flow_id,
        'nodeKey': node_key,
        'generation': int(row['generation']) if row else 1,
        'steps': effective['fileReviewSteps'],
        'updatedAt': row['updated_at'] if row else None,
    }


def get_review_step_policy(flow_id, node_key, teacher_id):
    with get_connection() as connection:
        node = _published_node(connection, flow_id, node_key, teacher_id)
        return _response(connection, flow_id, node_key, node)


def update_review_step_policy(flow_id, node_key, teacher_id, expected_generation, requested):
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute('BEGIN IMMEDIATE')
        node = _published_node(connection, flow_id, node_key, teacher_id)
        row, _ = _stored_items(connection, flow_id, node_key)
        generation = int(row['generation']) if row else 1
        if generation != expected_generation:
            raise ReviewStepPolicyConflict('审核规则已被修改，请重新加载')
        base_ai = [step for step in node['fileReviewSteps'] if step['kind'] != 'manual']
        if not isinstance(requested, list) or len(requested) != len(base_ai):
            raise ValueError('审核步骤数量不可修改')
        items = []
        for base, item in zip(base_ai, requested):
            if not isinstance(item, dict) or set(item) - {'id', 'auditScriptParams', 'auditModelCardId'} or item.get('id') != base['id']:
                raise ValueError('已发布审核步骤的结构不可修改')
            params = item.get('auditScriptParams')
            if not isinstance(params, dict):
                raise ValueError('请填写完整的审核脚本参数')
            script_id = base['auditScriptId']
            record = find_audit_script(script_id)
            validated = validate_script_params(record.config, params)
            model_id = item.get('auditModelCardId') or None
            validate_node_model(connection, str(teacher_id), script_id, model_id)
            if script_id in SCRIPT_PROVIDERS and not model_id:
                raise ValueError('请选择审核模型')
            items.append({'id': base['id'], 'auditScriptId': script_id,
                          'auditScriptParams': validated, 'auditModelCardId': model_id})
        current = effective_review_step_node(connection, flow_id, node)
        current_ai = [step for step in current['fileReviewSteps'] if step['kind'] != 'manual']
        if all(item['auditScriptParams'] == (step.get('auditScriptParams') or {})
               and item['auditModelCardId'] == (step.get('auditModelCardId') or None)
               for item, step in zip(items, current_ai)):
            return _response(connection, flow_id, node_key, node)
        connection.execute(
            """INSERT INTO node_review_step_policies
               (flow_id, node_key, steps_json, generation, updated_by, updated_at)
               VALUES (?, ?, ?, 2, ?, ?)
               ON CONFLICT(flow_id, node_key) DO UPDATE SET
                 steps_json = excluded.steps_json,
                 generation = node_review_step_policies.generation + 1,
                 updated_by = excluded.updated_by,
                 updated_at = excluded.updated_at""",
            (flow_id, node_key, json.dumps(items, ensure_ascii=False, sort_keys=True), teacher_id, now),
        )
        connection.execute(
            """INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data, created_at)
               VALUES (?, 'review_step_policy_updated', 'review_step_policy', ?, ?, ?, ?)""",
            (str(teacher_id), f'{flow_id}:{node_key}',
             json.dumps({'generation': generation}, ensure_ascii=False),
             json.dumps({'generation': generation + 1, 'steps': items}, ensure_ascii=False), now),
        )
        return _response(connection, flow_id, node_key, node)
