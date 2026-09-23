from collections import defaultdict, deque
from datetime import UTC, datetime
from typing import Any

from app.domain.answer_sheet import AnswerSheetConfigError, validate_public_answer_sheet
from app.domain.node_assets import reference_assets
from app.domain.flow_deadlines import resolve_deadlines
from app.domain.form_fields import FormFieldConfigError, validate_form_config


class FlowValidationError(ValueError):
    pass


def confirmation_requires_scans(node: dict[str, Any]) -> bool:
    return node.get("kind") == "confirmation" and (
        node.get("templateAsset") is not None
        or node.get("scanAuditEnabled") is True
        or bool(node.get("fileReviewSteps"))
    )


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
        if node.get("kind") not in {"branch", "announcement", "answer_sheet", "confirmation", "file", "form"}:
            raise FlowValidationError("不支持的节点类型，请使用文件上传节点配置人工审核")
        if "fileReviewSteps" in node:
            from app.domain.file_review_steps import validate_steps
            try:
                validate_steps(node, require_publishable)
            except ValueError as exc:
                raise FlowValidationError(str(exc)) from exc
        _validate_node_time_window(node)
        _validate_confirmation_scan(node, require_publishable=require_publishable)
        _validate_node_template(node)
        if "referenceAssets" in node and (
            not isinstance(node["referenceAssets"], list)
            or any(not isinstance(asset, dict) for asset in node["referenceAssets"])
        ):
            raise FlowValidationError("填写参考必须为文件列表")
        for reference in reference_assets(node):
            if node.get("kind") not in {"file", "confirmation"}:
                raise FlowValidationError("只有文件或视觉审核节点可以配置参考材料")
            _validate_node_template({**node, "templateAsset": reference}, reference=True)
        try:
            validate_form_config(node)
        except FormFieldConfigError as exc:
            raise FlowValidationError(str(exc)) from exc

    branch_options = {}
    for node in nodes:
        if node.get("kind") != "branch":
            continue
        options = node.get("branches")
        if not isinstance(options, list) or len(options) < 2:
            raise FlowValidationError("条件分支至少需要两个选项")
        if any(not isinstance(option, dict) or not isinstance(option.get("id"), str)
               or not option["id"] or not isinstance(option.get("label"), str)
               or (require_publishable and not option["label"].strip()) for option in options):
            raise FlowValidationError("请填写有效的分支选项")
        ids = {option["id"] for option in options}
        if len(ids) != len(options):
            raise FlowValidationError("分支选项标识不能重复")
        if node.get("auditScriptId") or node.get("scanAuditEnabled") or node.get("autoApprove") is False:
            raise FlowValidationError("条件分支提交后自动生效，不支持审核配置")
        branch_options[node["id"]] = {f"branch:{key}" for key in ids}

    indegree = {node_id: 0 for node_id in node_ids}
    adjacency: dict[str, list[str]] = defaultdict(list)
    for edge in edges:
        if not isinstance(edge, dict):
            raise FlowValidationError("连线配置格式错误")
        source = edge.get("source")
        target = edge.get("target")
        if source not in indegree or target not in indegree or source == target:
            raise FlowValidationError("连线必须连接两个不同的有效节点")
        if source in branch_options and edge.get("sourcePort") not in branch_options[source]:
            raise FlowValidationError("请从条件分支的选项连接点连出")
        if source not in branch_options and str(edge.get("sourcePort", "")).startswith("branch:"):
            raise FlowValidationError("分支连接点只能用于条件分支")
        if target in branch_options and edge.get("targetPort") != "top":
            raise FlowValidationError("条件分支必须连接顶部输入点")
        if str(edge.get("targetPort", "")).startswith("branch:"):
            raise FlowValidationError("分支输出点不能作为输入点")
        adjacency[source].append(target)
        indegree[target] += 1

    if require_publishable:
        for key, ports in branch_options.items():
            connected = {edge.get("sourcePort") for edge in edges if edge["source"] == key}
            if ports - connected:
                raise FlowValidationError("每个分支选项都需要连接下游节点")

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
    deadlines = resolve_deadlines(config)
    by_id = {node["id"]: node for node in nodes}
    for edge in edges:
        target = by_id[edge["target"]]
        if target.get("kind") == "branch":
            continue
        upstream = _parse_node_time(deadlines.get(edge["source"]), "上游截止时间")
        downstream = _parse_node_time(deadlines.get(edge["target"]), "截止时间")
        if upstream is not None and downstream is not None and downstream < upstream:
            raise FlowValidationError(f"节点“{target.get('title', target['id'])}”的截止时间不得早于上游截止时间")
    for node in nodes:
        resolved_node = {**node, "deadlineAt": deadlines.get(node["id"])}
        _validate_node_time_window(resolved_node)
        try:
            validate_public_answer_sheet(resolved_node, require_publishable=require_publishable)
        except AnswerSheetConfigError as exc:
            raise FlowValidationError(str(exc)) from exc


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
    if node.get("kind") == "branch":
        return
    start = _parse_node_time(node.get("startAt"), "起始时间")
    deadline = _parse_node_time(node.get("deadlineAt"), "截止时间")
    if start is not None and deadline is not None and start >= deadline:
        raise FlowValidationError("起始时间必须早于截止时间")


def _validate_node_template(node: dict[str, Any], *, reference: bool = False) -> None:
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
    if is_scan_confirmation and not reference and not str(template["originalName"]).lower().endswith(".docx"):
        raise FlowValidationError("确认承诺模板必须为 DOCX 文件")


def _validate_confirmation_scan(
    node: dict[str, Any], *, require_publishable: bool
) -> None:
    enabled = node.get("scanAuditEnabled", False)
    if not isinstance(enabled, bool):
        raise FlowValidationError("扫描审核开关格式无效")
    if enabled and node.get("kind") != "confirmation":
        raise FlowValidationError("只有确认承诺节点可以启用扫描审核")
    if node.get("kind") == "confirmation" and "fileReviewSteps" in node:
        if enabled:
            raise FlowValidationError("旧版扫描审核和审核步骤不能同时启用")
        return
    if not enabled:
        return
    mode = node.get("scanAuditMode")
    if mode is not None and mode not in {"pass_fail", "score"}:
        raise FlowValidationError("请选择扫描审核模式")
    threshold = node.get("scanAuditThreshold")
    if threshold is not None and (
        isinstance(threshold, bool)
        or not isinstance(threshold, int)
        or not 0 <= threshold <= 100
    ):
        raise FlowValidationError("评分通过阈值必须是 0–100 的整数")
    if mode == "score" and threshold is None:
        raise FlowValidationError("请填写评分通过阈值")
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
