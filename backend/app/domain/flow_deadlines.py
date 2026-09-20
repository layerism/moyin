from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta


def resolve_deadlines(config: dict) -> dict[str, str | None]:
    """Derive deadlines without turning inherited values into explicit settings."""
    nodes = {node['id']: node for node in config['nodes']}
    parents = defaultdict(list)
    children = defaultdict(list)
    for edge in config['edges']:
        if edge['source'] in nodes and edge['target'] in nodes:
            parents[edge['target']].append(edge['source'])
            children[edge['source']].append(edge['target'])
    indegree = {key: len(parents[key]) for key in nodes}
    queue = deque(key for key in nodes if not indegree[key])
    resolved: dict[str, datetime | None] = {}
    while queue:
        key = queue.popleft()
        node = nodes[key]
        upstream = [resolved[parent] for parent in parents[key] if resolved.get(parent)]
        inherited = max(upstream) if upstream else None
        if node.get('kind') == 'branch':
            resolved[key] = inherited
        elif node.get('deadlineAt'):
            value = datetime.fromisoformat(node['deadlineAt'].replace('Z', '+00:00'))
            resolved[key] = value.replace(tzinfo=UTC) if value.tzinfo is None else value
        else:
            resolved[key] = inherited + timedelta(days=5) if inherited else None
        for child in children[key]:
            indegree[child] -= 1
            if not indegree[child]:
                queue.append(child)
    return {key: value.isoformat() if value else None for key, value in resolved.items()}
