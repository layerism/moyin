"""Resolve selected routes from immutable configuration and current submissions."""
import json
from collections import deque


def resolve_routes(connection, instance_id, config):
    rows = connection.execute(
        """SELECT n.node_key, n.status, s.payload_snapshot
           FROM node_instances n LEFT JOIN submissions s
             ON s.node_instance_id = n.id AND s.attempt_no = n.attempt_no
           WHERE n.flow_instance_id = ?""", (instance_id,),
    ).fetchall()
    nodes = {node['id']: node for node in config['nodes']}
    statuses = {row['node_key']: row['status'] for row in rows}
    choices = {row['node_key']: json.loads(row['payload_snapshot']).get('branchId')
               for row in rows if nodes.get(row['node_key'], {}).get('kind') == 'branch'
               and row['status'] == 'approved' and row['payload_snapshot']}
    incoming = {key: [] for key in nodes}
    outgoing = {key: [] for key in nodes}
    for edge in config['edges']:
        incoming[edge['target']].append(edge)
        outgoing[edge['source']].append(edge)
    degrees = {key: len(edges) for key, edges in incoming.items()}
    queue = deque(key for key, degree in degrees.items() if not degree)
    reachable = {}
    predecessors = {}
    while queue:
        key = queue.popleft()
        enabled = set()
        for edge in incoming[key]:
            source = edge['source']
            if not reachable[source]:
                continue
            if nodes[source].get('kind') == 'branch' and source in choices:
                if edge.get('sourcePort') != f"branch:{choices[source]}":
                    continue
            enabled.add(source)
        predecessors[key] = enabled
        reachable[key] = not incoming[key] or bool(enabled)
        for edge in outgoing[key]:
            degrees[edge['target']] -= 1
            if degrees[edge['target']] == 0:
                queue.append(edge['target'])
    skipped = {key for key, possible in reachable.items() if not possible}
    ready = {key for key in nodes if key not in skipped
             and all(statuses.get(source) == 'approved' for source in predecessors[key])}
    return predecessors, skipped, ready


def node_is_ready(connection, instance_id, config, node_key):
    return node_key in resolve_routes(connection, instance_id, config)[2]


def sync_branch_states(connection, instance_id, config):
    if not any(node.get('kind') == 'branch' for node in config['nodes']):
        return
    _, skipped, _ = resolve_routes(connection, instance_id, config)
    rows = connection.execute(
        'SELECT id, node_key, status FROM node_instances WHERE flow_instance_id = ?',
        (instance_id,),
    ).fetchall()
    for row in rows:
        if row['node_key'] in skipped and row['status'] != 'skipped':
            connection.execute("UPDATE node_instances SET status = 'skipped' WHERE id = ?", (row['id'],))
        elif row['node_key'] not in skipped and row['status'] == 'skipped':
            connection.execute("UPDATE node_instances SET status = 'locked' WHERE id = ?", (row['id'],))
