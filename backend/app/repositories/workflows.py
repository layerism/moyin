import hashlib
import json
import secrets
import uuid
from collections import deque
from typing import Any

from app.core.database import get_connection
from app.domain.workflow import FlowValidationError, validate_flow_config
from app.domain.workflow_revision import (
    analyze_revision,
    assert_published_nodes_present,
)
from app.domain.workflow_runtime import deadline_has_passed, incoming_nodes
from app.services.security import utc_now_iso


class ArchivedFlowError(ValueError):
    pass


class DuplicateFlowNameError(ValueError):
    pass


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _latest_published_version(connection: Any, flow_id: str, teacher_id: int) -> Any:
    return connection.execute(
        """
        SELECT v.id, v.version_no, v.config_snapshot, v.config_hash
        FROM flow_versions v
        JOIN flows f ON f.id = v.flow_id
        WHERE v.flow_id = ? AND f.owner_id = ? AND v.status = 'published'
        ORDER BY v.version_no DESC
        LIMIT 1
        """,
        (flow_id, str(teacher_id)),
    ).fetchone()


def _published_versions(connection: Any, flow_id: str, teacher_id: int) -> list[Any]:
    return connection.execute(
        """
        SELECT v.id, v.version_no, v.config_snapshot, v.config_hash
        FROM flow_versions v
        JOIN flows f ON f.id = v.flow_id
        WHERE v.flow_id = ? AND f.owner_id = ? AND v.status = 'published'
        ORDER BY v.version_no
        """,
        (flow_id, str(teacher_id)),
    ).fetchall()


def _revision_source_versions(
    connection: Any, flow_id: str, teacher_id: int, now: str
) -> list[Any]:
    return connection.execute(
        """
        SELECT v.id, v.version_no, v.config_snapshot, v.config_hash, v.status
        FROM flow_versions v
        JOIN flows f ON f.id = v.flow_id
        WHERE v.flow_id = ? AND f.owner_id = ?
          AND (
              v.status = 'published'
              OR EXISTS (
                  SELECT 1 FROM flow_instances i WHERE i.flow_version_id = v.id
              )
              OR EXISTS (
                  SELECT 1 FROM share_tokens t
                  WHERE t.flow_version_id = v.id AND t.status = 'active'
                    AND (t.expires_at IS NULL OR t.expires_at > ?)
              )
          )
        ORDER BY v.version_no
        """,
        (flow_id, str(teacher_id), now),
    ).fetchall()


def _revision_analysis(
    connection: Any, versions: list[Any], current_config: dict[str, Any]
) -> dict[str, object]:
    impact_keys = (
        "addedNodeIds",
        "changedNodeIds",
        "predecessorChangedNodeIds",
        "invalidatedNodeIds",
    )
    aggregate = {key: set() for key in impact_keys}
    affected_student_ids: set[int] = set()
    source_impacts = []
    for version in versions:
        impact = analyze_revision(json.loads(version["config_snapshot"]), current_config)
        students = []
        if impact["invalidatedNodeIds"]:
            students = connection.execute(
                """
                SELECT DISTINCT student_account_id FROM flow_instances
                WHERE flow_version_id = ?
                """,
                (version["id"],),
            ).fetchall()
            affected_student_ids.update(row["student_account_id"] for row in students)
        for key in impact_keys:
            aggregate[key].update(impact[key])
        source_impacts.append(
            {
                "versionId": version["id"],
                "versionNo": version["version_no"],
                "status": version["status"],
                **impact,
                "affectedStudentCount": len(students),
            }
        )

    node_order = [node["id"] for node in current_config.get("nodes", [])]
    return {
        **{
            key: [node_key for node_key in node_order if node_key in aggregate[key]]
            for key in impact_keys
        },
        "affectedStudentCount": len(affected_student_ids),
        "sourceVersionImpacts": source_impacts,
    }


def _owned_flow(connection: Any, flow_id: str, teacher_id: int) -> Any:
    return connection.execute(
        "SELECT * FROM flows WHERE id = ? AND owner_id = ?",
        (flow_id, str(teacher_id)),
    ).fetchone()


