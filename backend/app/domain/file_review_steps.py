"""Versioned, independently configured file review steps."""


def structured_steps(node):
    steps = node.get('fileReviewSteps')
    return isinstance(steps, list) and bool(steps) and isinstance(steps[0], dict)


def step_kind(step):
    return step.get('kind') if isinstance(step, dict) else step


def audit_step_node(node, step):
    return {**node, **step, 'id': node['id'], 'kind': 'file', 'fileReviewSteps': None, '_fileReviewStep': True}


def validate_steps(node, publishable):
    steps = node.get('fileReviewSteps')
    if not isinstance(steps, list) or node.get('kind') != 'file':
        raise ValueError('文件审核步骤配置无效')
    if not structured_steps(node):
        if any(step not in ('ai', 'manual') for step in steps) or len(steps) != len(set(steps)):
            raise ValueError('旧版审核步骤配置无效')
        if publishable and 'ai' in steps and not node.get('auditScriptId'):
            raise ValueError('请为 AI 审核选择审核脚本')
        if 'ai' not in steps and node.get('auditScriptId'):
            raise ValueError('未添加 AI 审核时不能保留审核脚本')
        return
    if node.get('auditScriptId'):
        raise ValueError('多步骤审核的脚本必须配置在各步骤内')
    ids = set()
    for step in steps:
        if not isinstance(step, dict) or step.get('kind') not in ('ai', 'score', 'manual'):
            raise ValueError('审核类型无效')
        key = step.get('id')
        if not isinstance(key, str) or not key or len(key) > 80 or key in ids:
            raise ValueError('审核步骤必须具有唯一标识')
        ids.add(key)
        if step['kind'] == 'manual':
            continue
        if publishable and not step.get('auditScriptId'):
            raise ValueError('请为每个 AI 审核步骤选择审核规则')
        if step['kind'] == 'ai' and step.get('auditScriptId') == 'document-score-audit':
            raise ValueError('请通过 AI 评分类型添加评分步骤')
        if step['kind'] == 'score':
            if step.get('auditScriptId') != 'document-score-audit':
                raise ValueError('评分步骤必须使用文档评分审核')
            params = step.get('auditScriptParams') or {}
            threshold = params.get('passThreshold')
            if isinstance(threshold, bool) or not isinstance(threshold, int) or not 0 <= threshold <= 100:
                raise ValueError('评分通过阈值必须是 0–100 的整数')


def review_config_nodes(config):
    """Flatten only for validation; these are not graph nodes or routing keys."""
    nodes = []
    for node in config.get('nodes', []):
        if structured_steps(node):
            nodes.extend(audit_step_node(node, step) for step in node['fileReviewSteps'] if step['kind'] != 'manual')
        else:
            nodes.append(node)
    return nodes
