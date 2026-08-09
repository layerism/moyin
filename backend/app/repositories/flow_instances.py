import hashlib
import json
import math
import uuid
from datetime import UTC, datetime
from typing import Any

from app.core.database import get_connection
from app.domain.form_fields import normalize_form_answers
from app.domain.workflow_runtime import (
    incoming_nodes,
    node_by_key,
    parse_datetime,
    pending_node_status,
    validate_submission,
)
from app.repositories.audit_jobs import create_audit_job
from app.repositories.flow_files import (
    FileContextError,
    attach_uploaded_file,
    attach_uploaded_files,
    get_pending_scans_for_submit,
    get_uploaded_file_for_node,
)
from app.repositories.flow_roster import assert_student_roster_access
from app.repositories.flow_runtime_state import (
    advance_downstream,
    complete_flow_if_ready,
    effective_deadline,
    version_config,
)
from app.repositories.workflows import canonical_json
from app.services.security import utc_now_iso


class RuntimeConflictError(ValueError):
    pass


class RuntimeDeadlineError(ValueError):
    pass


class StudentDeadlineValidationError(ValueError):
    pass


def _parse_student_deadline(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError) as exc:
        raise StudentDeadlineValidationError("延期截止时间格式无效") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise StudentDeadlineValidationError("延期截止时间必须包含时区")
    return parsed.astimezone(UTC)


def _json_object(value: object) -> dict[str, object]:
    if not isinstance(value, str):
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _is_approved_form_amendment(status: str, node: dict[str, Any]) -> bool:
    return status == "approved" and node.get("kind") == "form"


def _get_or_create_version_instance(
    connection: Any,
    version_id: str,
    flow_id: str,
    config: dict[str, Any],
    student_id: int,
    now: str,
) -> str:
    assert_student_roster_access(connection, flow_id, student_id)
    row = connection.execute(
        """
        SELECT id FROM flow_instances
        WHERE flow_version_id = ? AND student_account_id = ?
        """,
        (version_id, student_id),
    ).fetchone()
    if row is not None:
        instance_id = str(row["id"])
        connection.execute(
            "UPDATE flow_instances SET last_active_at = ? WHERE id = ?", (now, instance_id)
        )
        return instance_id

    instance_id = str(uuid.uuid4())
    connection.execute(
        """
        INSERT INTO flow_instances
            (id, flow_version_id, student_account_id, started_at, last_active_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (instance_id, version_id, student_id, now, now),
    )
    incoming = incoming_nodes(config)
    for node in config["nodes"]:
        node_key = node["id"]
        deadline = effective_deadline(connection, instance_id, version_id, node_key)
        status = pending_node_status(not incoming[node_key], node.get("startAt"), deadline)
        connection.execute(
            """
            INSERT INTO node_instances
                (id, flow_instance_id, node_key, status, opened_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                str(uuid.uuid4()),
                instance_id,
                node_key,
                status,
                now if status == "available" else None,
            ),
        )
    return instance_id


def get_or_create_instance(token: str, student_id: int) -> dict[str, object]:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        shared = connection.execute(
            """
            SELECT v.id AS version_id, v.flow_id, v.config_snapshot
            FROM share_tokens t
            JOIN flow_versions v ON v.id = t.flow_version_id
            WHERE t.token_hash = ? AND t.status = 'active'
              AND (t.expires_at IS NULL OR t.expires_at > ?)
              AND v.status = 'published'
            """,
            (hashlib.sha256(token.encode("utf-8")).hexdigest(), now),
        ).fetchone()
        if shared is None:
            raise KeyError(token)
        instance_id = _get_or_create_version_instance(
            connection,
            str(shared["version_id"]),
            str(shared["flow_id"]),
            json.loads(shared["config_snapshot"]),
            student_id,
            now,
        )
    return get_instance(instance_id, student_id)


