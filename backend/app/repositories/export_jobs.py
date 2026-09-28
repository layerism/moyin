"""Teacher-owned persistent export queue."""
import uuid

from app.core.database import get_connection
from app.services.security import utc_now_iso


def job_payload(row):
    return {
        "id": row["id"], "versionId": row["version_id"], "flowName": row["flow_name"],
        "status": row["status"], "error": row["error"], "filename": row["filename"],
        "createdAt": row["created_at"], "finishedAt": row["finished_at"],
        "expiresAt": row["expires_at"], "seen": row["seen_at"] is not None,
    }


def create_export_job(version_id: str, teacher_id: int):
    with get_connection() as db:
        db.execute("BEGIN IMMEDIATE")
        version = db.execute("""SELECT f.name FROM flow_versions v JOIN flows f ON f.id = v.flow_id
            WHERE v.id = ? AND v.status = 'published' AND f.owner_id = ?""",
            (version_id, str(teacher_id))).fetchone()
        if version is None:
            raise KeyError(version_id)
        row = db.execute("""SELECT * FROM material_export_jobs WHERE teacher_id = ? AND version_id = ?
            AND status IN ('pending', 'running')""", (teacher_id, version_id)).fetchone()
        if row is None:
            job_id = str(uuid.uuid4())
            db.execute("""INSERT INTO material_export_jobs
                (id, teacher_id, version_id, flow_name, status, created_at)
                VALUES (?, ?, ?, ?, 'pending', ?)""",
                (job_id, teacher_id, version_id, version["name"], utc_now_iso()))
            row = db.execute("SELECT * FROM material_export_jobs WHERE id = ?", (job_id,)).fetchone()
        return job_payload(row)


def list_export_jobs(teacher_id: int):
    with get_connection() as db:
        return [job_payload(row) for row in db.execute("""SELECT j.* FROM material_export_jobs j
            JOIN flow_versions v ON v.id = j.version_id JOIN flows f ON f.id = v.flow_id
            WHERE j.teacher_id = ? AND f.owner_id = ?
            ORDER BY CASE WHEN j.status IN ('pending', 'running') THEN 0 ELSE 1 END, j.created_at DESC
            LIMIT 100""", (teacher_id, str(teacher_id)))]


def owned_export_job(job_id: str, teacher_id: int):
    with get_connection() as db:
        row = db.execute("""SELECT j.* FROM material_export_jobs j
            JOIN flow_versions v ON v.id = j.version_id JOIN flows f ON f.id = v.flow_id
            WHERE j.id = ? AND j.teacher_id = ? AND f.owner_id = ?""",
            (job_id, teacher_id, str(teacher_id))).fetchone()
        if row is None:
            raise KeyError(job_id)
        return dict(row)


def mark_export_seen(job_id: str, teacher_id: int):
    owned_export_job(job_id, teacher_id)
    with get_connection() as db:
        db.execute("UPDATE material_export_jobs SET seen_at = ? WHERE id = ? AND teacher_id = ?",
                   (utc_now_iso(), job_id, teacher_id))
