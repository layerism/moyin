import json
from typing import Any

from app.core.database import get_connection
from app.domain.answer_sheet import grade_answer_sheet, validate_private_answer_key
from app.repositories.answer_sheet_grades import replace_answer_sheet_grade
from app.repositories.answer_sheet_keys import (
    canonical_json,
    get_version_answer_key,
    grading_hash,
)
from app.services.security import utc_now_iso


class AnswerSheetPolicyConflictError(ValueError):
    pass


def _published_answer_sheet(
    connection: Any, flow_id: str, node_key: str, teacher_id: int
) -> tuple[Any, dict[str, Any]]:
    version = connection.execute(
        """
        SELECT v.id, v.config_snapshot
        FROM flow_versions v
        JOIN flows f ON f.id = v.flow_id
        WHERE v.flow_id = ? AND f.owner_id = ? AND f.status != 'archived'
          AND v.status = 'published'
        ORDER BY v.version_no DESC LIMIT 1
        """,
        (flow_id, str(teacher_id)),
    ).fetchone()
    if version is None:
        raise KeyError(node_key)
    node = next(
        (
            item
            for item in json.loads(version["config_snapshot"]).get("nodes", [])
            if str(item.get("id")) == node_key and item.get("kind") == "answer_sheet"
        ),
        None,
    )
    if node is None:
        raise KeyError(node_key)
    return version, node


def _policy_view(
    connection: Any, flow_id: str, node_key: str, teacher_id: int
) -> dict[str, object]:
    version, _ = _published_answer_sheet(connection, flow_id, node_key, teacher_id)
    key = get_version_answer_key(connection, str(version["id"]), node_key)
    return {
        "flowId": flow_id,
        "nodeKey": node_key,
        "gradingKey": key["gradingKey"],
        "gradingHash": key["gradingHash"],
        "generation": key["generation"],
        "updatedAt": key["updatedAt"],
    }


def get_node_answer_key_policy(
    flow_id: str, node_key: str, teacher_id: int
) -> dict[str, object]:
    with get_connection() as connection:
        return _policy_view(connection, flow_id, node_key, teacher_id)


def update_node_answer_key_policy(
    flow_id: str,
    node_key: str,
    teacher_id: int,
    expected_generation: int,
    grading_key: dict[str, Any],
) -> dict[str, object]:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        version, published_node = _published_answer_sheet(
            connection, flow_id, node_key, teacher_id
        )
        current = get_version_answer_key(connection, str(version["id"]), node_key)
        if int(current["generation"]) != expected_generation:
            raise AnswerSheetPolicyConflictError(
                "标准答案已被其他修改更新，请重新打开节点后再试"
            )
        validate_private_answer_key(
            published_node, grading_key, require_publishable=True
        )
        next_hash = grading_hash(grading_key)
        if next_hash == current["gradingHash"]:
            return {**_policy_view(connection, flow_id, node_key, teacher_id),
                    "regradedSubmissionCount": 0}

        next_generation = expected_generation + 1
        connection.execute(
            """
            INSERT INTO answer_sheet_key_revisions
                (flow_id, node_key, generation, grading_snapshot, grading_hash,
                 updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                flow_id,
                node_key,
                next_generation,
                canonical_json(grading_key),
                next_hash,
                teacher_id,
                now,
            ),
        )
        connection.execute(
            """
            INSERT INTO answer_sheet_drafts
                (flow_id, node_key, grading_config, grading_hash, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(flow_id, node_key) DO UPDATE SET
                grading_config = excluded.grading_config,
                grading_hash = excluded.grading_hash,
                updated_by = excluded.updated_by,
                updated_at = excluded.updated_at
            """,
            (
                flow_id,
                node_key,
                canonical_json(grading_key),
                next_hash,
                teacher_id,
                now,
            ),
        )

        submissions = connection.execute(
            """
            SELECT s.id, s.payload_snapshot, v.id AS flow_version_id,
                   v.config_snapshot
            FROM submissions s
            JOIN node_instances n ON n.id = s.node_instance_id
            JOIN flow_instances i ON i.id = n.flow_instance_id
            JOIN student_accounts a ON a.id = i.student_account_id
            JOIN flow_versions v ON v.id = i.flow_version_id
            WHERE v.flow_id = ? AND n.node_key = ?
              AND a.account_kind = 'normal'
            ORDER BY s.submitted_at, s.id
            """,
            (flow_id, node_key),
        ).fetchall()
        version_nodes: dict[str, dict[str, Any]] = {}
        for submission in submissions:
            version_id = str(submission["flow_version_id"])
            node = version_nodes.get(version_id)
            if node is None:
                node = next(
                    (
                        item
                        for item in json.loads(submission["config_snapshot"]).get("nodes", [])
                        if str(item.get("id")) == node_key
                        and item.get("kind") == "answer_sheet"
                    ),
                    None,
                )
                if node is None:
                    raise AnswerSheetPolicyConflictError(
                        "历史流程版本中的答题卡结构缺失，无法重新判分"
                    )
                validate_private_answer_key(
                    node, grading_key, require_publishable=True
                )
                version_nodes[version_id] = node
            result = grade_answer_sheet(
                node, grading_key, json.loads(submission["payload_snapshot"])
            )
            replace_answer_sheet_grade(
                connection,
                str(submission["id"]),
                result,
                next_hash,
                teacher_id,
                now,
            )

        connection.execute(
            """
            INSERT INTO audit_logs
                (actor_id, action, entity_type, entity_id,
                 before_data, after_data, created_at)
            VALUES (?, 'answer_sheet_key_updated', 'answer_sheet_key_policy', ?, ?, ?, ?)
            """,
            (
                str(teacher_id),
                f"{flow_id}:{node_key}",
                canonical_json(
                    {
                        "generation": current["generation"],
                        "gradingHash": current["gradingHash"],
                    }
                ),
                canonical_json(
                    {
                        "generation": next_generation,
                        "gradingHash": next_hash,
                        "regradedSubmissionCount": len(submissions),
                    }
                ),
                now,
            ),
        )
        return {
            **_policy_view(connection, flow_id, node_key, teacher_id),
            "regradedSubmissionCount": len(submissions),
        }