def enter_flow(flow_id: str, student_id: int) -> dict[str, object]:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        version = connection.execute(
            """
            SELECT v.id AS version_id, v.config_snapshot
            FROM flows f
            JOIN flow_versions v ON v.flow_id = f.id
            WHERE f.id = ? AND f.status = 'published'
              AND v.status = 'published'
            ORDER BY v.version_no DESC
            LIMIT 1
            """,
            (flow_id,),
        ).fetchone()
        if version is None:
            raise KeyError(flow_id)
        instance_id = _get_or_create_version_instance(
            connection,
            str(version["version_id"]),
            flow_id,
            json.loads(version["config_snapshot"]),
            student_id,
            now,
        )
    return get_instance(instance_id, student_id)


def get_instance(instance_id: str, student_id: int | None = None) -> dict[str, object]:
    with get_connection() as connection:
        connection.execute("BEGIN")
        params: list[object] = [instance_id]
        student_filter = ""
        if student_id is not None:
            student_filter = " AND i.student_account_id = ?"
            params.append(student_id)
        instance = connection.execute(
            f"""
            SELECT i.*, a.student_no, a.name, v.config_snapshot, v.flow_id,
                   f.name AS flow_name, f.description
            FROM flow_instances i
            JOIN student_accounts a ON a.id = i.student_account_id
            JOIN flow_versions v ON v.id = i.flow_version_id
            JOIN flows f ON f.id = v.flow_id
            WHERE i.id = ?{student_filter}
            """,
            params,
        ).fetchone()
        if instance is None:
            raise KeyError(instance_id)
        if student_id is not None:
            assert_student_roster_access(connection, instance["flow_id"], student_id)
        config = json.loads(instance["config_snapshot"])
        incoming = incoming_nodes(config)
        node_rows = connection.execute(
            """
            SELECT n.*, d.payload AS draft_payload, s.payload_snapshot AS submission_payload,
                   j.status AS audit_job_status, j.attempt_count AS audit_attempt_count,
                   j.result_json AS audit_result_json
            FROM node_instances n
            LEFT JOIN node_drafts d ON d.node_instance_id = n.id
            LEFT JOIN submissions s
              ON s.node_instance_id = n.id AND s.attempt_no = n.attempt_no
            LEFT JOIN audit_jobs j ON j.submission_id = s.id
            WHERE n.flow_instance_id = ?
            """,
            (instance_id,),
        ).fetchall()
        node_order = {node["id"]: index for index, node in enumerate(config["nodes"])}
        nodes = []
        raw_statuses = {row["node_key"]: row["status"] for row in node_rows}
        for row in node_rows:
            deadline = effective_deadline(
                connection, instance_id, instance["flow_version_id"], row["node_key"]
            )
            status = row["status"]
            config_node = node_by_key(config, row["node_key"])
            if status in {"available", "draft", "rejected", "locked", "scheduled", "expired"}:
                base_status = pending_node_status(
                    all(raw_statuses.get(source) == "approved" for source in incoming[row["node_key"]]),
                    config_node.get("startAt"),
                    deadline,
                )
                status = (
                    status if base_status == "available" and status in {"draft", "rejected"}
                    else base_status
                )
                if status != row["status"]:
                    connection.execute(
                        "UPDATE node_instances SET status = ?, opened_at = ? WHERE id = ?",
                        (status, utc_now_iso() if status == "available" else row["opened_at"], row["id"]),
                    )
            template = connection.execute(
                """
                SELECT a.id, a.original_name, a.content_type, a.size_bytes,
                       e.downloaded_at
                FROM flow_version_templates t
                JOIN flow_template_assets a ON a.id = t.template_asset_id
                LEFT JOIN template_download_events e
                  ON e.node_instance_id = ? AND e.template_asset_id = a.id
                 AND e.student_account_id = ?
                WHERE t.flow_version_id = ? AND t.node_key = ?
                """,
                (row["id"], instance["student_account_id"], instance["flow_version_id"], row["node_key"]),
            ).fetchone()
            nodes.append(
                {
                    "id": row["id"],
                    "nodeKey": row["node_key"],
                    "status": status,
                    "attemptNo": row["attempt_no"],
                    "draft": _json_object(row["draft_payload"]),
                    "submission": _json_object(row["submission_payload"]),
                    "effectiveDeadline": deadline,
                    "effectiveStartAt": config_node.get("startAt"),
                    "template": {
                        "assetId": template["id"],
                        "contentType": template["content_type"],
                        "originalName": template["original_name"],
                        "sizeBytes": template["size_bytes"],
                    } if template else None,
                    "templateDownloaded": bool(template and template["downloaded_at"]),
                    "submittedAt": row["submitted_at"],
                    "approvedAt": row["approved_at"],
                    "audit": _audit_summary(row, status, config_node),
                }
            )
        nodes.sort(key=lambda item: node_order[item["nodeKey"]])
        safe_config = {
            **config,
            "nodes": [
                {
                    key: value
                    for key, value in node.items()
                    if not (
                        node.get("kind") == "confirmation"
                        and key in {
                            "scanAuditMode", "scanAuditPrompt", "auditScriptId",
                            "auditScriptVersion", "auditScriptHash", "auditScriptConfigHash",
                            "auditScriptAcceptedExtensions", "auditScriptParams",
                        }
                    )
                }
                for node in config["nodes"]
            ],
        }
    return {
        "id": instance["id"],
        "flowId": instance["flow_id"],
        "flowVersionId": instance["flow_version_id"],
        "name": instance["flow_name"],
        "description": instance["description"],
        "status": instance["status"],
        "student": {"studentNo": instance["student_no"], "name": instance["name"]},
        "config": safe_config,
        "nodeInstances": nodes,
    }