def create_flow(name: str, description: str, teacher_id: int) -> dict[str, object]:
    flow_id = str(uuid.uuid4())
    owner_id = str(teacher_id)
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        existing = connection.execute(
            """
            SELECT 1 FROM flows
            WHERE owner_id = ? AND name = ? AND status != 'archived'
            LIMIT 1
            """,
            (owner_id, name),
        ).fetchone()
        if existing is not None:
            raise DuplicateFlowNameError("已存在同名流程")
        connection.execute(
            """
            INSERT INTO flows (id, name, description, owner_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (flow_id, name, description, owner_id, now, now),
        )
    return get_flow(flow_id, teacher_id)


def get_flow(flow_id: str, teacher_id: int) -> dict[str, object]:
    now = utc_now_iso()
    with get_connection() as connection:
        row = _owned_flow(connection, flow_id, teacher_id)
        if row is None:
            raise KeyError(flow_id)
        published = _latest_published_version(connection, flow_id, teacher_id)
        token = (
            connection.execute(
                """
                SELECT token_value FROM share_tokens
                WHERE flow_version_id = ? AND status = 'active'
                  AND (expires_at IS NULL OR expires_at > ?)
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (published["id"], now),
            ).fetchone()
            if published
            else None
        )
    draft_config = json.loads(row["draft_config"])
    published_config = json.loads(published["config_snapshot"]) if published else None
    draft_hash = hashlib.sha256(canonical_json(draft_config).encode("utf-8")).hexdigest()
    return {
        "id": row["id"],
        "name": row["name"],
        "publishedVersionId": published["id"] if published else None,
        "publishedNodeIds": [node["id"] for node in published_config.get("nodes", [])]
        if published_config
        else [],
        "publishedVersionNo": published["version_no"] if published else None,
        "hasUnpublishedChanges": bool(published and published["config_hash"] != draft_hash),
        "shareUrl": f"/s/{token['token_value']}" if token and token["token_value"] else "",
        "description": row["description"],
        "status": row["status"],
        "config": draft_config,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def list_flows(teacher_id: int) -> list[dict[str, object]]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id FROM flows
            WHERE owner_id = ? AND status != 'archived'
            ORDER BY created_at DESC
            """,
            (str(teacher_id),),
        ).fetchall()
    return [get_flow(row["id"], teacher_id) for row in rows]


def save_draft(flow_id: str, config: dict[str, Any], teacher_id: int) -> dict[str, object]:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        flow = _owned_flow(connection, flow_id, teacher_id)
        if flow is None:
            raise KeyError(flow_id)
        if flow["status"] == "archived":
            raise ArchivedFlowError("已归档流程不可编辑")
        published = _latest_published_version(connection, flow_id, teacher_id)
        if published:
            assert_published_nodes_present(json.loads(published["config_snapshot"]), config)
        cursor = connection.execute(
            """
            UPDATE flows SET draft_config = ?, updated_at = ?
            WHERE id = ? AND owner_id = ?
            """,
            (canonical_json(config), now, flow_id, str(teacher_id)),
        )
        if cursor.rowcount == 0:
            raise KeyError(flow_id)
    return get_flow(flow_id, teacher_id)


def _topological_node_keys(config: dict[str, Any]) -> list[str]:
    node_keys = [node["id"] for node in config["nodes"]]
    indegree = {node_key: 0 for node_key in node_keys}
    outgoing = {node_key: [] for node_key in node_keys}
    for edge in config["edges"]:
        outgoing[edge["source"]].append(edge["target"])
        indegree[edge["target"]] += 1
    pending = deque(node_key for node_key in node_keys if indegree[node_key] == 0)
    ordered: list[str] = []
    while pending:
        node_key = pending.popleft()
        ordered.append(node_key)
        for target in outgoing[node_key]:
            indegree[target] -= 1
            if indegree[target] == 0:
                pending.append(target)
    return ordered


def _node_invalidation_before_data(
    connection: Any,
    node: Any,
    old_version_id: str,
    new_version_id: str,
    invalidation_reasons: list[str],
) -> dict[str, object]:
    draft = connection.execute(
        "SELECT * FROM node_drafts WHERE node_instance_id = ?", (node["id"],)
    ).fetchone()
    submissions = connection.execute(
        """
        SELECT * FROM submissions
        WHERE node_instance_id = ?
        ORDER BY attempt_no, id
        """,
        (node["id"],),
    ).fetchall()
    override = connection.execute(
        """
        SELECT * FROM student_deadline_overrides
        WHERE flow_instance_id = ? AND node_key = ?
        """,
        (node["flow_instance_id"], node["node_key"]),
    ).fetchone()
    return {
        "oldVersionId": old_version_id,
        "newVersionId": new_version_id,
        "invalidationReasons": invalidation_reasons,
        "nodeInstance": {
            "id": node["id"],
            "flowInstanceId": node["flow_instance_id"],
            "nodeKey": node["node_key"],
            "status": node["status"],
            "openedAt": node["opened_at"],
            "submittedAt": node["submitted_at"],
            "approvedAt": node["approved_at"],
            "attemptNo": node["attempt_no"],
        },
        "draft": (
            {
                "nodeInstanceId": draft["node_instance_id"],
                "payload": json.loads(draft["payload"]),
                "updatedAt": draft["updated_at"],
            }
            if draft is not None
            else None
        ),
        "submissions": [
            {
                "id": submission["id"],
                "nodeInstanceId": submission["node_instance_id"],
                "attemptNo": submission["attempt_no"],
                "idempotencyKey": submission["idempotency_key"],
                "payloadSnapshot": json.loads(submission["payload_snapshot"]),
                "status": submission["status"],
                "submittedAt": submission["submitted_at"],
            }
            for submission in submissions
        ],
        "deadlineOverride": (
            {
                "flowInstanceId": override["flow_instance_id"],
                "nodeKey": override["node_key"],
                "deadlineAt": override["deadline_at"],
                "reason": override["reason"],
                "createdBy": override["created_by"],
                "createdAt": override["created_at"],
            }
            if override is not None
            else None
        ),
    }


def _new_version_deadline(connection: Any, version_id: str, node_key: str) -> str | None:
    row = connection.execute(
        """
        SELECT deadline_at FROM flow_node_runtime_configs
        WHERE flow_version_id = ? AND node_key = ?
        """,
        (version_id, node_key),
    ).fetchone()
    return row["deadline_at"] if row is not None else None


def _create_share_token(connection: Any, version_id: str, teacher_id: int, now: str) -> str:
    token = secrets.token_urlsafe(32)
    connection.execute(
        """
        INSERT INTO share_tokens
            (id, flow_version_id, token_hash, token_value, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            str(uuid.uuid4()),
            version_id,
            hashlib.sha256(token.encode("utf-8")).hexdigest(),
            token,
            str(teacher_id),
            now,
        ),
    )
    return token


