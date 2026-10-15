"""Transactional persistence for the single current node configuration."""
import json

from app.domain.node_configuration import META_KEY
from app.services.security import utc_now_iso


def current_config(connection, flow_id):
    row = connection.execute('SELECT draft_config FROM flows WHERE id = ?', (flow_id,)).fetchone()
    if row is None:
        raise KeyError(flow_id)
    return json.loads(row['draft_config'])


def current_node(connection, flow_id, node_key):
    node = next((n for n in current_config(connection, flow_id).get('nodes', []) if n['id'] == node_key), None)
    if node is None:
        raise KeyError(node_key)
    return node


def node_metadata(node, scope):
    default = 0 if scope == 'parameters' else 1
    return node.get(META_KEY, {}).get(scope, {'generation': default, 'updatedAt': None})


def save_node(connection, flow_id, node_key, patch, scope, actor_id, generation, *, now=None):
    """Call inside the caller's write transaction; never accept client metadata."""
    now = now or utc_now_iso()
    config = current_config(connection, flow_id)
    node = next((n for n in config['nodes'] if n['id'] == node_key), None)
    if node is None:
        raise KeyError(node_key)
    node.update(patch)
    if 'referenceAssets' in patch:
        node.pop('referenceAsset', None)
    node.setdefault(META_KEY, {})[scope] = {
        'generation': generation, 'updatedBy': actor_id, 'updatedAt': now,
    }
    connection.execute('UPDATE flows SET draft_config = ?, updated_at = ? WHERE id = ?',
                       (json.dumps(config, ensure_ascii=False, sort_keys=True, separators=(',', ':')), now, flow_id))
    return node