def list_student_instances(student_id: int) -> list[dict[str, object]]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT i.id, i.status, i.last_active_at, f.name
            FROM flow_instances i
            JOIN student_accounts a ON a.id = i.student_account_id
            JOIN flow_versions v ON v.id = i.flow_version_id
            JOIN flows f ON f.id = v.flow_id
            JOIN flow_roster_entries r
              ON r.flow_id = f.id
             AND r.student_no = a.student_no
             AND r.name = a.name
             AND r.status = 'active'
            WHERE i.student_account_id = ?
            ORDER BY i.last_active_at DESC
            """,
            (student_id,),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "status": row["status"],
            "lastActiveAt": row["last_active_at"],
        }
        for row in rows
    ]


def list_student_flows(student_id: int) -> list[dict[str, object]]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT f.id AS flow_id, f.name,
                   i.id AS instance_id, i.status AS instance_status,
                   i.last_active_at
            FROM student_accounts a
            JOIN flow_roster_entries r
              ON r.student_no = a.student_no
             AND r.name = a.name
             AND r.status = 'active'
            JOIN flows f ON f.id = r.flow_id AND f.status = 'published'
            JOIN flow_versions v
              ON v.flow_id = f.id AND v.status = 'published'
             AND v.version_no = (
                 SELECT MAX(latest.version_no)
                 FROM flow_versions latest
                 WHERE latest.flow_id = f.id AND latest.status = 'published'
             )
            LEFT JOIN flow_instances i
              ON i.flow_version_id = v.id
             AND i.student_account_id = a.id
            WHERE a.id = ? AND a.status = 'active'
            ORDER BY CASE WHEN i.last_active_at IS NULL THEN 1 ELSE 0 END,
                     COALESCE(i.last_active_at, f.updated_at) DESC, f.id
            """,
            (student_id,),
        ).fetchall()
    return [
        {
            "flowId": row["flow_id"],
            "instanceId": row["instance_id"],
            "name": row["name"],
            "status": row["instance_status"] or "not_started",
            "lastActiveAt": row["last_active_at"],
        }
        for row in rows
    ]