def _invalidation_reasons(impact: dict[str, list[str]], node_key: str) -> list[str]:
    reasons = []
    if node_key in impact["changedNodeIds"]:
        reasons.append("node_definition_changed")
    if node_key in impact["predecessorChangedNodeIds"]:
        reasons.append("predecessors_changed")
    if not reasons:
        reasons.append("upstream_invalidated")
    return reasons


def _audit_and_remove_node(
    connection: Any,
    node: Any,
    old_version_id: str,
    new_version_id: str,
    invalidation_reasons: list[str],
    teacher_id: int,
    now: str,
) -> None:
    before_data = _node_invalidation_before_data(
        connection,
        node,
        old_version_id,
        new_version_id,
        invalidation_reasons,
    )
    connection.execute(
        """
        INSERT INTO audit_logs
            (actor_id, action, entity_type, entity_id, before_data, created_at)
        VALUES (?, 'node_submission_invalidated', 'node_instance', ?, ?, ?)
        """,
        (str(teacher_id), node["id"], canonical_json(before_data), now),
    )
    connection.execute("DELETE FROM submissions WHERE node_instance_id = ?", (node["id"],))
    connection.execute("DELETE FROM node_drafts WHERE node_instance_id = ?", (node["id"],))
    connection.execute(
        """
        DELETE FROM student_deadline_overrides
        WHERE flow_instance_id = ? AND node_key = ?
        """,
        (node["flow_instance_id"], node["node_key"]),
    )
    connection.execute("DELETE FROM node_instances WHERE id = ?", (node["id"],))


