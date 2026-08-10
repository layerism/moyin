from collections import defaultdict, deque
from datetime import UTC, datetime
from typing import Any

from app.domain.form_fields import FormFieldConfigError, validate_form_config


class FlowValidationError(ValueError):
    pass


def confirmation_requires_scans(node: dict[str, Any]) -> bool:
    return node.get("kind") == "confirmation" and node.get("templateAsset") is not None


def validate_flow_config(
    config: dict[str, Any], *, require_publishable: bool = False
) -> None:
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
        _validate_confirmation_scan(node, require_publishable=require_publishable)
        _validate_node_template(node)
        try:
            validate_form_config(node)
        except FormFieldConfigError as exc:
            raise FlowValidationError(str(exc)) from exc

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
    is_file = node.get("kind") == "file"
    is_scan_confirmation = node.get("kind") == "confirmation"
    if not (is_file or is_scan_confirmation):
        raise FlowValidationError("当前节点不能配置模板")
    if not isinstance(template, dict):
        raise FlowValidationError("模板元数据格式错误")
    required = {"assetId", "contentType", "originalName", "sha256", "sizeBytes"}
    if set(template) != required or any(template.get(key) in (None, "") for key in required):
        raise FlowValidationError("模板元数据不完整")
    if not isinstance(template["sizeBytes"], int) or template["sizeBytes"] < 0:
        raise FlowValidationError("模板大小信息无效")
    if is_scan_confirmation and not str(template["originalName"]).lower().endswith(".docx"):
        raise FlowValidationError("确认承诺模板必须为 DOCX 文件")


def _validate_confirmation_scan(
    node: dict[str, Any], *, require_publishable: bool
) -> None:
    enabled = node.get("scanAuditEnabled", False)
    if not isinstance(enabled, bool):
        raise FlowValidationError("扫描审核开关格式无效")
    if enabled and node.get("kind") != "confirmation":
        raise FlowValidationError("只有确认承诺节点可以启用扫描审核")
    if not enabled:
        return
    mode = node.get("scanAuditMode")
    if mode is not None and mode not in {"pass_fail", "score"}:
        raise FlowValidationError("请选择扫描审核模式")
    prompt = node.get("scanAuditPrompt")
    if prompt is not None and not isinstance(prompt, str):
        raise FlowValidationError("扫描审核标准格式无效")
    if isinstance(prompt, str) and len(prompt) > 2000:
        raise FlowValidationError("扫描审核标准不能超过 2000 字")
    if require_publishable:
        if mode not in {"pass_fail", "score"}:
            raise FlowValidationError("请选择扫描审核模式")
        if not isinstance(prompt, str) or not prompt.strip():
            raise FlowValidationError("请填写扫描审核标准")
        if not node.get("templateAsset"):
            raise FlowValidationError("请上传 DOCX 签署文件模板")