def save_node_draft(
    node_instance_id: str, student_id: int, payload: dict[str, Any]
) -> dict[str, object]:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            """
            SELECT n.id, n.status, n.flow_instance_id, n.node_key,
                   i.flow_version_id, v.flow_id, v.config_snapshot
            FROM node_instances n
            JOIN flow_instances i ON i.id = n.flow_instance_id
            JOIN flow_versions v ON v.id = i.flow_version_id
            WHERE n.id = ? AND i.student_account_id = ? AND v.status = 'published'
            """,
            (node_instance_id, student_id),
        ).fetchone()
        if row is None:
            raise KeyError(node_instance_id)
        assert_student_roster_access(connection, row["flow_id"], student_id)
        config = json.loads(row["config_snapshot"])
        node = node_by_key(config, row["node_key"])
        approved_form_amendment = _is_approved_form_amendment(row["status"], node)
        statuses = {
            item["node_key"]: item["status"]
            for item in connection.execute(
                "SELECT node_key, status FROM node_instances WHERE flow_instance_id = ?",
                (row["flow_instance_id"],),
            ).fetchall()
        }
        base_status = pending_node_status(
            all(statuses.get(source) == "approved" for source in incoming_nodes(config)[row["node_key"]]),
            node.get("startAt"),
            effective_deadline(connection, row["flow_instance_id"], row["flow_version_id"], row["node_key"]),
        )
        if base_status != "available":
            raise RuntimeConflictError("当前节点尚未开放或已截止")
        if (
            row["status"] not in {
                "available", "draft", "rejected", "scheduled", "locked", "expired"
            }
            and not approved_form_amendment
        ):
            raise RuntimeConflictError("当前节点不可暂存")
        draft_payload = (
            normalize_form_answers(node, payload, strict=False)
            if node.get("kind") == "form"
            else payload
        )
        connection.execute(
            """
            INSERT INTO node_drafts (node_instance_id, payload, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(node_instance_id) DO UPDATE
            SET payload = excluded.payload, updated_at = excluded.updated_at
            """,
            (node_instance_id, canonical_json(draft_payload), now),
        )
        if not approved_form_amendment:
            connection.execute(
                "UPDATE node_instances SET status = 'draft' WHERE id = ?",
                (node_instance_id,),
            )
    return get_instance(row["flow_instance_id"], student_id)


