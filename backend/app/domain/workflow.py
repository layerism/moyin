from collections import defaultdict, deque
from datetime import UTC, datetime
from typing import Any


class FlowValidationError(ValueError):
    pass


def validate_flow_config(config: dict[str, Any]) -> None:
    nodes = config.get("nodes")
    edges = config.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        raise FlowValidationError("流程配置必须包含节点和连线数组")
    if not nodes:
        raise FlowValidationError("流程至少需要一个节点")

    node_ids = [node.get("id") for node in nodes if isinstance(node, dict)]
    if len(node_ids) != len(nodes) or any(not node_id for node_id in node_ids):
        raise FlowValidationError("每个节点必须具有稳定标识")
    if len(set(node_ids)) != len(node_ids):
        raise FlowValidationError("节点标识不能重复")

    for node in nodes:
        _validate_node_time_window(node)
        _validate_node_template(node)

    indegree = {node_id: 0 for node_id in node_ids}
    adjacency: dict[str, list[str]] = defaultdict(list)
    for edge in edges:
        if not isinstance(edge, dict):
            raise FlowValidationError("连线配置格式错误")
        source = edge.get("source")
        target = edge.get("target")
        if source not in indegree or target not in indegree or source == target:
            raise FlowValidationError("连线必须连接两个不同的有效节点")
        adjacency[source].append(target)
        indegree[target] += 1

    queue = deque(node_id for node_id, degree in indegree.items() if degree == 0)
    visited = 0
    while queue:
        node_id = queue.popleft()
        visited += 1
        for target in adjacency[node_id]:
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)
    if visited != len(node_ids):
        raise FlowValidationError("流程必须是无环图")


def _parse_node_time(value: object, label: str) -> datetime | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise FlowValidationError(f"{label}格式无效")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise FlowValidationError(f"{label}格式无效") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _validate_node_time_window(node: dict[str, Any]) -> None:
    start = _parse_node_time(node.get("startAt"), "起始时间")
    deadline = _parse_node_time(node.get("deadlineAt"), "截止时间")
    if start is not None and deadline is not None and start >= deadline:
        raise FlowValidationError("起始时间必须早于截止时间")


def _validate_node_template(node: dict[str, Any]) -> None:
    template = node.get("templateAsset")
    if template is None:
        return
    if node.get("kind") != "file":
        raise FlowValidationError("只有文件节点可以配置模板")
    if not isinstance(template, dict):
        raise FlowValidationError("模板元数据格式错误")
    required = {"assetId", "contentType", "originalName", "sha256", "sizeBytes"}
    if set(template) != required or any(template.get(key) in (None, "") for key in required):
        raise FlowValidationError("模板元数据不完整")
    if not isinstance(template["sizeBytes"], int) or template["sizeBytes"] < 0:
        raise FlowValidationError("模板大小信息无效")
