import hashlib
import json
from typing import Any

from app.core.database import get_connection
from app.services.audit_script_catalog import find_audit_script
from app.services.audit_script_parameters import validate_script_params
from app.services.security import utc_now_iso


class AuditPolicyConflictError(ValueError):
    pass


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def policy_hash(script_id: str, params: dict[str, object]) -> str:
    return hashlib.sha256(
        canonical_json({"scriptId": script_id, "params": params}).encode("utf-8")
    ).hexdigest()


def node_policy_values(node: dict[str, Any]) -> tuple[str, dict[str, object]] | None:
    script_id = node.get("auditScriptId")
    if not isinstance(script_id, str) or not script_id:
        return None
    params = dict(node.get("auditScriptParams") or {})
    if node.get("kind") == "confirmation":
        params["scanAuditMode"] = node.get("scanAuditMode")
        params["scanAuditPrompt"] = str(node.get("scanAuditPrompt") or "").strip()
    record = find_audit_script(script_id)
    return script_id, validate_script_params(record.config, params)


def sync_published_audit_policies(
    connection,
    flow_id: str,
    config: dict[str, Any],
    actor_id: int,
    now: str,
    existing_node_keys: set[str] | None = None,
) -> None:
    for node in config.get("nodes", []):
        values = node_policy_values(node)
        if values is None:
            continue
        script_id, params = values
        statement = """
            INSERT INTO node_audit_policies
                (flow_id, node_key, script_id, mode, prompt, params_json,
                 generation, policy_hash, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        """
        if existing_node_keys is None or str(node["id"]) in existing_node_keys:
            statement += " ON CONFLICT(flow_id, node_key) DO NOTHING"
        else:
            statement += """
                ON CONFLICT(flow_id, node_key) DO UPDATE SET
                    script_id = excluded.script_id,
                    mode = excluded.mode,
                    prompt = excluded.prompt,
                    params_json = excluded.params_json,
                    generation = CASE
                        WHEN node_audit_policies.policy_hash = excluded.policy_hash
                        THEN node_audit_policies.generation
                        ELSE node_audit_policies.generation + 1
                    END,
                    policy_hash = excluded.policy_hash,
                    updated_by = excluded.updated_by,
                    updated_at = excluded.updated_at
            """
        connection.execute(
            statement,
            (
                flow_id,
                node["id"],
                script_id,
                params.get("scanAuditMode"),
                params.get("scanAuditPrompt", ""),
                canonical_json(params),
                policy_hash(script_id, params),
                actor_id,
                now,
            ),
        )


def sync_preview_audit_policies(
    connection,
    flow_id: str,
    config: dict[str, Any],
    actor_id: int,
    now: str,
) -> None:
    published = connection.execute(
        """
        SELECT config_snapshot FROM flow_versions
        WHERE flow_id = ? AND status = 'published'
        ORDER BY version_no DESC LIMIT 1
        """,
        (flow_id,),
    ).fetchone()
    published_node_keys = {
        str(node["id"])
        for node in (json.loads(published["config_snapshot"]).get("nodes", []) if published else [])
        if node.get("auditScriptId")
    }
    sync_published_audit_policies(connection, flow_id, config, actor_id, now)
    for node in config.get("nodes", []):
        node_key = str(node["id"])
        if node_key in published_node_keys:
            continue
        values = node_policy_values(node)
        if values is None:
            continue
        script_id, params = values
        next_hash = policy_hash(script_id, params)
        connection.execute(
            """
            UPDATE node_audit_policies
            SET script_id = ?, mode = ?, prompt = ?, params_json = ?,
                generation = CASE WHEN policy_hash = ? THEN generation ELSE generation + 1 END,
                policy_hash = ?, updated_by = ?, updated_at = ?
            WHERE flow_id = ? AND node_key = ?
            """,
            (
                script_id,
                params.get("scanAuditMode"),
                params.get("scanAuditPrompt", ""),
                canonical_json(params),
                next_hash,
                next_hash,
                actor_id,
                now,
                flow_id,
                node_key,
            ),
        )


def synchronize_existing_audit_policies() -> None:
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        rows = connection.execute(
            """
            SELECT v.flow_id, v.config_snapshot, CAST(v.published_by AS INTEGER) AS actor_id,
                   v.published_at
            FROM flow_versions v
            WHERE v.status = 'published'
              AND v.version_no = (
                SELECT MAX(v2.version_no) FROM flow_versions v2
                WHERE v2.flow_id = v.flow_id AND v2.status = 'published'
              )
            """
        ).fetchall()
        for row in rows:
            sync_published_audit_policies(
                connection,
                str(row["flow_id"]),
                json.loads(row["config_snapshot"]),
                int(row["actor_id"]),
                str(row["published_at"]),
            )


def resolve_effective_audit_policy(connection, flow_id: str, node_key: str) -> dict[str, object]:
    row = connection.execute(
        "SELECT * FROM node_audit_policies WHERE flow_id = ? AND node_key = ?",
        (flow_id, node_key),
    ).fetchone()
    if row is None:
        raise AuditPolicyConflictError("当前节点审核规则不可用，请联系教师")
    return {
        "flowId": row["flow_id"],
        "nodeKey": row["node_key"],
        "scriptId": row["script_id"],
        "mode": row["mode"],
        "prompt": row["prompt"],
        "params": json.loads(row["params_json"]),
        "generation": int(row["generation"]),
        "policyHash": row["policy_hash"],
        "updatedAt": row["updated_at"],
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
) -> dict[str, object]:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        owner = connection.execute(
            "SELECT 1 FROM flows WHERE id = ? AND owner_id = ? AND status != 'archived'",
            (flow_id, str(teacher_id)),
        ).fetchone()
        row = connection.execute(
            "SELECT * FROM node_audit_policies WHERE flow_id = ? AND node_key = ?",
            (flow_id, node_key),
        ).fetchone()
        if owner is None or row is None:
            raise KeyError(node_key)
        if int(row["generation"]) != expected_generation:
            raise AuditPolicyConflictError("审核规则已被修改，请重新加载")
        record = find_audit_script(str(row["script_id"]))
        validated = validate_script_params(record.config, params)
        next_hash = policy_hash(record.id, validated)
        changed = next_hash != row["policy_hash"]
        if changed:
            connection.execute(
                """
                UPDATE node_audit_policies
                SET mode = ?, prompt = ?, params_json = ?, generation = generation + 1,
                    policy_hash = ?, updated_by = ?, updated_at = ?
                WHERE flow_id = ? AND node_key = ?
                """,
                (
                    validated.get("scanAuditMode"),
                    validated.get("scanAuditPrompt", ""),
                    canonical_json(validated),
                    next_hash,
                    teacher_id,
                    now,
                    flow_id,
                    node_key,
                ),
            )
    if not changed:
        return get_node_audit_policy(flow_id, node_key, teacher_id)
    from app.repositories.audit_jobs import cancel_audit_jobs_for_policy
    from app.services.audit_job_worker import signal_audit_job_cancellations

    signal_audit_job_cancellations(
        cancel_audit_jobs_for_policy(flow_id, node_key, "policy_updated")
    )
    return get_node_audit_policy(flow_id, node_key, teacher_id)