def submit_node(
    node_instance_id: str,
    student_id: int,
    payload: dict[str, Any],
    idempotency_key: str,
) -> dict[str, object]:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            """
            SELECT n.*, i.flow_version_id, i.student_account_id, v.flow_id
            FROM node_instances n
            JOIN flow_instances i ON i.id = n.flow_instance_id
            JOIN flow_versions v ON v.id = i.flow_version_id
            WHERE n.id = ? AND i.student_account_id = ? AND v.status = 'published'
            """,
            (node_instance_id, student_id),
        ).fetchone()
        if row is None:
            raise KeyError(node_instance_id)
        assert_student_roster_access(connection, row["flow_id"], student_id)
        duplicate = connection.execute(
            "SELECT id FROM submissions WHERE node_instance_id = ? AND idempotency_key = ?",
            (node_instance_id, idempotency_key),
        ).fetchone()
        if duplicate is None:
            deadline = effective_deadline(
                connection,
                row["flow_instance_id"],
                row["flow_version_id"],
                row["node_key"],
            )
            config = version_config(connection, row["flow_version_id"])
            node = node_by_key(config, row["node_key"])
            approved_form_amendment = _is_approved_form_amendment(row["status"], node)
            statuses = {
                item["node_key"]: item["status"]
                for item in connection.execute(
                    "SELECT node_key, status FROM node_instances WHERE flow_instance_id = ?",
                    (row["flow_instance_id"],),
                ).fetchall()
            }
            base_status = pending_node_status(
                all(statuses.get(source) == "approved" for source in incoming_nodes(config)[row["node_key"]]),
                node.get("startAt"),
                deadline,
            )
            if base_status == "expired":
                raise RuntimeDeadlineError("节点已超过截止时间")
            if (
                base_status != "available"
                or (
                    row["status"] not in {
                        "available", "draft", "rejected", "scheduled", "locked", "expired"
                    }
                    and not approved_form_amendment
                )
            ):
                raise RuntimeConflictError("当前节点不可提交")
            script_values = (
                node.get("auditScriptId"),
                node.get("auditScriptVersion"),
                node.get("auditScriptHash"),
            )
            configured_count = sum(value not in (None, "") for value in script_values)
            has_audit_script = configured_count == 3
            if configured_count not in {0, 3}:
                raise RuntimeConflictError("审核脚本配置无效，请联系教师")
            if has_audit_script and (
                node.get("kind") not in {"file", "confirmation"}
                or not isinstance(script_values[0], str)
                or not isinstance(script_values[1], int)
                or isinstance(script_values[1], bool)
                or script_values[1] <= 0
                or not isinstance(script_values[2], str)
                or (
                    node.get("auditScriptConfigHash") is not None
                    and not isinstance(node.get("auditScriptConfigHash"), str)
                )
                or not isinstance(node.get("auditScriptParams", {}), dict)
            ):
                raise RuntimeConflictError("审核脚本配置无效，请联系教师")
            submission_payload = payload
            uploaded_file = None
            uploaded_scans: list[dict[str, object]] = []
            if node.get("kind") == "file":
                file_value = payload.get("file")
                if not isinstance(file_value, dict) or not file_value.get("fileId"):
                    raise RuntimeConflictError("请先上传文件")
                uploaded_file = get_uploaded_file_for_node(
                    connection,
                    str(file_value["fileId"]),
                    node_instance_id,
                    student_id,
                )
                if uploaded_file is None:
                    raise RuntimeConflictError("文件不存在、已提交或不属于当前节点")
                submission_payload = dict(payload)
                submission_payload["file"] = {
                    "fileId": uploaded_file["id"],
                    "name": uploaded_file["original_name"],
                    "size": uploaded_file["size_bytes"],
                    "type": uploaded_file["content_type"],
                }
            if node.get("kind") == "confirmation" and node.get("scanAuditEnabled") is True:
                if payload.get("confirmed") is not True:
                    raise RuntimeConflictError("请先确认承诺内容")
                uploaded_scans = get_pending_scans_for_submit(
                    connection, node_instance_id, student_id
                )
                if not uploaded_scans:
                    raise RuntimeConflictError("请先上传扫描件")
                submission_payload = {
                    "confirmed": True,
                    "scans": [
                        {
                            "fileId": item["id"],
                            "name": item["original_name"],
                            "size": item["size_bytes"],
                            "type": item["content_type"],
                            "pageCount": item["page_count"],
                            "order": item["display_order"],
                        }
                        for item in uploaded_scans
                    ],
                }
            if node.get("kind") == "form":
                submission_payload = normalize_form_answers(node, payload, strict=True)
            else:
                try:
                    validate_submission(node, submission_payload)
                except ValueError as exc:
                    raise RuntimeConflictError(str(exc)) from exc
            attempt_no = int(row["attempt_no"]) + 1
            submission_status = (
                "approved"
                if approved_form_amendment
                else "reviewing"
                if has_audit_script
                else "approved"
                if node.get("autoApprove", True)
                else "reviewing"
            )
            submission_id = str(uuid.uuid4())
            connection.execute(
                """
                INSERT INTO submissions
                    (id, node_instance_id, attempt_no, idempotency_key,
                     payload_snapshot, status, submitted_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    submission_id,
                    node_instance_id,
                    attempt_no,
                    idempotency_key,
                    canonical_json(submission_payload),
                    submission_status,
                    now,
                ),
            )
            if uploaded_file is not None:
                try:
                    attach_uploaded_file(connection, str(uploaded_file["id"]), submission_id)
                except FileContextError as exc:
                    raise RuntimeConflictError(str(exc)) from exc
            if uploaded_scans:
                try:
                    attach_uploaded_files(
                        connection, [str(item["id"]) for item in uploaded_scans], submission_id
                    )
                except FileContextError as exc:
                    raise RuntimeConflictError(str(exc)) from exc
            if has_audit_script:
                create_audit_job(
                    connection,
                    submission_id=submission_id,
                    node_instance_id=node_instance_id,
                    script_id=str(script_values[0]),
                    script_version=int(script_values[1]),
                    script_sha256=str(script_values[2]),
                    now=now,
                )
            connection.execute(
                "DELETE FROM node_drafts WHERE node_instance_id = ?",
                (node_instance_id,),
            )
            connection.execute(
                """
                UPDATE node_instances
                SET status = ?, submitted_at = ?, approved_at = ?, attempt_no = ?
                WHERE id = ?
                """,
                (
                    submission_status,
                    now,
                    now if submission_status == "approved" else None,
                    attempt_no,
                    node_instance_id,
                ),
            )
            if submission_status == "approved":
                advance_downstream(
                    connection,
                    row["flow_instance_id"],
                    row["flow_version_id"],
                    config,
                )
            complete_flow_if_ready(connection, row["flow_instance_id"], now)
    return get_instance(row["flow_instance_id"], student_id)


def _audit_summary(
    row, status: str, config_node: dict[str, Any]
) -> dict[str, object] | None:
    if row["audit_job_status"] is None:
        return None
    result: dict[str, object] = {}
    if row["audit_result_json"]:
        try:
            parsed = json.loads(row["audit_result_json"])
            if isinstance(parsed, dict):
                result = parsed
        except json.JSONDecodeError:
            result = {}
    reason = result.get("reason") if isinstance(result.get("reason"), str) else None
    details = result.get("details") if isinstance(result.get("details"), dict) else None
    if status == "audit_error":
        reason = "自动审核暂时失败，请重新审核"
        details = None
    elif (
        config_node.get("kind") == "confirmation"
        and config_node.get("scanAuditMode") == "score"
    ):
        reason = None
        details = None
    elif config_node.get("kind") == "confirmation" and isinstance(details, dict):
        details = None
    return {
        "status": status,
        "reason": reason,
        "details": details,
        "attemptCount": int(row["audit_attempt_count"] or 0),
        "canRetry": status == "audit_error" and row["audit_job_status"] == "failed",
    }


def set_student_deadline(
    instance_id: str,
    node_key: str,
    deadline_at: str,
    reason: str,
    teacher_id: int,
) -> dict[str, object]:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        exists = connection.execute(
            """
            SELECT i.id,
                   i.flow_version_id,
                   v.config_snapshot,
                   n.status AS node_status,
                   r.deadline_at AS global_deadline,
                   o.deadline_at AS override_deadline
            FROM flow_instances i
            JOIN flow_versions v ON v.id = i.flow_version_id
            JOIN flows f ON f.id = v.flow_id
            JOIN node_instances n
              ON n.flow_instance_id = i.id AND n.node_key = ?
            LEFT JOIN flow_node_runtime_configs r
              ON r.flow_version_id = i.flow_version_id AND r.node_key = n.node_key
            LEFT JOIN student_deadline_overrides o
              ON o.flow_instance_id = i.id AND o.node_key = n.node_key
            WHERE i.id = ? AND f.owner_id = ? AND v.status = 'published'
            """,
            (node_key, instance_id, str(teacher_id)),
        ).fetchone()
        if exists is None:
            raise KeyError(instance_id)
        clean_reason = reason.strip()
        if not clean_reason:
            raise StudentDeadlineValidationError("请填写延期原因")
        config = json.loads(exists["config_snapshot"])
        node = node_by_key(config, node_key)
        if exists["node_status"] == "approved" and node.get("kind") != "form":
            raise StudentDeadlineValidationError("已通过的非表单节点不能延期")

        current_deadline_value = exists["override_deadline"] or exists["global_deadline"]
        if current_deadline_value is None:
            raise StudentDeadlineValidationError("无截止时间的节点不能设置延期")

        new_deadline = _parse_student_deadline(deadline_at)
        current_deadline = parse_datetime(current_deadline_value)
        now_datetime = datetime.now(UTC)
        if new_deadline <= now_datetime:
            raise StudentDeadlineValidationError("延期截止时间必须晚于当前时间")
        if current_deadline is None or new_deadline <= current_deadline:
            raise StudentDeadlineValidationError("延期截止时间必须晚于当前生效截止时间")
        normalized_deadline = new_deadline.isoformat()
        connection.execute(
            """
            INSERT INTO student_deadline_overrides
                (flow_instance_id, node_key, deadline_at, reason, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(flow_instance_id, node_key) DO UPDATE
            SET deadline_at = excluded.deadline_at, reason = excluded.reason,
                created_by = excluded.created_by, created_at = excluded.created_at
            """,
            (instance_id, node_key, normalized_deadline, clean_reason, str(teacher_id), now),
        )
        connection.execute(
            """
            UPDATE node_instances SET status = CASE
                WHEN EXISTS (SELECT 1 FROM node_drafts d WHERE d.node_instance_id = node_instances.id)
                THEN 'draft' ELSE 'available' END
            WHERE flow_instance_id = ? AND node_key = ? AND status = 'expired'
            """,
            (instance_id, node_key),
        )
        node_row = connection.execute(
            "SELECT id, status FROM node_instances WHERE flow_instance_id = ? AND node_key = ?",
            (instance_id, node_key),
        ).fetchone()
        statuses = {
            row["node_key"]: row["status"]
            for row in connection.execute(
                "SELECT node_key, status FROM node_instances WHERE flow_instance_id = ?",
                (instance_id,),
            ).fetchall()
        }
        next_status = pending_node_status(
            all(statuses.get(source) == "approved" for source in incoming_nodes(config)[node_key]),
            node.get("startAt"),
            normalized_deadline,
        )
        if next_status == "available":
            draft = connection.execute(
                "SELECT 1 FROM node_drafts WHERE node_instance_id = ?", (node_row["id"],)
            ).fetchone()
            next_status = "draft" if draft else "available"
        if node_row["status"] in {"expired", "scheduled", "locked", "available", "draft"}:
            connection.execute(
                "UPDATE node_instances SET status = ?, opened_at = ? WHERE id = ?",
                (next_status, now if next_status == "available" else None, node_row["id"]),
            )
        connection.execute(
            """
            INSERT INTO audit_logs
                (actor_id, action, entity_type, entity_id, after_data, reason, created_at)
            VALUES (?, 'deadline_override', 'node_instance', ?, ?, ?, ?)
            """,
            (
                str(teacher_id),
                f"{instance_id}:{node_key}",
                canonical_json({"deadlineAt": normalized_deadline}),
                clean_reason,
                now,
            ),
        )
    return get_instance(instance_id)


def get_version_progress(version_id: str, teacher_id: int) -> dict[str, object]:
    with get_connection() as connection:
        version = connection.execute(
            """
            SELECT v.id, v.flow_id, v.config_snapshot, f.name FROM flow_versions v
            JOIN flows f ON f.id = v.flow_id
            WHERE v.id = ? AND f.owner_id = ?
            """,
            (version_id, str(teacher_id)),
        ).fetchone()
        if version is None:
            raise KeyError(version_id)
        rows = connection.execute(
            """
            SELECT i.id, i.status, i.last_active_at, a.student_no, a.name,
                   SUM(CASE WHEN n.status = 'approved' THEN 1 ELSE 0 END) AS approved_count,
                   COUNT(n.id) AS total_count,
                   SUM(CASE WHEN n.status = 'expired' THEN 1 ELSE 0 END) AS expired_count
            FROM flow_instances i
            JOIN student_accounts a ON a.id = i.student_account_id
            JOIN node_instances n ON n.flow_instance_id = i.id
            WHERE i.flow_version_id = ?
            GROUP BY i.id, a.id
            ORDER BY a.student_no
            """,
            (version_id,),
        ).fetchall()
        config = json.loads(version["config_snapshot"])
        node_titles = {
            str(node["id"]): str(node.get("title") or node["id"])
            for node in config["nodes"]
        }
        node_rows = connection.execute(
            """
            SELECT n.flow_instance_id,
                   n.id AS node_instance_id,
                   n.node_key,
                   n.status,
                   r.deadline_at AS global_deadline,
                   o.deadline_at AS override_deadline
            FROM node_instances n
            JOIN flow_instances i ON i.id = n.flow_instance_id
            LEFT JOIN flow_node_runtime_configs r
              ON r.flow_version_id = i.flow_version_id AND r.node_key = n.node_key
            LEFT JOIN student_deadline_overrides o
              ON o.flow_instance_id = i.id AND o.node_key = n.node_key
            WHERE i.flow_version_id = ?
            ORDER BY n.flow_instance_id, n.rowid
            """,
            (version_id,),
        ).fetchall()
    nodes_by_instance: dict[str, list[dict[str, object]]] = {}
    for row in node_rows:
        nodes_by_instance.setdefault(str(row["flow_instance_id"]), []).append(
            {
                "nodeInstanceId": row["node_instance_id"],
                "nodeKey": row["node_key"],
                "title": node_titles.get(row["node_key"], row["node_key"]),
                "status": row["status"],
                "globalDeadline": row["global_deadline"],
                "overrideDeadline": row["override_deadline"],
                "effectiveDeadline": row["override_deadline"] or row["global_deadline"],
            }
        )
    return {
        "flowVersionId": version_id,
        "name": version["name"],
        "students": [
            {
                "instanceId": row["id"],
                "studentNo": row["student_no"],
                "name": row["name"],
                "status": row["status"],
                "approvedCount": row["approved_count"],
                "totalCount": row["total_count"],
                "expiredCount": row["expired_count"],
                "lastActiveAt": row["last_active_at"],
                "nodes": nodes_by_instance.get(str(row["id"]), []),
            }
            for row in rows
        ],
    }


def get_teacher_submission_detail(
    node_instance_id: str, teacher_id: int
) -> dict[str, object]:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT n.id, n.node_key, n.status, i.student_account_id,
                   a.student_no, a.name AS student_name, v.config_snapshot,
                   s.id AS submission_id, j.result_json, j.status AS audit_job_status
            FROM node_instances n
            JOIN flow_instances i ON i.id = n.flow_instance_id
            JOIN student_accounts a ON a.id = i.student_account_id
            JOIN flow_versions v ON v.id = i.flow_version_id
            JOIN flows f ON f.id = v.flow_id
            LEFT JOIN submissions s
              ON s.node_instance_id = n.id AND s.attempt_no = n.attempt_no
            LEFT JOIN audit_jobs j ON j.submission_id = s.id
            WHERE n.id = ? AND f.owner_id = ?
            """,
            (node_instance_id, str(teacher_id)),
        ).fetchone()
        if row is None:
            raise KeyError(node_instance_id)
        config = json.loads(row["config_snapshot"])
        node = node_by_key(config, row["node_key"])
        result = _json_object(row["result_json"])
        details = result.get("details") if isinstance(result.get("details"), dict) else {}
        mode = node.get("scanAuditMode")
        score_value = details.get("score")
        score = (
            float(score_value)
            if mode == "score"
            and not isinstance(score_value, bool)
            and isinstance(score_value, (int, float))
            and math.isfinite(float(score_value))
            and 0 <= float(score_value) <= 100
            else None
        )
        scans = connection.execute(
            """SELECT id, original_name, content_type, size_bytes, page_count, storage_key
               FROM uploaded_files WHERE submission_id = ?
               ORDER BY display_order, created_at, id""",
            (row["submission_id"],),
        ).fetchall() if row["submission_id"] else []
    return {
        "nodeInstanceId": row["id"],
        "nodeTitle": node.get("title") or row["node_key"],
        "student": {"studentNo": row["student_no"], "name": row["student_name"]},
        "mode": mode,
        "status": row["status"],
        "auditJobStatus": row["audit_job_status"],
        "passed": result.get("passed") if isinstance(result.get("passed"), bool) else None,
        "score": score,
        "reason": result.get("reason") if isinstance(result.get("reason"), str) else None,
        "scans": [dict(scan) for scan in scans],
    }
