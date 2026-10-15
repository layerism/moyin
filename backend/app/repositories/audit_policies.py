import hashlib
import json

from app.core.database import get_connection
from app.services.audit_script_catalog import find_audit_script
from app.services.audit_script_parameters import default_script_settings, validate_script_params, validate_script_settings
from app.services.security import utc_now_iso


class AuditPolicyConflictError(ValueError):
    pass


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def policy_hash(script_id: str, params: dict[str, object], model_card_id: str | None = None) -> str:
    return hashlib.sha256(
        canonical_json({"scriptId": script_id, "params": params, "modelCardId": model_card_id}).encode("utf-8")
    ).hexdigest()


def resolve_effective_audit_policy(connection, flow_id: str, node_key: str, version_id: str | None = None) -> dict[str, object]:
    from app.repositories.node_configuration import current_node, node_metadata
    if version_id:
        from app.repositories.flow_runtime_state import version_config
        config = version_config(connection, version_id)
        node = next((n for n in config['nodes'] if n['id'] == node_key), None)
        if node is None:
            raise KeyError(node_key)
    else:
        node = current_node(connection, flow_id, node_key)
    script_id = node.get('auditScriptId')
    if not script_id:
        raise KeyError(node_key)
    params = dict(node.get('auditScriptParams') or {})
    metadata = node_metadata(node, 'audit')
    model_id = node.get('auditModelCardId') or None
    return {
        'flowId': flow_id, 'nodeKey': node_key, 'scriptId': script_id,
        'modelCardId': model_id, 'mode': params.get('scanAuditMode'),
        'prompt': params.get('scanAuditPrompt', ''), 'params': params,
        'generation': metadata['generation'],
        'policyHash': policy_hash(script_id, params, model_id),
        'updatedAt': metadata.get('updatedAt'),
    }


def resolve_effective_audit_binding(
    connection, flow_id: str, node_key: str, script_id: str, version_id: str | None = None,
) -> dict[str, object]:
    policy = resolve_effective_audit_policy(connection, flow_id, node_key, version_id)
    if policy["scriptId"] != script_id:
        raise AuditPolicyConflictError("当前节点审核脚本不一致，请重新提交")
    record = find_audit_script(script_id)
    state = connection.execute(
        "SELECT * FROM audit_script_runtime_states WHERE script_id = ?", (script_id,),
    ).fetchone()
    if state is None or state["status"] != "ready" or state["content_hash"] != record.content_hash:
        raise AuditPolicyConflictError("审核程序正在更新，请稍后重试")
    return {
        "scriptId": script_id,
        "scriptGeneration": int(state["generation"]),
        "scriptContentHash": state["content_hash"],
        "policyGeneration": int(policy["generation"]),
        "policyHash": policy["policyHash"],
        "modelCardId": policy["modelCardId"],
        "params": validate_script_params(record.config, policy["params"]),
        "settings": validate_script_settings(record.config, default_script_settings(record.config)),
    }


def get_node_audit_policy(flow_id: str, node_key: str, teacher_id: int) -> dict[str, object]:
    with get_connection() as connection:
        owner = connection.execute(
            "SELECT 1 FROM flows WHERE id = ? AND owner_id = ? AND status != 'archived'",
            (flow_id, str(teacher_id)),
        ).fetchone()
        if owner is None:
            raise KeyError(node_key)
        policy = resolve_effective_audit_policy(connection, flow_id, node_key)
    record = find_audit_script(str(policy["scriptId"]))
    return {**policy, "scriptName": record.name, "parameters": list(record.parameters)}


def update_node_audit_policy(
    flow_id: str,
    node_key: str,
    teacher_id: int,
    expected_generation: int,
    params: dict[str, object],
    model_card_id: str | None,
) -> dict[str, object]:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        owner = connection.execute(
            "SELECT 1 FROM flows WHERE id = ? AND owner_id = ? AND status != 'archived'",
            (flow_id, str(teacher_id)),
        ).fetchone()
        if owner is None:
            raise KeyError(node_key)
        policy = resolve_effective_audit_policy(connection, flow_id, node_key)
        if int(policy['generation']) != expected_generation:
            raise AuditPolicyConflictError("审核规则已被修改，请重新加载")
        record = find_audit_script(str(policy["scriptId"]))
        validated = validate_script_params(record.config, params)
        if validated.get("scanAuditMode") == "score":
            threshold = validated.get("scanAuditThreshold")
            if (
                isinstance(threshold, bool)
                or not isinstance(threshold, int)
                or not 0 <= threshold <= 100
            ):
                raise ValueError("评分通过阈值必须是 0–100 的整数")
        else:
            validated.pop("scanAuditThreshold", None)
        from app.services.node_models import validate_node_model
        validate_node_model(connection, str(teacher_id), record.id, model_card_id)
        version = connection.execute("SELECT config_snapshot FROM flow_versions WHERE flow_id = ? AND status = 'published' ORDER BY version_no DESC LIMIT 1", (flow_id,)).fetchone()
        live_review_node = bool(version and any(node['id'] == node_key and node.get('kind') in {'file', 'confirmation'}
                         for node in json.loads(version['config_snapshot'])['nodes']))
        next_hash = policy_hash(record.id, validated, model_card_id)
        changed = next_hash != policy["policyHash"]
        if changed:
            from app.repositories.node_configuration import save_node
            patch = {'auditScriptParams': validated, 'auditModelCardId': model_card_id}
            save_node(connection, flow_id, node_key, patch, 'audit', teacher_id,
                      expected_generation + 1, now=now)
            connection.execute("""INSERT INTO audit_logs
                (actor_id, action, entity_type, entity_id, before_data, after_data, created_at)
                VALUES (?, 'audit_policy_updated', 'flow_node', ?, ?, ?, ?)""",
                (str(teacher_id), f'{flow_id}:{node_key}', canonical_json(policy),
                 canonical_json({'generation': expected_generation + 1, **patch}), now))
    if not changed or live_review_node:
        return get_node_audit_policy(flow_id, node_key, teacher_id)
    from app.repositories.audit_jobs import cancel_audit_jobs_for_policy
    from app.services.audit_job_worker import signal_audit_job_cancellations

    signal_audit_job_cancellations(
        cancel_audit_jobs_for_policy(flow_id, node_key, "policy_updated")
    )
    return get_node_audit_policy(flow_id, node_key, teacher_id)