def _duplicate_instance_before_data(
    connection: Any,
    instance: Any,
    new_version_id: str,
) -> dict[str, object]:
    nodes = connection.execute(
        "SELECT * FROM node_instances WHERE flow_instance_id = ? ORDER BY node_key",
        (instance["id"],),
    ).fetchall()
    return {
        "flowInstance": {
            "id": instance["id"],
            "flowVersionId": instance["flow_version_id"],
            "studentAccountId": instance["student_account_id"],
            "status": instance["status"],
            "startedAt": instance["started_at"],
            "completedAt": instance["completed_at"],
            "lastActiveAt": instance["last_active_at"],
        },
        "newVersionId": new_version_id,
        "nodeSnapshots": [
            _node_invalidation_before_data(
                connection,
                node,
                instance["flow_version_id"],
                new_version_id,
                ["duplicate_instance_normalized"],
            )
            for node in nodes
        ],
    }


def _migrate_instance(
    connection: Any,
    instance: Any,
    new_version_id: str,
    config: dict[str, Any],
    impact: dict[str, list[str]],
    teacher_id: int,
    now: str,
) -> None:
    node_rows = connection.execute(
        "SELECT * FROM node_instances WHERE flow_instance_id = ?",
        (instance["id"],),
    ).fetchall()
    existing = {row["node_key"]: row for row in node_rows}
    current_node_keys = {node["id"] for node in config["nodes"]}

    for node_key in impact["invalidatedNodeIds"]:
        node = existing.pop(node_key, None)
        if node is not None:
            _audit_and_remove_node(
                connection,
                node,
                instance["flow_version_id"],
                new_version_id,
                _invalidation_reasons(impact, node_key),
                teacher_id,
                now,
            )

    for node_key in set(existing) - current_node_keys:
        node = existing.pop(node_key)
        _audit_and_remove_node(
            connection,
            node,
            instance["flow_version_id"],
            new_version_id,
            ["node_removed_during_normalization"],
            teacher_id,
            now,
        )

    recomputed = set(impact["addedNodeIds"]) | set(impact["invalidatedNodeIds"])
    for node_key in current_node_keys - set(existing):
        connection.execute(
            """
            INSERT INTO node_instances (id, flow_instance_id, node_key, status)
            VALUES (?, ?, ?, 'locked')
            """,
            (str(uuid.uuid4()), instance["id"], node_key),
        )
        recomputed.add(node_key)

    statuses = {
        row["node_key"]: row["status"]
        for row in connection.execute(
            "SELECT node_key, status FROM node_instances WHERE flow_instance_id = ?",
            (instance["id"],),
        ).fetchall()
    }
    incoming = incoming_nodes(config)
    for node_key in _topological_node_keys(config):
        if node_key not in recomputed:
            continue
        unlocked = all(statuses[source] == "approved" for source in incoming[node_key])
        next_status = "available" if unlocked else "locked"
        if unlocked and deadline_has_passed(
            _new_version_deadline(connection, new_version_id, node_key)
        ):
            next_status = "expired"
        connection.execute(
            """
            UPDATE node_instances SET status = ?, opened_at = ?
            WHERE flow_instance_id = ? AND node_key = ?
            """,
            (
                next_status,
                now if next_status == "available" else None,
                instance["id"],
                node_key,
            ),
        )
        statuses[node_key] = next_status

    connection.execute(
        "UPDATE flow_instances SET flow_version_id = ? WHERE id = ?",
        (new_version_id, instance["id"]),
    )
    if all(status == "approved" for status in statuses.values()):
        connection.execute(
            """
            UPDATE flow_instances
            SET status = 'completed', completed_at = COALESCE(completed_at, ?)
            WHERE id = ?
            """,
            (now, instance["id"]),
        )
    else:
        connection.execute(
            """
            UPDATE flow_instances
            SET status = 'in_progress', completed_at = NULL
            WHERE id = ?
            """,
            (instance["id"],),
        )


