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


def _response(connection, flow_id, node_key, node):
    from app.repositories.node_configuration import current_node, node_metadata
    from app.domain.node_configuration import apply_current_parameters
    current = current_node(connection, flow_id, node_key)
    metadata = node_metadata(current, 'review')
    apply_current_parameters(node, current)
    return {
        'flowId': flow_id, 'nodeKey': node_key,
        'generation': metadata['generation'], 'steps': node['fileReviewSteps'],
        'updatedAt': metadata.get('updatedAt'),
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
        from app.repositories.node_configuration import current_node, node_metadata, save_node
        current = current_node(connection, flow_id, node_key)
        generation = node_metadata(current, 'review')['generation']
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
        current_ai = [step for step in current['fileReviewSteps'] if step['kind'] != 'manual']
        if all(item['auditScriptParams'] == (step.get('auditScriptParams') or {})
               and item['auditModelCardId'] == (step.get('auditModelCardId') or None)
               for item, step in zip(items, current_ai)):
            return _response(connection, flow_id, node_key, node)
        overrides = {item['id']: item for item in items}
        steps = [{**step, 'auditScriptParams': overrides[step['id']]['auditScriptParams'],
                  'auditModelCardId': overrides[step['id']]['auditModelCardId']}
                 if step['kind'] != 'manual' else step for step in node['fileReviewSteps']]
        save_node(connection, flow_id, node_key, {'fileReviewSteps': steps}, 'review',
                  teacher_id, generation + 1, now=now)
        connection.execute(
            """INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data, created_at)
               VALUES (?, 'review_step_policy_updated', 'review_step_policy', ?, ?, ?, ?)""",
            (str(teacher_id), f'{flow_id}:{node_key}',
             json.dumps({'generation': generation}, ensure_ascii=False),
             json.dumps({'generation': generation + 1, 'steps': items}, ensure_ascii=False), now),
        )
        return _response(connection, flow_id, node_key, node)
