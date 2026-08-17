import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.database import get_connection
from app.repositories.flow_roster import assert_student_roster_access
from app.repositories.flow_runtime_state import (
    advance_downstream,
    complete_flow_if_ready,
    version_config,
)
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
    script_version: int
    script_sha256: str
    snapshot_script_id: object
    snapshot_script_version: object
    snapshot_script_sha256: object
    script_config_sha256: str | None
    script_params: object
    script_settings: object
    materials: list[AuditMaterial]
    context: dict[str, object]


def create_audit_job(
    connection,
    *,
    submission_id: str,
    node_instance_id: str,
    script_id: str,
    script_version: int,
    script_sha256: str,
    now: str,
) -> str:
    job_id = str(uuid.uuid4())
    connection.execute(
        """
        INSERT INTO audit_jobs
            (id, submission_id, node_instance_id, script_id, script_version,
             script_sha256, status, next_attempt_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        """,
        (
            job_id,
            submission_id,
            node_instance_id,
            script_id,
            script_version,
            script_sha256,
            now,
            now,
            now,
        ),
    )
    return job_id


def claim_next_audit_job() -> ClaimedAuditJob | None:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            """
            SELECT id FROM audit_jobs
            WHERE status = 'pending' AND next_attempt_at <= ?
              AND (
                NOT EXISTS (
                  SELECT 1 FROM node_instances n
                  JOIN flow_instances i ON i.id = n.flow_instance_id
                  JOIN flow_versions v ON v.id = i.flow_version_id
                  WHERE n.id = audit_jobs.node_instance_id AND v.status = 'preview'
                )
                OR EXISTS (
                  SELECT 1 FROM node_instances n
                  JOIN flow_preview_sessions p ON p.flow_instance_id = n.flow_instance_id
                  WHERE n.id = audit_jobs.node_instance_id
                    AND p.status = 'active' AND p.expires_at > ?
                )
              )
            ORDER BY next_attempt_at, created_at
            LIMIT 1
            """,
            (now, now),
        ).fetchone()
        if row is None:
            return None
        job_id = row["id"]
        updated = connection.execute(
            """
            UPDATE audit_jobs
            SET status = 'running', attempt_count = attempt_count + 1,
                claimed_at = ?, updated_at = ?
            WHERE id = ? AND status = 'pending'
            """,
            (now, now, job_id),
        ).rowcount
        if updated != 1:
            return None
        job = connection.execute(
            """
            SELECT j.*, s.attempt_no, n.node_key, n.flow_instance_id,
                   i.flow_version_id, v.flow_id, v.config_snapshot
            FROM audit_jobs j
            JOIN submissions s ON s.id = j.submission_id
            JOIN node_instances n ON n.id = j.node_instance_id
            JOIN flow_instances i ON i.id = n.flow_instance_id
            JOIN flow_versions v ON v.id = i.flow_version_id
            WHERE j.id = ?
            """,
            (job_id,),
        ).fetchone()
        if job is None:
            return None
        file_rows = connection.execute(
            """
            SELECT id, original_name, storage_key, content_type, size_bytes, sha256, page_count
            FROM uploaded_files WHERE submission_id = ? ORDER BY display_order, created_at, id
            """,
            (job["submission_id"],),
        ).fetchall()
        materials = [
            AuditMaterial(
                id=file["id"],
                name=file["original_name"],
                storage_key=file["storage_key"],
                content_type=file["content_type"],
                size=int(file["size_bytes"]),
                sha256=file["sha256"],
                page_count=int(file["page_count"]),
            )
            for file in file_rows
        ]
        config = json.loads(job["config_snapshot"])
        raw_config_node = next(
            (
                node
                for node in config["nodes"]
                if isinstance(node, dict) and node.get("id") == job["node_key"]
            ),
            None,
        )
        config_node = raw_config_node if isinstance(raw_config_node, dict) else {}
        return ClaimedAuditJob(
            id=job["id"],
            script_id=job["script_id"],
            script_version=int(job["script_version"]),
            script_sha256=job["script_sha256"],
            snapshot_script_id=config_node.get("auditScriptId"),
            snapshot_script_version=config_node.get("auditScriptVersion"),
            snapshot_script_sha256=config_node.get("auditScriptHash"),
            script_config_sha256=config_node.get("auditScriptConfigHash"),
            script_params=config_node.get("auditScriptParams", {}),
            script_settings=config_node.get("auditScriptSettings", {}),
            materials=materials,
            context={
                "flowId": job["flow_id"],
                "flowVersionId": job["flow_version_id"],
                "flowInstanceId": job["flow_instance_id"],
                "nodeInstanceId": job["node_instance_id"],
                "nodeKey": job["node_key"],
                "submissionId": job["submission_id"],
                "attemptNo": int(job["attempt_no"]),
            },
        )


