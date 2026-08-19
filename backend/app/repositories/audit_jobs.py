import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from app.core.database import get_connection
from app.repositories.flow_roster import assert_student_roster_access
from app.repositories.flow_runtime_state import advance_downstream, complete_flow_if_ready, version_config
from app.repositories.workflows import canonical_json
from app.services.audit_script_executor import AuditMaterial
from app.services.security import utc_now_iso


RETRY_DELAYS_SECONDS = (1, 5, 15)


class AuditJobConflictError(ValueError):
    pass


@dataclass(frozen=True)
class ClaimedAuditJob:
    id: str
    script_id: str
    script_generation: int
    script_content_hash: str
    policy_generation: int
    policy_hash: str
    script_params: dict[str, object]
    script_settings: dict[str, object]
    materials: list[AuditMaterial]
    context: dict[str, object]


def create_audit_job(
    connection,
    *,
    submission_id: str,
    node_instance_id: str,
    flow_id: str,
    node_key: str,
    script_id: str,
    script_generation: int,
    script_content_hash: str,
    policy_generation: int,
    policy_hash: str,
    script_params: dict[str, object],
    script_settings: dict[str, object],
    now: str,
) -> str:
    job_id = str(uuid.uuid4())
    connection.execute(
        """
        INSERT INTO audit_jobs
            (id, submission_id, node_instance_id, flow_id, node_key, script_id,
             script_generation, script_content_hash, policy_generation, policy_hash,
             effective_params_json, effective_settings_json, status,
             next_attempt_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        """,
        (
            job_id, submission_id, node_instance_id, flow_id, node_key, script_id,
            script_generation, script_content_hash, policy_generation, policy_hash,
            canonical_json(script_params), canonical_json(script_settings), now, now, now,
        ),
    )
    return job_id


def claim_next_audit_job() -> ClaimedAuditJob | None:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            """
            SELECT j.id FROM audit_jobs j
            JOIN audit_script_runtime_states r ON r.script_id = j.script_id
            WHERE j.status = 'pending' AND j.next_attempt_at <= ?
              AND r.status = 'ready'
              AND r.generation = j.script_generation
              AND r.content_hash = j.script_content_hash
              AND (
                SELECT COUNT(*) FROM audit_jobs active
                WHERE active.script_id = j.script_id AND active.status = 'running'
              ) < r.max_concurrency
              AND (
                NOT EXISTS (
                  SELECT 1 FROM node_instances n
                  JOIN flow_instances i ON i.id = n.flow_instance_id
                  JOIN flow_versions v ON v.id = i.flow_version_id
                  WHERE n.id = j.node_instance_id AND v.status = 'preview'
                )
                OR EXISTS (
                  SELECT 1 FROM node_instances n
                  JOIN flow_preview_sessions p ON p.flow_instance_id = n.flow_instance_id
                  WHERE n.id = j.node_instance_id
                    AND p.status = 'active' AND p.expires_at > ?
                )
              )
            ORDER BY j.next_attempt_at, j.created_at
            LIMIT 1
            """,
            (now, now),
        ).fetchone()
        if row is None:
            return None
        job_id = str(row["id"])
        updated = connection.execute(
            """
            UPDATE audit_jobs SET status = 'running', attempt_count = attempt_count + 1,
                claimed_at = ?, updated_at = ?
            WHERE id = ? AND status = 'pending'
            """,
            (now, now, job_id),
        ).rowcount
        if updated != 1:
            return None
        job = connection.execute(
            """
            SELECT j.*, s.attempt_no, n.flow_instance_id, i.flow_version_id
            FROM audit_jobs j
            JOIN submissions s ON s.id = j.submission_id
            JOIN node_instances n ON n.id = j.node_instance_id
            JOIN flow_instances i ON i.id = n.flow_instance_id
            WHERE j.id = ?
            """,
            (job_id,),
        ).fetchone()
        file_rows = connection.execute(
            """
            SELECT id, original_name, storage_key, content_type, size_bytes, sha256, page_count
            FROM uploaded_files WHERE submission_id = ? ORDER BY display_order, created_at, id
            """,
            (job["submission_id"],),
        ).fetchall()
        materials = [
            AuditMaterial(
                id=file["id"], name=file["original_name"], storage_key=file["storage_key"],
                content_type=file["content_type"], size=int(file["size_bytes"]),
                sha256=file["sha256"], page_count=int(file["page_count"]),
            )
            for file in file_rows
        ]
        return ClaimedAuditJob(
            id=job_id,
            script_id=job["script_id"],
            script_generation=int(job["script_generation"]),
            script_content_hash=job["script_content_hash"],
            policy_generation=int(job["policy_generation"]),
            policy_hash=job["policy_hash"],
            script_params=json.loads(job["effective_params_json"]),
            script_settings=json.loads(job["effective_settings_json"]),
            materials=materials,
            context={
                "flowId": job["flow_id"], "flowVersionId": job["flow_version_id"],
                "flowInstanceId": job["flow_instance_id"],
                "nodeInstanceId": job["node_instance_id"], "nodeKey": job["node_key"],
                "submissionId": job["submission_id"], "attemptNo": int(job["attempt_no"]),
            },
        )