def _migrate_instances(
    connection: Any,
    old_versions: list[Any],
    new_version_id: str,
    config: dict[str, Any],
    teacher_id: int,
    now: str,
) -> int:
    version_ids = [version["id"] for version in old_versions]
    placeholders = ",".join("?" for _ in version_ids)
    instances = connection.execute(
        f"""
        SELECT i.*, v.version_no
        FROM flow_instances i
        JOIN flow_versions v ON v.id = i.flow_version_id
        WHERE i.flow_version_id IN ({placeholders})
        ORDER BY i.student_account_id, v.version_no DESC, i.last_active_at DESC, i.id
        """,
        version_ids,
    ).fetchall()
    version_configs = {
        version["id"]: json.loads(version["config_snapshot"]) for version in old_versions
    }
    canonical_by_student: dict[int, Any] = {}
    duplicates: list[tuple[Any, Any]] = []
    for instance in instances:
        canonical = canonical_by_student.setdefault(instance["student_account_id"], instance)
        if canonical["id"] != instance["id"]:
            duplicates.append((instance, canonical))

    for duplicate, canonical in duplicates:
        before_data = _duplicate_instance_before_data(connection, duplicate, new_version_id)
        connection.execute(
            """
            INSERT INTO audit_logs
                (actor_id, action, entity_type, entity_id,
                 before_data, after_data, created_at)
            VALUES (?, 'flow_instance_normalized', 'flow_instance', ?, ?, ?, ?)
            """,
            (
                str(teacher_id),
                duplicate["id"],
                canonical_json(before_data),
                canonical_json(
                    {
                        "keptInstanceId": canonical["id"],
                        "newVersionId": new_version_id,
                    }
                ),
                now,
            ),
        )
        connection.execute("DELETE FROM flow_instances WHERE id = ?", (duplicate["id"],))

    for instance in canonical_by_student.values():
        source_config = version_configs[instance["flow_version_id"]]
        _migrate_instance(
            connection,
            instance,
            new_version_id,
            config,
            analyze_revision(source_config, config),
            teacher_id,
            now,
        )
    return len(canonical_by_student)