def complete_audit_job(job_id: str, result: dict[str, object]) -> None:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        job = _current_job_context(connection, job_id)
        if job is None or job["job_status"] != "running":
            return
        if not _audit_write_allowed(connection, job):
            return
        connection.execute(
            """
            UPDATE audit_jobs
            SET status = 'succeeded', result_json = ?, error_message = NULL,
                finished_at = ?, updated_at = ? WHERE id = ?
            """,
            (canonical_json(result), now, now, job_id),
        )
        if not _is_current_attempt(job) or job["node_status"] not in {
            "reviewing",
            "audit_error",
        }:
            return
        passed = result.get("passed") is True
        next_status = "approved" if passed else "rejected"
        connection.execute(
            "UPDATE submissions SET status = ? WHERE id = ?",
            (next_status, job["submission_id"]),
        )
        updated = connection.execute(
            """
            UPDATE node_instances
            SET status = ?, approved_at = ?
            WHERE id = ? AND status IN ('reviewing', 'audit_error')
            """,
            (next_status, now if passed else None, job["node_instance_id"]),
        ).rowcount
        if passed and updated == 1:
            config = version_config(connection, job["flow_version_id"])
            advance_downstream(
                connection,
                job["flow_instance_id"],
                job["flow_version_id"],
                config,
            )
            complete_flow_if_ready(connection, job["flow_instance_id"], now)


