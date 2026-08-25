import hashlib
import json
from typing import Any

from app.domain.answer_sheet import (
    AnswerSheetConfigError,
    validate_private_answer_key,
)


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def grading_hash(value: object) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def get_answer_sheet_drafts(connection: Any, flow_id: str) -> dict[str, dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT node_key, grading_config FROM answer_sheet_drafts
        WHERE flow_id = ? ORDER BY node_key
        """,
        (flow_id,),
    ).fetchall()
    return {str(row["node_key"]): json.loads(row["grading_config"]) for row in rows}


def replace_answer_sheet_drafts(
    connection: Any,
    flow_id: str,
    config: dict[str, Any],
    keys: object,
    teacher_id: int,
    now: str,
) -> dict[str, dict[str, Any]]:
    normalized = validate_answer_sheet_key_map(config, keys, require_publishable=False)
    connection.execute("DELETE FROM answer_sheet_drafts WHERE flow_id = ?", (flow_id,))
    for node_key, key in normalized.items():
        snapshot = canonical_json(key)
        connection.execute(
            """
            INSERT INTO answer_sheet_drafts
                (flow_id, node_key, grading_config, grading_hash, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (flow_id, node_key, snapshot, grading_hash(key), teacher_id, now),
        )
    return normalized


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
        else get_answer_sheet_drafts(connection, flow_id)
    )
    return validate_answer_sheet_key_map(config, keys, require_publishable=True)


def freeze_answer_sheet_keys(
    connection: Any,
    flow_id: str,
    flow_version_id: str,
    config: dict[str, Any],
) -> None:
    keys = validate_publishable_answer_sheet_keys(connection, flow_id, config)
    for node_key, key in keys.items():
        snapshot = canonical_json(key)
        connection.execute(
            """
            INSERT INTO flow_version_answer_keys
                (flow_version_id, node_key, grading_snapshot, grading_hash)
            VALUES (?, ?, ?, ?)
            """,
            (flow_version_id, node_key, snapshot, grading_hash(key)),
        )


def get_version_answer_key(
    connection: Any, flow_version_id: str, node_key: str
) -> dict[str, Any]:
    row = connection.execute(
        """
        SELECT grading_snapshot, grading_hash FROM flow_version_answer_keys
        WHERE flow_version_id = ? AND node_key = ?
        """,
        (flow_version_id, node_key),
    ).fetchone()
    if row is None:
        raise AnswerSheetConfigError("当前答题卡评分配置缺失，请联系教师")
    return {
        "gradingKey": json.loads(row["grading_snapshot"]),
        "gradingHash": str(row["grading_hash"]),
    }


def composite_draft_hash(
    config: dict[str, Any], keys: dict[str, dict[str, Any]]
) -> str:
    return hashlib.sha256(
        canonical_json({"config": config, "answerSheetKeys": keys}).encode("utf-8")
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
        else get_answer_sheet_drafts(connection, flow_id)
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
            raise AnswerSheetConfigError("已发布答题卡的标准答案不可修改")
