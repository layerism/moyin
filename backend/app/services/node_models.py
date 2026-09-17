"""Node model references; credentials remain in publisher-owned model cards."""
import json
from datetime import UTC, datetime

from app.core.database import get_connection
from app.domain.workflow import FlowValidationError
from app.services.audit_model_connections import SCRIPT_PROVIDERS


def node_model_script(node: dict) -> str | None:
    if node.get("kind") == "confirmation":
        return "confirmation-visual-audit" if node.get("scanAuditEnabled") else None
    return node.get("auditScriptId")


def validate_node_model(connection, owner_id: str, script_id: str | None, card_id: object) -> None:
    if card_id is None or card_id == "":
        return
    if script_id not in SCRIPT_PROVIDERS:
        raise ValueError("该节点审核脚本不使用大模型")
    if not isinstance(card_id, str) or len(card_id) > 64:
        raise ValueError("模型卡编号无效")
    card = connection.execute(
        "SELECT api_url, encrypted_api_key, model FROM audit_model_cards WHERE id = ? AND CAST(owner_teacher_id AS TEXT) = ?",
        (card_id, str(owner_id)),
    ).fetchone()
    if card is None or not all(card):
        raise ValueError("请选择流程发布者本人已完整配置的模型卡")


def published_node_models(connection, flow_id: str) -> dict[str, str | None]:
    return {row["node_key"]: row["model_card_id"] for row in connection.execute(
        """SELECT p.node_key, p.model_card_id FROM node_audit_policies p
           WHERE p.flow_id = ? AND EXISTS (
             SELECT 1 FROM flow_versions v, json_each(v.config_snapshot, '$.nodes') n
             WHERE v.flow_id = p.flow_id AND v.status = 'published'
               AND json_extract(n.value, '$.id') = p.node_key
           )""", (flow_id,)
    )}


def apply_published_node_models(connection, flow_id: str, config: dict) -> None:
    models = published_node_models(connection, flow_id)
    for node in config.get("nodes", []):
        if node["id"] in models:
            node.pop("auditModelCardId", None)
            if models[node["id"]]:
                node["auditModelCardId"] = models[node["id"]]


def validate_flow_models(connection, flow_id: str, config: dict, *, require_configured: bool = False) -> None:
    owner = connection.execute("SELECT owner_id FROM flows WHERE id = ?", (flow_id,)).fetchone()
    published = published_node_models(connection, flow_id)
    from app.domain.file_review_steps import review_config_nodes
    for node in review_config_nodes(config):
        script_id = node_model_script(node)
        card_id = node.get("auditModelCardId")
        try:
            validate_node_model(connection, owner["owner_id"], script_id, card_id)
        except ValueError as exc:
            raise FlowValidationError(f"{node.get('title', node['id'])}：{exc}") from exc
        if require_configured and script_id in SCRIPT_PROVIDERS and not card_id and (node.get("_fileReviewStep") or node["id"] not in published):
            raise FlowValidationError(f"请为节点“{node.get('title', node['id'])}”选择自己的审核模型")
    # Published models are changed only through the versioned audit-policy endpoint.
    apply_published_node_models(connection, flow_id, config)


def model_node_usages(connection, owner_id: int) -> list[dict]:
    usages = {}
    for flow in connection.execute("SELECT id, name, draft_config FROM flows WHERE owner_id = ?", (str(owner_id),)):
        nodes = {node["id"]: node for node in json.loads(flow["draft_config"]).get("nodes", [])}
        references = [(key, node.get("auditModelCardId")) for key, node in nodes.items()]
        references.extend((key, step.get("auditModelCardId")) for key, node in nodes.items()
                          for step in node.get("fileReviewSteps", []) if isinstance(step, dict))
        for version in connection.execute("SELECT config_snapshot FROM flow_versions WHERE flow_id = ?", (flow["id"],)):
            references.extend((node["id"], step.get("auditModelCardId")) for node in json.loads(version["config_snapshot"]).get("nodes", [])
                              for step in node.get("fileReviewSteps", []) if isinstance(step, dict))
        references.extend((row["node_key"], row["model_card_id"]) for row in connection.execute(
            "SELECT node_key, model_card_id FROM node_audit_policies WHERE flow_id = ?", (flow["id"],)
        ))
        for node_key, card_id in references:
            if card_id:
                key = (flow["id"], node_key, card_id)
                usages[key] = {"flowId": flow["id"], "nodeKey": node_key, "cardId": card_id,
                               "name": f"{flow['name']} · {nodes.get(node_key, {}).get('title', node_key)}"}
    return list(usages.values())


def initialize_node_models() -> None:
    from app.repositories.audit_policies import policy_hash, sync_published_audit_policies
    migration_id = "20260914_node_model_selection"
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        if connection.execute("SELECT 1 FROM schema_migrations WHERE id = ?", (migration_id,)).fetchone():
            return
        connection.execute("ALTER TABLE node_audit_policies ADD COLUMN model_card_id TEXT REFERENCES audit_model_cards(id) ON DELETE RESTRICT")
        now = datetime.now(UTC).isoformat()
        # Populate missing effective policies without changing immutable published snapshots.
        for row in connection.execute("""SELECT * FROM flow_versions v WHERE status = 'published'
            AND version_no = (SELECT MAX(version_no) FROM flow_versions WHERE flow_id = v.flow_id AND status = 'published')""").fetchall():
            sync_published_audit_policies(connection, row["flow_id"], json.loads(row["config_snapshot"]), int(row["published_by"]), now)
        connection.execute("""UPDATE node_audit_policies SET model_card_id = (
            SELECT b.card_id FROM audit_model_bindings b JOIN flows f ON f.id = node_audit_policies.flow_id
            WHERE CAST(b.owner_teacher_id AS TEXT) = f.owner_id AND b.script_id = node_audit_policies.script_id
        )""")
        for flow in connection.execute("SELECT id, owner_id, draft_config FROM flows").fetchall():
            bindings = {row["script_id"]: row["card_id"] for row in connection.execute(
                "SELECT script_id, card_id FROM audit_model_bindings WHERE CAST(owner_teacher_id AS TEXT) = ?", (flow["owner_id"],)
            )}
            config = json.loads(flow["draft_config"])
            for node in config.get("nodes", []):
                card_id = bindings.get(node_model_script(node))
                node.pop("auditModelCardId", None)
                if card_id:
                    node["auditModelCardId"] = card_id
            connection.execute("UPDATE flows SET draft_config = ? WHERE id = ?", (json.dumps(config, ensure_ascii=False), flow["id"]))
        # This is an equivalent binding migration, not a policy change. Keep matching
        # queued jobs on the same generation while updating the hash representation.
        for policy in connection.execute("SELECT * FROM node_audit_policies").fetchall():
            next_hash = policy_hash(policy["script_id"], json.loads(policy["params_json"]), policy["model_card_id"])
            connection.execute("UPDATE audit_jobs SET policy_hash = ? WHERE flow_id = ? AND node_key = ? AND policy_generation = ? AND policy_hash = ? AND status IN ('pending', 'running')",
                               (next_hash, policy["flow_id"], policy["node_key"], policy["generation"], policy["policy_hash"]))
            connection.execute("UPDATE node_audit_policies SET policy_hash = ? WHERE flow_id = ? AND node_key = ?",
                               (next_hash, policy["flow_id"], policy["node_key"]))
        connection.execute("DELETE FROM audit_model_bindings")
        connection.execute("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", (migration_id, now))
