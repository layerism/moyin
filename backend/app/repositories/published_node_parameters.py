"""Published parameter API backed directly by workflow nodes."""
import copy
import json

from app.core.database import get_connection
from app.domain.node_assets import reference_assets
from app.domain.workflow import validate_flow_config
from app.services.security import utc_now_iso

from app.domain.node_configuration import FIELDS, META_KEY, apply_current_parameters
from app.repositories.node_configuration import current_config, current_node, node_metadata, save_node


class NodeParametersConflict(ValueError):
    pass


def apply_node_parameters(connection, flow_id, config, *, version_id=None, preview=False):
    if preview:
        return
    current = {n['id']: n for n in current_config(connection, flow_id).get('nodes', [])}
    if version_id is None:
        published_ids = {row[0] for row in connection.execute(
            """SELECT json_extract(n.value, '$.id') FROM flow_versions v,
               json_each(v.config_snapshot, '$.nodes') n
               WHERE v.flow_id = ? AND v.status = 'published'""", (flow_id,))}
    else:
        published_ids = {n['id'] for n in config.get('nodes', [])}
    for node in config.get('nodes', []):
        node.pop(META_KEY, None)
        if node['id'] in published_ids and node['id'] in current:
            apply_current_parameters(node, current[node['id']])


def stored_draft(connection, flow_id, config):
    result = copy.deepcopy(config)
    current = {n['id']: n for n in current_config(connection, flow_id).get('nodes', [])}
    for node in result.get('nodes', []):
        node.pop(META_KEY, None)
        if META_KEY in current.get(node['id'], {}):
            node[META_KEY] = copy.deepcopy(current[node['id']][META_KEY])
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
    params = {field: node.get(field) or '' for field in FIELDS[node['kind']]}
    if 'referenceAssets' in params:
        params['referenceAssets'] = reference_assets(node)
    if 'fileLimitMb' in params:
        params['fileLimitMb'] = str(node.get('fileLimitMb', '20'))
    return {'generation': node_metadata(current_node(connection, flow_id, node['id']), 'parameters')['generation'],
            'params': params}


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
        if set(params) != set(FIELDS[kind]):
            raise ValueError('节点参数不完整或包含不可修改项')
        if params == before['params']:
            return before
        if kind == 'file' and not 0.1 <= float(params['fileLimitMb']) <= 300:
            raise ValueError('文件大小上限须为 0.1–300 MB')
        node.update(params)
        node.pop('referenceAsset', None)
        validate_flow_config(config)
        if kind != 'form':
            validate_version_templates(connection, flow_id, config)
        if kind == 'announcement':
            from app.repositories.flow_content_assets import validate_content_assets
            from app.repositories.flow_announcement_files import validate_announcement_files
            validate_content_assets(connection, flow_id, config)
            validate_announcement_files(connection, flow_id, config)
        after = {'generation': before['generation'] + 1, 'params': params}
        save_node(connection, flow_id, node_key, params, 'parameters', teacher_id,
                  after['generation'], now=now)
        connection.execute('''INSERT INTO audit_logs
            (actor_id, action, entity_type, entity_id, before_data, after_data, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)''',
            (str(teacher_id), 'form_parameters_updated' if kind == 'form' else 'node_parameters_updated',
             'node_form_parameters' if kind == 'form' else 'flow_node',
             f'{flow_id}:{node_key}', json.dumps(before, ensure_ascii=False),
             json.dumps(after, ensure_ascii=False), now))
        return after
