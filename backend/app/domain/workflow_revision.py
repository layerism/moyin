from collections.abc import Iterable
from typing import Any


class PublishedNodeDeletionError(ValueError):
    pass


class PublishedEdgeDeletionError(ValueError):
    pass


class PublishedNodeMutationError(ValueError):
    pass


class PublishedEdgeMutationError(ValueError):
    pass


REVISION_EDITABLE_NODE_FIELDS = {"title", "requirement", "startAt", "deadlineAt"}


BUSINESS_NODE_FIELDS = (
    "kind",
    "title",
    "requirement",
    "startAt",
    "deadlineAt",
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


def _locked_node_snapshot(node: dict[str, Any]) -> dict[str, Any]:
    snapshot = {
        key: value for key, value in node.items() if key not in REVISION_EDITABLE_NODE_FIELDS
    }
    if snapshot.get("templateAsset") is None:
        snapshot.pop("templateAsset", None)
    return snapshot


def edge_key(edge: dict[str, Any]) -> tuple[object, object, object, object]:
    return (
        edge.get("source"),
        edge.get("target"),
        edge.get("sourcePort"),
        edge.get("targetPort"),
    )


def assert_valid_revision(previous: dict[str, Any] | None, current: dict[str, Any]) -> None:
    if previous is None:
        return
    assert_published_nodes_present(previous, current)
    previous_nodes = {node["id"]: node for node in previous["nodes"]}
    current_nodes = {node["id"]: node for node in current.get("nodes", [])}
    for node_id, previous_node in previous_nodes.items():
        if _locked_node_snapshot(previous_node) != _locked_node_snapshot(current_nodes[node_id]):
            raise PublishedNodeMutationError(f"已发布节点只能修改标题、描述和起止时间：{node_id}")

    previous_edges = {edge_key(edge) for edge in previous.get("edges", [])}
    current_edges = {edge_key(edge) for edge in current.get("edges", [])}
    missing = previous_edges - current_edges
    if missing:
        source, target, _, _ = next(iter(missing))
        raise PublishedEdgeDeletionError(f"已发布连线不可删除或改向：{source} → {target}")

    published_node_ids = set(previous_nodes)
    for edge in current.get("edges", []):
        if edge_key(edge) in previous_edges:
            continue
        if edge.get("source") in published_node_ids and edge.get("target") in published_node_ids:
            raise PublishedEdgeMutationError("新增连线必须至少连接一个新增节点")


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
