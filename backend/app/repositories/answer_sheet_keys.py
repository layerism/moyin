import hashlib
import json
from typing import Any

from app.domain.answer_sheet import (
    AnswerSheetConfigError,
    validate_private_answer_key,
)
from app.domain.node_configuration import ANSWER_KEY, public_config
from app.repositories.node_configuration import current_config, node_metadata


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def grading_hash(value: object) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def get_draft_answer_keys(connection: Any, flow_id: str) -> dict[str, dict[str, Any]]:
    return {
        str(node["id"]): node[ANSWER_KEY]
        for node in current_config(connection, flow_id).get("nodes", [])
        if node.get("kind") == "answer_sheet" and ANSWER_KEY in node
    }


def set_answer_sheet_keys(config: dict[str, Any], keys: object, *, require_publishable: bool = False) -> None:
    """Attach validated private answers to the config that the caller will persist."""
    normalized = validate_answer_sheet_key_map(config, keys, require_publishable=require_publishable)
    for node in config.get("nodes", []):
        node.pop(ANSWER_KEY, None)
        if node.get("kind") == "answer_sheet":
            node[ANSWER_KEY] = normalized[str(node["id"])]


def validate_answer_sheet_key_map(
    config: dict[str, Any], keys: object, *, require_publishable: bool
) -> dict[str, dict[str, Any]]:
    if not isinstance(keys, dict):
        raise AnswerSheetConfigError("答题卡标准答案必须是对象")
    nodes = {
        str(node["id"]): node
        for node in config.get("nodes", [])
        if isinstance(node, dict) and node.get("kind") == "answer_sheet"
    }
    unknown = set(keys) - set(nodes)
    if unknown:
        raise AnswerSheetConfigError("标准答案对应的答题卡节点不存在")
    normalized: dict[str, dict[str, Any]] = {}
    for node_key, node in nodes.items():
        key = keys.get(node_key)
        if key is None:
            raise AnswerSheetConfigError(f"答题卡“{node.get('title') or node_key}”缺少标准答案配置")
        validate_private_answer_key(
            node, key, require_publishable=require_publishable
        )
        normalized[node_key] = dict(key)
    return normalized


def validate_publishable_answer_sheet_keys(
    connection: Any,
    flow_id: str,
    config: dict[str, Any],
    supplied_keys: object | None = None,
) -> dict[str, dict[str, Any]]:
    keys = (
        supplied_keys
        if supplied_keys is not None
        else get_draft_answer_keys(connection, flow_id)
    )
    return validate_answer_sheet_key_map(config, keys, require_publishable=True)


def get_version_answer_key(
    connection: Any, flow_version_id: str, node_key: str
) -> dict[str, Any]:
    row = connection.execute(
        """SELECT v.status, v.config_snapshot, v.published_at, f.draft_config
           FROM flow_versions v JOIN flows f ON f.id = v.flow_id WHERE v.id = ?""",
        (flow_version_id,),
    ).fetchone()
    if row is None:
        raise AnswerSheetConfigError("当前答题卡评分配置缺失，请联系教师")
    config = json.loads(row["config_snapshot"] if row["status"] == "preview" else row["draft_config"])
    node = next((n for n in config.get("nodes", []) if str(n["id"]) == node_key and n.get("kind") == "answer_sheet"), None)
    if node is None or ANSWER_KEY not in node:
        raise AnswerSheetConfigError("当前答题卡评分配置缺失，请联系教师")
    metadata = node_metadata(node, "answerKey")
    key = node[ANSWER_KEY]
    return {
        "gradingKey": key,
        "gradingHash": grading_hash(key),
        "generation": metadata["generation"],
        "updatedAt": metadata["updatedAt"] or row["published_at"],
    }


def composite_draft_hash(
    config: dict[str, Any], keys: dict[str, dict[str, Any]]
) -> str:
    return hashlib.sha256(
        canonical_json({"config": public_config(config), "answerSheetKeys": keys}).encode("utf-8")
    ).hexdigest()


def assert_published_answer_keys_unchanged(
    connection: Any,
    flow_id: str,
    config: dict[str, Any],
    supplied_keys: object | None = None,
) -> None:
    published = connection.execute(
        """
        SELECT id, config_snapshot FROM flow_versions
        WHERE flow_id = ? AND status = 'published'
        ORDER BY version_no DESC LIMIT 1
        """,
        (flow_id,),
    ).fetchone()
    if published is None:
        return
    previous_nodes = {
        str(node["id"]): node for node in json.loads(published["config_snapshot"])["nodes"]
    }
    current_nodes = {str(node["id"]): node for node in config.get("nodes", [])}
    draft_keys = (
        validate_answer_sheet_key_map(config, supplied_keys, require_publishable=False)
        if supplied_keys is not None
        else get_draft_answer_keys(connection, flow_id)
    )
    for node_key, previous_node in previous_nodes.items():
        if previous_node.get("kind") != "answer_sheet":
            continue
        current_node = current_nodes.get(node_key)
        if current_node is None or current_node.get("kind") != "answer_sheet":
            raise AnswerSheetConfigError("已发布答题卡节点不可改变类型")
        published_key = get_version_answer_key(connection, str(published["id"]), node_key)
        draft_key = draft_keys.get(node_key)
        if draft_key is None or grading_hash(draft_key) != published_key["gradingHash"]:
            raise AnswerSheetConfigError("已发布答题卡的标准答案已变化，请刷新后通过标准答案设置修改")
