"""Published mutable node parameters stored separately from nodes in the existing JSON document."""
import copy
import json

from app.core.database import get_connection
from app.domain.node_assets import reference_assets
from app.domain.workflow import validate_flow_config
from app.services.security import utc_now_iso

KEY = 'publishedNodeParameters'
BASE_FIELDS = ('title', 'requirement')
TIMED_FIELDS = (*BASE_FIELDS, 'startAt', 'deadlineAt')
FIELDS = {
    'form': TIMED_FIELDS,
    'file': (*TIMED_FIELDS, 'referenceAssets', 'fileLimitMb'),
    'confirmation': (*TIMED_FIELDS, 'referenceAssets'),
    'answer_sheet': TIMED_FIELDS,
    'announcement': TIMED_FIELDS,
    'or_gate': BASE_FIELDS,
}
KINDS = set(FIELDS)


class NodeParametersConflict(ValueError):
    pass


def stored_parameters(connection, flow_id):
    row = connection.execute('SELECT draft_config FROM flows WHERE id = ?', (flow_id,)).fetchone()
    return json.loads(row['draft_config']).get(KEY, {}) if row else {}


def apply_node_parameters(connection, flow_id, config, *, version_id=None, preview=False):
    entries = stored_parameters(connection, flow_id)
    config.pop(KEY, None)
    for node in config.get('nodes', []):
        entry = entries.get(node['id'], {})
        if version_id:
            override = entry.get('versionOverrides', {}).get(version_id, {})
            node.update(copy.deepcopy(override.get('params', {})))
        if not preview and node.get('kind') in KINDS and entry:
            node.update(copy.deepcopy(entry.get('params', {})))
            if 'referenceAssets' in entry.get('params', {}):
                node.pop('referenceAsset', None)


def stored_draft(connection, flow_id, config):
    result = copy.deepcopy(config)
    result.pop(KEY, None)
    entries = stored_parameters(connection, flow_id)
    if entries:
        result[KEY] = entries
    return json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def remove_version_parameters(connection, version_id):
    row = connection.execute('''SELECT f.id, f.draft_config FROM flows f
        JOIN flow_versions v ON v.flow_id = f.id WHERE v.id = ?''', (version_id,)).fetchone()
    if row is None:
        return
    draft = json.loads(row['draft_config'])
    entries = draft.get(KEY, {})
    changed = False
    for node_key, entry in list(entries.items()):
        versions = entry.get('versionOverrides', {})
        if version_id not in versions:
            continue
        del versions[version_id]
        changed = True
        if not versions:
            entry.pop('versionOverrides')
            if not entry.get('params') and entry.get('generation', 0) == 0:
                del entries[node_key]
    if changed:
        connection.execute('UPDATE flows SET draft_config = ? WHERE id = ?',
                           (json.dumps(draft, ensure_ascii=False), row['id']))


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
    return {'generation': stored_parameters(connection, flow_id).get(node['id'], {}).get('generation', 0),
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
        draft = json.loads(connection.execute('SELECT draft_config FROM flows WHERE id = ?', (flow_id,)).fetchone()['draft_config'])
        after = {'generation': before['generation'] + 1, 'params': params}
        entries = draft.setdefault(KEY, {})
        entries[node_key] = {**entries.get(node_key, {}), **after,
                             'updatedBy': teacher_id, 'updatedAt': now}
        for item in draft['nodes']:
            if item['id'] == node_key:
                item.update(params)
                item.pop('referenceAsset', None)
        connection.execute('UPDATE flows SET draft_config = ?, updated_at = ? WHERE id = ?',
                           (json.dumps(draft, ensure_ascii=False), now, flow_id))
        connection.execute('''INSERT INTO audit_logs
            (actor_id, action, entity_type, entity_id, before_data, after_data, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)''',
            (str(teacher_id), 'form_parameters_updated' if kind == 'form' else 'node_parameters_updated',
             'node_form_parameters' if kind == 'form' else 'flow_node',
             f'{flow_id}:{node_key}', json.dumps(before, ensure_ascii=False),
             json.dumps(after, ensure_ascii=False), now))
        return after
