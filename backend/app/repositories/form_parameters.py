"""Mutable published form parameters; student records reference the shared definition."""
import json

from app.core.database import get_connection
from app.domain.workflow import validate_flow_config
from app.services.security import utc_now_iso


FIELDS = ("title", "requirement", "startAt", "deadlineAt")


class FormParametersConflict(ValueError):
    pass


def apply_form_parameters(connection, flow_id, config):
    parameters = {
        row["node_key"]: json.loads(row["params_json"])
        for row in connection.execute(
            "SELECT node_key, params_json FROM node_form_parameters WHERE flow_id = ?",
            (flow_id,),
        )
    }
    for node in config.get("nodes", []):
        if node.get("kind") == "form" and node["id"] in parameters:
            node.update(parameters[node["id"]])


def _published_form(connection, flow_id, node_key, teacher_id):
    from app.repositories.flow_runtime_state import version_config

    version = connection.execute(
        """SELECT v.id FROM flow_versions v JOIN flows f ON f.id = v.flow_id
           WHERE f.id = ? AND f.owner_id = ? AND f.status != 'archived'
             AND v.status = 'published' ORDER BY v.version_no DESC LIMIT 1""",
        (flow_id, str(teacher_id)),
    ).fetchone()
    if version is None:
        raise KeyError(node_key)
    config = version_config(connection, version["id"])
    for node in config["nodes"]:
        if node["id"] == node_key and node.get("kind") == "form":
            return config, node
    raise KeyError(node_key)


def _view(connection, flow_id, node_key, node):
    row = connection.execute(
        "SELECT generation FROM node_form_parameters WHERE flow_id = ? AND node_key = ?",
        (flow_id, node_key),
    ).fetchone()
    return {
        "generation": row["generation"] if row else 0,
        "params": {key: node.get(key) or "" for key in FIELDS},
    }


def get_form_parameters(flow_id, node_key, teacher_id):
    with get_connection() as connection:
        _, node = _published_form(connection, flow_id, node_key, teacher_id)
        return _view(connection, flow_id, node_key, node)


def update_form_parameters(flow_id, node_key, teacher_id, expected_generation, params):
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        config, node = _published_form(connection, flow_id, node_key, teacher_id)
        before = _view(connection, flow_id, node_key, node)
        if expected_generation != before["generation"]:
            raise FormParametersConflict("表单配置已被修改，请重新打开节点后再保存")
        if params == before["params"]:
            return before
        node.update(params)
        validate_flow_config(config)
        generation = before["generation"] + 1
        connection.execute(
            """INSERT INTO node_form_parameters
               (flow_id, node_key, params_json, generation, updated_by, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(flow_id, node_key) DO UPDATE SET
                 params_json = excluded.params_json, generation = excluded.generation,
                 updated_by = excluded.updated_by, updated_at = excluded.updated_at""",
            (flow_id, node_key, json.dumps(params, ensure_ascii=False), generation, teacher_id, now),
        )
        draft = json.loads(connection.execute(
            "SELECT draft_config FROM flows WHERE id = ?", (flow_id,),
        ).fetchone()["draft_config"])
        apply_form_parameters(connection, flow_id, draft)
        connection.execute(
            "UPDATE flows SET draft_config = ?, updated_at = ? WHERE id = ?",
            (json.dumps(draft, ensure_ascii=False), now, flow_id),
        )
        after = {"generation": generation, "params": params}
        connection.execute(
            """INSERT INTO audit_logs
               (actor_id, action, entity_type, entity_id, before_data, after_data, created_at)
               VALUES (?, 'form_parameters_updated', 'node_form_parameters', ?, ?, ?, ?)""",
            (str(teacher_id), f"{flow_id}:{node_key}", json.dumps(before, ensure_ascii=False),
             json.dumps(after, ensure_ascii=False), now),
        )
        return after