def publish_flow(flow_id: str, teacher_id: int) -> dict[str, object]:
    version_id = str(uuid.uuid4())
    now = utc_now_iso()

    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        flow = _owned_flow(connection, flow_id, teacher_id)
        if flow is None:
            raise KeyError(flow_id)
        if flow["status"] == "archived":
            raise ArchivedFlowError("已归档流程不可发布")
        config = json.loads(flow["draft_config"])
        published_versions = _published_versions(connection, flow_id, teacher_id)
        published = published_versions[-1] if published_versions else None
        source_versions = _revision_source_versions(connection, flow_id, teacher_id, now)
        baseline = published or (source_versions[-1] if source_versions else None)
        if baseline:
            assert_published_nodes_present(json.loads(baseline["config_snapshot"]), config)
        validate_flow_config(config)
        active_roster_count = connection.execute(
            """
            SELECT COUNT(*) AS count FROM flow_roster_entries
            WHERE flow_id = ? AND status = 'active'
            """,
            (flow_id,),
        ).fetchone()["count"]
        if active_roster_count == 0:
            raise FlowValidationError("请先导入学生名单")
        snapshot = canonical_json(config)
        config_hash = hashlib.sha256(snapshot.encode("utf-8")).hexdigest()
        row = connection.execute(
            "SELECT COALESCE(MAX(version_no), 0) + 1 AS next_no FROM flow_versions WHERE flow_id = ?",
            (flow_id,),
        ).fetchone()
        version_no = int(row["next_no"])
        connection.execute(
            """
            INSERT INTO flow_versions
                (id, flow_id, version_no, config_snapshot, config_hash, published_by, published_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (version_id, flow_id, version_no, snapshot, config_hash, str(teacher_id), now),
        )
        for node in config["nodes"]:
            connection.execute(
                """
                INSERT INTO flow_node_runtime_configs
                    (flow_version_id, node_key, deadline_at, updated_by, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (version_id, node["id"], node.get("deadlineAt"), str(teacher_id), now),
            )
        if baseline is None:
            token = _create_share_token(connection, version_id, teacher_id, now)
        else:
            analysis = _revision_analysis(connection, source_versions, config)
            migrated_student_count = _migrate_instances(
                connection,
                source_versions,
                version_id,
                config,
                teacher_id,
                now,
            )
            active_token = connection.execute(
                """
                SELECT t.token_value FROM share_tokens t
                JOIN flow_versions v ON v.id = t.flow_version_id
                WHERE v.flow_id = ? AND v.id != ? AND t.status = 'active'
                  AND t.token_value IS NOT NULL
                  AND (t.expires_at IS NULL OR t.expires_at > ?)
                ORDER BY v.version_no DESC, t.created_at DESC
                LIMIT 1
                """,
                (flow_id, version_id, now),
            ).fetchone()
            if active_token is None or not active_token["token_value"]:
                token = _create_share_token(connection, version_id, teacher_id, now)
                retargeted = 0
            else:
                token = active_token["token_value"]
                retargeted = connection.execute(
                    """
                    UPDATE share_tokens SET flow_version_id = ?
                    WHERE status = 'active'
                      AND (expires_at IS NULL OR expires_at > ?)
                      AND flow_version_id IN (
                          SELECT id FROM flow_versions
                          WHERE flow_id = ? AND id != ?
                      )
                    """,
                    (version_id, now, flow_id, version_id),
                ).rowcount
            connection.execute(
                """
                UPDATE flow_versions SET status = 'disabled'
                WHERE flow_id = ? AND id != ? AND status = 'published'
                """,
                (flow_id, version_id),
            )
            old_version_ids = [version["id"] for version in source_versions]
            connection.execute(
                """
                INSERT INTO audit_logs
                    (actor_id, action, entity_type, entity_id, after_data, created_at)
                VALUES (?, 'workflow_republish', 'flow', ?, ?, ?)
                """,
                (
                    str(teacher_id),
                    flow_id,
                    canonical_json(
                        {
                            "oldVersionId": baseline["id"],
                            "oldVersionIds": old_version_ids,
                            "newVersionId": version_id,
                            **analysis,
                            "migratedStudentCount": migrated_student_count,
                        }
                    ),
                    now,
                ),
            )
            connection.execute(
                """
                INSERT INTO audit_logs
                    (actor_id, action, entity_type, entity_id, after_data, created_at)
                VALUES (?, 'share_token_retargeted', 'flow', ?, ?, ?)
                """,
                (
                    str(teacher_id),
                    flow_id,
                    canonical_json(
                        {
                            "oldVersionId": baseline["id"],
                            "oldVersionIds": old_version_ids,
                            "newVersionId": version_id,
                            "retargetedTokenCount": retargeted,
                        }
                    ),
                    now,
                ),
            )
        connection.execute(
            """
            UPDATE flows SET status = 'published', updated_at = ?
            WHERE id = ? AND owner_id = ?
            """,
            (now, flow_id, str(teacher_id)),
        )
    return {
        "flowId": flow_id,
        "flowVersionId": version_id,
        "versionNo": version_no,
        "token": token,
        "shareUrl": f"/s/{token}",
        "configHash": config_hash,
    }


def get_revision_impact(flow_id: str, teacher_id: int) -> dict[str, object]:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN")
        flow = connection.execute(
            "SELECT draft_config FROM flows WHERE id = ? AND owner_id = ?",
            (flow_id, str(teacher_id)),
        ).fetchone()
        if flow is None:
            raise KeyError(flow_id)
        published = _latest_published_version(connection, flow_id, teacher_id)
        source_versions = _revision_source_versions(connection, flow_id, teacher_id, now)
        baseline = published or (source_versions[-1] if source_versions else None)
        analysis = _revision_analysis(connection, source_versions, json.loads(flow["draft_config"]))
        next_version_no = connection.execute(
            """
            SELECT COALESCE(MAX(version_no), 0) + 1 AS value
            FROM flow_versions WHERE flow_id = ?
            """,
            (flow_id,),
        ).fetchone()["value"]

    return {
        "currentVersionId": baseline["id"] if baseline else None,
        "currentVersionNo": baseline["version_no"] if baseline else None,
        "nextVersionNo": next_version_no,
        **analysis,
    }


def delete_flow(flow_id: str, teacher_id: int) -> None:
    now = utc_now_iso()
    with get_connection() as connection:
        row = connection.execute(
            "SELECT name, status FROM flows WHERE id = ? AND owner_id = ?",
            (flow_id, str(teacher_id)),
        ).fetchone()
        if row is None:
            raise KeyError(flow_id)

        version_ids = [
            version["id"]
            for version in connection.execute(
                "SELECT id FROM flow_versions WHERE flow_id = ?", (flow_id,)
            ).fetchall()
        ]
        instance_ids = [
            instance["id"]
            for instance in connection.execute(
                """
                SELECT i.id FROM flow_instances i
                JOIN flow_versions v ON v.id = i.flow_version_id
                WHERE v.flow_id = ?
                """,
                (flow_id,),
            ).fetchall()
        ]

        connection.execute(
            """
            DELETE FROM audit_logs
            WHERE entity_type IN ('flow', 'flow_roster') AND entity_id = ?
            """,
            (flow_id,),
        )
        for version_id in version_ids:
            connection.execute(
                "DELETE FROM audit_logs WHERE entity_id = ? OR entity_id LIKE ?",
                (version_id, f"{version_id}:%"),
            )
        for instance_id in instance_ids:
            connection.execute(
                "DELETE FROM audit_logs WHERE entity_id = ? OR entity_id LIKE ?",
                (instance_id, f"{instance_id}:%"),
            )

        connection.execute(
            """
            DELETE FROM submissions WHERE node_instance_id IN (
                SELECT n.id FROM node_instances n
                JOIN flow_instances i ON i.id = n.flow_instance_id
                JOIN flow_versions v ON v.id = i.flow_version_id
                WHERE v.flow_id = ?
            )
            """,
            (flow_id,),
        )
        connection.execute(
            """
            DELETE FROM node_drafts WHERE node_instance_id IN (
                SELECT n.id FROM node_instances n
                JOIN flow_instances i ON i.id = n.flow_instance_id
                JOIN flow_versions v ON v.id = i.flow_version_id
                WHERE v.flow_id = ?
            )
            """,
            (flow_id,),
        )
        connection.execute(
            """
            DELETE FROM student_deadline_overrides WHERE flow_instance_id IN (
                SELECT i.id FROM flow_instances i
                JOIN flow_versions v ON v.id = i.flow_version_id
                WHERE v.flow_id = ?
            )
            """,
            (flow_id,),
        )
        connection.execute(
            """
            DELETE FROM node_instances WHERE flow_instance_id IN (
                SELECT i.id FROM flow_instances i
                JOIN flow_versions v ON v.id = i.flow_version_id
                WHERE v.flow_id = ?
            )
            """,
            (flow_id,),
        )
        connection.execute(
            """
            DELETE FROM flow_instances WHERE flow_version_id IN (
                SELECT id FROM flow_versions WHERE flow_id = ?
            )
            """,
            (flow_id,),
        )
        connection.execute(
            """
            DELETE FROM flow_node_runtime_configs WHERE flow_version_id IN (
                SELECT id FROM flow_versions WHERE flow_id = ?
            )
            """,
            (flow_id,),
        )
        connection.execute(
            """
            DELETE FROM share_tokens WHERE flow_version_id IN (
                SELECT id FROM flow_versions WHERE flow_id = ?
            )
            """,
            (flow_id,),
        )
        connection.execute("DELETE FROM flow_versions WHERE flow_id = ?", (flow_id,))
        connection.execute("DELETE FROM flows WHERE id = ?", (flow_id,))
        connection.execute(
            """
            INSERT INTO audit_logs
                (actor_id, action, entity_type, entity_id, before_data, created_at)
            VALUES (?, 'delete', 'flow', ?, ?, ?)
            """,
            (
                str(teacher_id),
                flow_id,
                canonical_json({"name": row["name"], "status": row["status"]}),
                now,
            ),
        )


def resolve_share_token(token: str) -> dict[str, object]:
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT v.id AS version_id, v.flow_id, v.version_no, v.config_snapshot,
                   f.name, f.description
            FROM share_tokens t
            JOIN flow_versions v ON v.id = t.flow_version_id
            JOIN flows f ON f.id = v.flow_id
            WHERE t.token_hash = ? AND t.status = 'active'
              AND (t.expires_at IS NULL OR t.expires_at > ?)
              AND v.status = 'published'
            """,
            (token_hash, utc_now_iso()),
        ).fetchone()
    if row is None:
        raise KeyError(token)
    return {
        "flowId": row["flow_id"],
        "flowVersionId": row["version_id"],
        "versionNo": row["version_no"],
        "name": row["name"],
        "description": row["description"],
        "config": json.loads(row["config_snapshot"]),
    }