def fail_audit_job(job_id: str, message: str) -> None:
    now = datetime.now(UTC)
    now_iso = now.isoformat()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        job = _current_job_context(connection, job_id)
        if job is None or job["job_status"] != "running":
            return
        if not _audit_write_allowed(connection, job):
            return
        attempt_count = int(job["attempt_count"])
        if attempt_count <= len(RETRY_DELAYS_SECONDS):
            next_attempt = now + timedelta(seconds=RETRY_DELAYS_SECONDS[attempt_count - 1])
            connection.execute(
                """
                UPDATE audit_jobs
                SET status = 'pending', next_attempt_at = ?, error_message = ?,
                    claimed_at = NULL, updated_at = ? WHERE id = ?
                """,
                (next_attempt.isoformat(), message, now_iso, job_id),
            )
            return
        connection.execute(
            """
            UPDATE audit_jobs
            SET status = 'failed', error_message = ?, finished_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (message, now_iso, now_iso, job_id),
        )
        if _is_current_attempt(job):
            connection.execute(
                "UPDATE submissions SET status = 'audit_error' WHERE id = ?",
                (job["submission_id"],),
            )
            connection.execute(
                """
                UPDATE node_instances SET status = 'audit_error', approved_at = NULL
                WHERE id = ? AND status = 'reviewing'
                """,
                (job["node_instance_id"],),
            )


def recover_audit_jobs() -> None:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            """
            UPDATE audit_jobs
            SET status = 'pending', claimed_at = NULL, next_attempt_at = ?, updated_at = ?
            WHERE status = 'running'
              AND (
                NOT EXISTS (
                  SELECT 1 FROM node_instances n
                  JOIN flow_instances i ON i.id = n.flow_instance_id
                  JOIN flow_versions v ON v.id = i.flow_version_id
                  WHERE n.id = audit_jobs.node_instance_id AND v.status = 'preview'
                )
                OR EXISTS (
                  SELECT 1 FROM node_instances n
                  JOIN flow_preview_sessions p ON p.flow_instance_id = n.flow_instance_id
                  WHERE n.id = audit_jobs.node_instance_id
                    AND p.status = 'active' AND p.expires_at > ?
                )
              )
            """,
            (now, now, now),
        )
        rows = connection.execute(
            """
            SELECT n.id AS node_instance_id, n.node_key, n.attempt_no,
                   i.flow_version_id, v.config_snapshot, s.id AS submission_id
            FROM node_instances n
            JOIN flow_instances i ON i.id = n.flow_instance_id
            JOIN flow_versions v ON v.id = i.flow_version_id
            JOIN submissions s ON s.node_instance_id = n.id AND s.attempt_no = n.attempt_no
            WHERE n.status = 'reviewing'
              AND EXISTS (SELECT 1 FROM uploaded_files u WHERE u.submission_id = s.id)
              AND NOT EXISTS (SELECT 1 FROM audit_jobs j WHERE j.submission_id = s.id)
              AND (
                v.status != 'preview'
                OR EXISTS (
                  SELECT 1 FROM flow_preview_sessions p
                  WHERE p.flow_instance_id = i.id
                    AND p.status = 'active' AND p.expires_at > ?
                )
              )
            """
            , (now,)
        ).fetchall()
        for row in rows:
            config = json.loads(row["config_snapshot"])
            node = next(
                (item for item in config.get("nodes", []) if item.get("id") == row["node_key"]),
                None,
            )
            script = _script_config(node)
            if script is None:
                continue
            create_audit_job(
                connection,
                submission_id=row["submission_id"],
                node_instance_id=row["node_instance_id"],
                script_id=script[0],
                script_version=script[1],
                script_sha256=script[2],
                now=now,
            )


def retry_audit_job(node_instance_id: str, student_id: int) -> str:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            """
            SELECT n.id, n.status, n.attempt_no, n.flow_instance_id,
                   i.student_account_id, v.flow_id, s.id AS submission_id,
                   j.id AS job_id, j.status AS job_status
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
        has_file = connection.execute(
            "SELECT 1 FROM uploaded_files WHERE submission_id = ? LIMIT 1",
            (row["submission_id"],),
        ).fetchone()
        if has_file is None:
            raise AuditJobConflictError("原提交文件不存在，请重新上传")
        connection.execute(
            """
            UPDATE audit_jobs
            SET status = 'pending', attempt_count = 0, next_attempt_at = ?,
                result_json = NULL, error_message = NULL, claimed_at = NULL,
                finished_at = NULL, updated_at = ? WHERE id = ?
            """,
            (now, now, row["job_id"]),
        )
        connection.execute(
            "UPDATE submissions SET status = 'reviewing' WHERE id = ?",
            (row["submission_id"],),
        )
        connection.execute(
            "UPDATE node_instances SET status = 'reviewing', approved_at = NULL WHERE id = ?",
            (node_instance_id,),
        )
        return row["flow_instance_id"]


def _current_job_context(connection, job_id: str):
    return connection.execute(
        """
        SELECT j.status AS job_status, j.attempt_count, j.submission_id,
               j.node_instance_id, s.attempt_no AS submission_attempt,
               n.attempt_no AS node_attempt, n.status AS node_status,
               n.flow_instance_id, i.flow_version_id, v.status AS version_status
        FROM audit_jobs j
        JOIN submissions s ON s.id = j.submission_id
        JOIN node_instances n ON n.id = j.node_instance_id
        JOIN flow_instances i ON i.id = n.flow_instance_id
        JOIN flow_versions v ON v.id = i.flow_version_id
        WHERE j.id = ?
        """,
        (job_id,),
    ).fetchone()


def _is_current_attempt(job) -> bool:
    return int(job["submission_attempt"]) == int(job["node_attempt"])


def _audit_write_allowed(connection, job) -> bool:
    if job["version_status"] != "preview":
        return True
    row = connection.execute(
        """
        SELECT 1 FROM flow_preview_sessions
        WHERE flow_instance_id = ? AND status = 'active' AND expires_at > ?
        """,
        (job["flow_instance_id"], utc_now_iso()),
    ).fetchone()
    return row is not None


def _script_config(node: Any) -> tuple[str, int, str] | None:
    if not isinstance(node, dict):
        return None
    script_id = node.get("auditScriptId")
    version = node.get("auditScriptVersion")
    sha256 = node.get("auditScriptHash")
    if (
        isinstance(script_id, str)
        and script_id
        and isinstance(version, int)
        and not isinstance(version, bool)
        and version > 0
        and isinstance(sha256, str)
        and sha256
    ):
        return script_id, version, sha256
    return None
