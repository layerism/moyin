"""Published file/confirmation parameters stored separately from nodes in the existing JSON document."""
import copy
import json

from app.core.database import get_connection
from app.domain.node_assets import reference_assets
from app.domain.workflow import validate_flow_config
from app.services.security import utc_now_iso

KEY = 'publishedNodeParameters'
FIELDS = ('title', 'requirement', 'startAt', 'deadlineAt', 'referenceAssets')
KINDS = {'file', 'confirmation'}


class NodeParametersConflict(ValueError):
    pass


def stored_parameters(connection, flow_id):
    row = connection.execute('SELECT draft_config FROM flows WHERE id = ?', (flow_id,)).fetchone()
    return json.loads(row['draft_config']).get(KEY, {}) if row else {}


def apply_node_parameters(connection, flow_id, config):
    entries = stored_parameters(connection, flow_id)
    config.pop(KEY, None)
    for node in config.get('nodes', []):
        if node.get('kind') in KINDS and node['id'] in entries:
            node.update(copy.deepcopy(entries[node['id']]['params']))
            node.pop('referenceAsset', None)


def stored_draft(connection, flow_id, config):
    result = copy.deepcopy(config)
    result.pop(KEY, None)
    entries = stored_parameters(connection, flow_id)
    if entries:
        result[KEY] = entries
    return json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def published_node(connection, flow_id, node_key, teacher_id, kind):
    from app.repositories.flow_runtime_state import version_config
    version = connection.execute('''SELECT v.id FROM flow_versions v JOIN flows f ON f.id = v.flow_id
        WHERE f.id = ? AND f.owner_id = ? AND f.status != 'archived' AND v.status = 'published'
        ORDER BY v.version_no DESC LIMIT 1''', (flow_id, str(teacher_id))).fetchone()
    if version:
        config = version_config(connection, version['id'])
        for node in config['nodes']:
            if node['id'] == node_key and node.get('kind') == kind:
                return config, node
    raise KeyError(node_key)


def parameter_view(connection, flow_id, node):
    return {'generation': stored_parameters(connection, flow_id).get(node['id'], {}).get('generation', 0),
            'params': {'title': node['title'], 'requirement': node.get('requirement') or '',
                       'startAt': node.get('startAt') or '', 'deadlineAt': node.get('deadlineAt') or '',
                       'referenceAssets': reference_assets(node),
                       **({'fileLimitMb': str(node.get('fileLimitMb', '20'))} if node['kind'] == 'file' else {})}}


def get_node_parameters(flow_id, node_key, teacher_id, kind):
    with get_connection() as connection:
        _, node = published_node(connection, flow_id, node_key, teacher_id, kind)
        return parameter_view(connection, flow_id, node)


def update_node_parameters(flow_id, node_key, teacher_id, expected_generation, params, kind):
    from app.repositories.flow_templates import validate_version_templates
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute('BEGIN IMMEDIATE')
        config, node = published_node(connection, flow_id, node_key, teacher_id, kind)
        before = parameter_view(connection, flow_id, node)
        if before['generation'] != expected_generation:
            raise NodeParametersConflict('节点配置已变化，请重新打开后再保存')
        if set(params) != (set(FIELDS) | ({'fileLimitMb'} if kind == 'file' else set())):
            raise ValueError('节点参数不完整或包含不可修改项')
        if params == before['params']:
            return before
        if kind == 'file' and not 0.1 <= float(params['fileLimitMb']) <= 300:
            raise ValueError('文件大小上限须为 0.1–300 MB')
        node.update(params)
        node.pop('referenceAsset', None)
        validate_flow_config(config)
        validate_version_templates(connection, flow_id, config)
        draft = json.loads(connection.execute('SELECT draft_config FROM flows WHERE id = ?', (flow_id,)).fetchone()['draft_config'])
        after = {'generation': before['generation'] + 1, 'params': params}
        draft.setdefault(KEY, {})[node_key] = after
        for item in draft['nodes']:
            if item['id'] == node_key:
                item.update(params)
                item.pop('referenceAsset', None)
        connection.execute('UPDATE flows SET draft_config = ?, updated_at = ? WHERE id = ?',
                           (json.dumps(draft, ensure_ascii=False), now, flow_id))
        connection.execute('''INSERT INTO audit_logs
            (actor_id, action, entity_type, entity_id, before_data, after_data, created_at)
            VALUES (?, 'node_parameters_updated', 'flow_node', ?, ?, ?, ?)''',
            (str(teacher_id), f'{flow_id}:{node_key}', json.dumps(before, ensure_ascii=False),
             json.dumps(after, ensure_ascii=False), now))
        return after
