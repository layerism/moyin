from collections.abc import Iterable
from typing import Any


class PublishedNodeDeletionError(ValueError):
    pass


class PublishedEdgeDeletionError(ValueError):
    pass


BUSINESS_NODE_FIELDS = (
    "kind",
    "title",
    "requirement",
    "infoFields",
    "fileExtensions",
    "fileLimitMb",
    "auditScriptId",
    "auditScriptVersion",
    "auditScriptHash",
    "auditScriptConfigHash",
    "auditScriptAcceptedExtensions",
    "auditScriptParams",
    "auditScriptType",
    "auditScriptName",
    "autoApprove",
)


def business_node_snapshot(node: dict[str, Any]) -> dict[str, Any]:
    return {field: node.get(field) for field in BUSINESS_NODE_FIELDS}


def predecessor_sets(config: dict[str, Any]) -> dict[str, set[str]]:
    result = {node["id"]: set() for node in config["nodes"]}
    for edge in config.get("edges", []):
        result[edge["target"]].add(edge["source"])
    return result


def reachable_successors(config: dict[str, Any], starts: set[str]) -> set[str]:
    outgoing = {node["id"]: set() for node in config["nodes"]}
    for edge in config.get("edges", []):
        outgoing[edge["source"]].add(edge["target"])

    visited = set(starts)
    pending = list(starts)
    while pending:
        for target in outgoing[pending.pop()]:
            if target not in visited:
                visited.add(target)
                pending.append(target)
    return visited


def analyze_revision(previous: dict, current: dict) -> dict[str, list[str]]:
    previous_nodes = {node["id"]: node for node in previous["nodes"]}
    current_nodes = {node["id"]: node for node in current["nodes"]}
    current_node_ids = [node["id"] for node in current["nodes"]]

    added = set(current_nodes) - set(previous_nodes)
    changed = {
        node_id
        for node_id in current_nodes.keys() & previous_nodes.keys()
        if business_node_snapshot(current_nodes[node_id])
        != business_node_snapshot(previous_nodes[node_id])
    }

    previous_predecessors = predecessor_sets(previous)
    current_predecessors = predecessor_sets(current)
    predecessor_changed = {
        node_id
        for node_id in current_nodes
        if current_predecessors[node_id] != previous_predecessors.get(node_id, set())
    }

    initial_impact = added | changed | predecessor_changed
    invalidated = reachable_successors(current, initial_impact)

    def in_current_order(node_ids: set[str]) -> list[str]:
        return [node_id for node_id in current_node_ids if node_id in node_ids]

    return {
        "addedNodeIds": in_current_order(added),
        "changedNodeIds": in_current_order(changed),
        "predecessorChangedNodeIds": in_current_order(predecessor_changed),
        "invalidatedNodeIds": in_current_order(invalidated),
    }


def assert_published_nodes_present(previous: dict, current: dict) -> None:
    assert_node_ids_present((node["id"] for node in previous["nodes"]), current)


def assert_published_edges_present(previous: dict, current: dict) -> None:
    assert_edge_keys_present(previous.get("edges", []), current)


def assert_node_ids_present(required_node_ids: Iterable[str], current: dict) -> None:
    nodes = current.get("nodes")
    current_node_ids = (
        {node.get("id") for node in nodes if isinstance(node, dict)}
        if isinstance(nodes, list)
        else set()
    )
    for node_id in required_node_ids:
        if node_id not in current_node_ids:
            raise PublishedNodeDeletionError(f"已发布节点不可删除：{node_id}")


def assert_edge_keys_present(required_edges: Iterable[dict], current: dict) -> None:
    edges = current.get("edges")
    current_edge_keys = (
        {
            (edge.get("source"), edge.get("target"))
            for edge in edges
            if isinstance(edge, dict)
        }
        if isinstance(edges, list)
        else set()
    )
    for edge in required_edges:
        edge_key = (edge.get("source"), edge.get("target"))
        if edge_key not in current_edge_keys:
            source, target = edge_key
            raise PublishedEdgeDeletionError(f"已发布连线不可删除：{source} → {target}")
