"""Published mutable fields; values live only on the workflow node."""
import copy

from app.domain.file_review_steps import structured_steps

META_KEY = '_configMeta'
ANSWER_KEY = 'answerSheetKey'
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
# Branch labels still use the existing revision/publish path.
REVISION_FIELDS = {**FIELDS, 'branch': TIMED_FIELDS}
AUDIT_FIELDS = ('auditScriptParams', 'auditModelCardId')


def copy_fields(target, source, fields):
    for field in fields:
        target.pop(field, None)
        if field in source:
            target[field] = copy.deepcopy(source[field])


def step_structure(node):
    return [(step['id'], step['kind'], step.get('auditScriptId'))
            for step in node.get('fileReviewSteps', []) if isinstance(step, dict)]


def apply_current_parameters(node, current):
    """Retain the version's identity and structure; overlay only mutable values."""
    if node.get('kind') != current.get('kind'):
        return
    copy_fields(node, current, FIELDS.get(node.get('kind'), ()))
    if 'referenceAssets' in current:
        node.pop('referenceAsset', None)
    elif 'referenceAsset' in current and node.get('kind') in {'file', 'confirmation'}:
        node['referenceAsset'] = copy.deepcopy(current['referenceAsset'])
    if node.get('auditScriptId') and node.get('auditScriptId') == current.get('auditScriptId'):
        copy_fields(node, current, AUDIT_FIELDS)
        if node.get('kind') == 'confirmation':
            copy_fields(node, current, ('scanAuditMode', 'scanAuditPrompt', 'scanAuditThreshold'))
    if structured_steps(node) and step_structure(node) == step_structure(current):
        for step, latest in zip(node['fileReviewSteps'], current['fileReviewSteps']):
            if step['kind'] != 'manual':
                copy_fields(step, latest, AUDIT_FIELDS)
    copy_fields(node, current, (META_KEY,))


def public_config(config):
    result = copy.deepcopy(config)
    for node in result.get('nodes', []):
        node.pop(META_KEY, None)
        node.pop(ANSWER_KEY, None)
    return result