def audit_job_execution_allowed(job_id: str) -> bool:
    with get_connection() as connection:
        job = _current_job_context(connection, job_id)
        return bool(job and job["job_status"] == "running" and _generation_matches(connection, job))


def complete_audit_job(job_id: str, result: dict[str, object]) -> None:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        job = _current_job_context(connection, job_id)
        if job is None or job["job_status"] != "running":
            return
        if not _audit_write_allowed(connection, job) or not _generation_matches(connection, job):
            return
        connection.execute(
            """UPDATE audit_jobs SET status = 'succeeded', result_json = ?, error_message = NULL,
               finished_at = ?, updated_at = ? WHERE id = ? AND status = 'running'""",
            (canonical_json(result), now, now, job_id),
        )
        if not _is_current_attempt(job) or job["node_status"] not in {"reviewing", "audit_error"}:
            return
        passed = result.get("passed") is True
        next_status = "approved" if passed else "rejected"
        connection.execute("UPDATE submissions SET status = ? WHERE id = ?", (next_status, job["submission_id"]))
        updated = connection.execute(
            """UPDATE node_instances SET status = ?, approved_at = ?
               WHERE id = ? AND status IN ('reviewing', 'audit_error')""",
            (next_status, now if passed else None, job["node_instance_id"]),
        ).rowcount
        if passed and updated == 1:
            config = version_config(connection, job["flow_version_id"])
            advance_downstream(connection, job["flow_instance_id"], job["flow_version_id"], config)
            complete_flow_if_ready(connection, job["flow_instance_id"], now)


def fail_audit_job(job_id: str, message: str) -> None:
    now = datetime.now(UTC)
    now_iso = now.isoformat()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        job = _current_job_context(connection, job_id)
        if job is None or job["job_status"] != "running":
            return
        if not _audit_write_allowed(connection, job) or not _generation_matches(connection, job):
            return
        attempt_count = int(job["attempt_count"])
        if attempt_count <= len(RETRY_DELAYS_SECONDS):
            next_attempt = now + timedelta(seconds=RETRY_DELAYS_SECONDS[attempt_count - 1])
            connection.execute(
                """UPDATE audit_jobs SET status = 'pending', next_attempt_at = ?,
                   error_message = ?, claimed_at = NULL, updated_at = ? WHERE id = ?""",
                (next_attempt.isoformat(), message, now_iso, job_id),
            )
            return
        connection.execute(
            """UPDATE audit_jobs SET status = 'failed', error_message = ?,
               finished_at = ?, updated_at = ? WHERE id = ?""",
            (message, now_iso, now_iso, job_id),
        )
        if _is_current_attempt(job):
            connection.execute("UPDATE submissions SET status = 'audit_error' WHERE id = ?", (job["submission_id"],))
            connection.execute(
                """UPDATE node_instances SET status = 'audit_error', approved_at = NULL
                   WHERE id = ? AND status = 'reviewing'""",
                (job["node_instance_id"],),
            )


def cancel_audit_jobs_for_script(script_id: str, reason: str) -> list[str]:
    return _cancel_jobs("j.script_id = ?", (script_id,), reason)


def cancel_audit_jobs_for_policy(flow_id: str, node_key: str, reason: str) -> list[str]:
    return _cancel_jobs("j.flow_id = ? AND j.node_key = ?", (flow_id, node_key), reason)


def cancel_audit_job(job_id: str, reason: str) -> list[str]:
    return _cancel_jobs("j.id = ?", (job_id,), reason)


def _cancel_jobs(condition: str, values: tuple[object, ...], reason: str) -> list[str]:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        rows = connection.execute(
            f"""SELECT j.id, j.status, j.submission_id, j.node_instance_id,
                       s.attempt_no AS submission_attempt, n.attempt_no AS node_attempt
                FROM audit_jobs j
                JOIN submissions s ON s.id = j.submission_id
                JOIN node_instances n ON n.id = j.node_instance_id
                WHERE ({condition}) AND j.status IN ('pending', 'running')""",
            values,
        ).fetchall()
        running_ids = [str(row["id"]) for row in rows if row["status"] == "running"]
        for row in rows:
            connection.execute(
                """UPDATE audit_jobs SET status = 'cancelled', cancellation_reason = ?,
                   finished_at = ?, updated_at = ? WHERE id = ?""",
                (reason, now, now, row["id"]),
            )
            connection.execute("UPDATE submissions SET status = 'cancelled' WHERE id = ?", (row["submission_id"],))
            if int(row["submission_attempt"]) == int(row["node_attempt"]):
                connection.execute(
                    """UPDATE node_instances SET status = 'available', approved_at = NULL
                       WHERE id = ? AND status = 'reviewing'""",
                    (row["node_instance_id"],),
                )
        return running_ids


def recover_audit_jobs() -> None:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        stale_scripts = connection.execute(
            """
            SELECT j.id FROM audit_jobs j
            LEFT JOIN audit_script_runtime_states r ON r.script_id = j.script_id
            WHERE j.status IN ('pending', 'running')
              AND (r.script_id IS NULL OR r.status != 'ready'
                   OR r.generation != j.script_generation
                   OR r.content_hash != j.script_content_hash)
            """
        ).fetchall()
        stale_policies = connection.execute(
            """
            SELECT j.id FROM audit_jobs j
            LEFT JOIN node_audit_policies p
              ON p.flow_id = j.flow_id AND p.node_key = j.node_key
            WHERE j.status IN ('pending', 'running')
              AND (p.flow_id IS NULL OR p.generation != j.policy_generation
                   OR p.policy_hash != j.policy_hash)
            """
        ).fetchall()
        expired_previews = connection.execute(
            """
            SELECT j.id FROM audit_jobs j
            JOIN node_instances n ON n.id = j.node_instance_id
            JOIN flow_instances i ON i.id = n.flow_instance_id
            JOIN flow_versions v ON v.id = i.flow_version_id
            WHERE j.status IN ('pending', 'running') AND v.status = 'preview'
              AND NOT EXISTS (
                SELECT 1 FROM flow_preview_sessions p
                WHERE p.flow_instance_id = i.id AND p.status = 'active' AND p.expires_at > ?
              )
            """,
            (now,),
        ).fetchall()
    for row in stale_scripts:
        _cancel_jobs("j.id = ?", (row["id"],), "script_updated")
    for row in stale_policies:
        _cancel_jobs("j.id = ?", (row["id"],), "policy_updated")
    for row in expired_previews:
        _cancel_jobs("j.id = ?", (row["id"],), "preview_expired")
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            """UPDATE audit_jobs SET status = 'pending', claimed_at = NULL,
               next_attempt_at = ?, updated_at = ? WHERE status = 'running'""",
            (now, now),
        )
        missing = connection.execute(
            """
            SELECT n.id AS node_instance_id, s.id AS submission_id
            FROM node_instances n
            JOIN submissions s ON s.node_instance_id = n.id AND s.attempt_no = n.attempt_no
            WHERE n.status = 'reviewing'
              AND NOT EXISTS (SELECT 1 FROM audit_jobs j WHERE j.submission_id = s.id)
            """
        ).fetchall()
        for row in missing:
            connection.execute("UPDATE submissions SET status = 'cancelled' WHERE id = ?", (row["submission_id"],))
            connection.execute("UPDATE node_instances SET status = 'available' WHERE id = ?", (row["node_instance_id"],))


def retry_audit_job(node_instance_id: str, student_id: int) -> str:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            """
            SELECT n.id, n.status, n.flow_instance_id, i.student_account_id, v.flow_id,
                   s.id AS submission_id, j.id AS job_id, j.status AS job_status
            FROM node_instances n
            JOIN flow_instances i ON i.id = n.flow_instance_id
            JOIN flow_versions v ON v.id = i.flow_version_id
            JOIN submissions s ON s.node_instance_id = n.id AND s.attempt_no = n.attempt_no
            JOIN audit_jobs j ON j.submission_id = s.id
            WHERE n.id = ? AND i.student_account_id = ?
            """,
            (node_instance_id, student_id),
        ).fetchone()
        if row is None:
            raise KeyError(node_instance_id)
        assert_student_roster_access(connection, row["flow_id"], student_id)
        if row["status"] != "audit_error" or row["job_status"] != "failed":
            raise AuditJobConflictError("当前节点不可重新审核")
        connection.execute(
            """UPDATE audit_jobs SET status = 'pending', attempt_count = 0,
               next_attempt_at = ?, result_json = NULL, error_message = NULL,
               cancellation_reason = NULL, claimed_at = NULL, finished_at = NULL,
               updated_at = ? WHERE id = ?""",
            (now, now, row["job_id"]),
        )
        connection.execute("UPDATE submissions SET status = 'reviewing' WHERE id = ?", (row["submission_id"],))
        connection.execute("UPDATE node_instances SET status = 'reviewing', approved_at = NULL WHERE id = ?", (node_instance_id,))
        return str(row["flow_instance_id"])


def _current_job_context(connection, job_id: str):
    return connection.execute(
        """
        SELECT j.status AS job_status, j.attempt_count, j.submission_id,
               j.node_instance_id, j.flow_id, j.node_key, j.script_id,
               j.script_generation, j.script_content_hash, j.policy_generation, j.policy_hash,
               s.attempt_no AS submission_attempt, n.attempt_no AS node_attempt,
               n.status AS node_status, n.flow_instance_id, i.flow_version_id,
               v.status AS version_status
        FROM audit_jobs j
        JOIN submissions s ON s.id = j.submission_id
        JOIN node_instances n ON n.id = j.node_instance_id
        JOIN flow_instances i ON i.id = n.flow_instance_id
        JOIN flow_versions v ON v.id = i.flow_version_id
        WHERE j.id = ?
        """,
        (job_id,),
    ).fetchone()


def _generation_matches(connection, job) -> bool:
    state = connection.execute(
        "SELECT generation, content_hash, status FROM audit_script_runtime_states WHERE script_id = ?",
        (job["script_id"],),
    ).fetchone()
    policy = connection.execute(
        "SELECT generation, policy_hash FROM node_audit_policies WHERE flow_id = ? AND node_key = ?",
        (job["flow_id"], job["node_key"]),
    ).fetchone()
    return bool(
        state and state["status"] == "ready"
        and int(state["generation"]) == int(job["script_generation"])
        and state["content_hash"] == job["script_content_hash"]
        and policy and int(policy["generation"]) == int(job["policy_generation"])
        and policy["policy_hash"] == job["policy_hash"]
    )


def _is_current_attempt(job) -> bool:
    return int(job["submission_attempt"]) == int(job["node_attempt"])


def _audit_write_allowed(connection, job) -> bool:
    if job["version_status"] != "preview":
        return True
    return connection.execute(
        """SELECT 1 FROM flow_preview_sessions WHERE flow_instance_id = ?
           AND status = 'active' AND expires_at > ?""",
        (job["flow_instance_id"], utc_now_iso()),
    ).fetchone() is not None
