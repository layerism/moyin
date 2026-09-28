"""Persistent background packaging, independent of browser requests."""
import asyncio
import logging
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.core.config import settings
from app.core.database import get_connection
from app.repositories.teacher_node_exports import get_version_submission_export
from app.services.material_archive import build_version_submission_archive, cleanup_material_archive
from app.services.security import utc_now_iso

logger = logging.getLogger(__name__)


def export_job_directory(job_id: str) -> Path:
    return Path(settings.storage_root) / "export-jobs" / job_id


def cleanup_expired_exports():
    with get_connection() as db:
        rows = db.execute("""SELECT id FROM material_export_jobs
            WHERE status = 'completed' AND expires_at <= ?""", (utc_now_iso(),)).fetchall()
        for row in rows:
            shutil.rmtree(export_job_directory(row["id"]), ignore_errors=True)
            db.execute("UPDATE material_export_jobs SET status = 'expired', seen_at = ? WHERE id = ?",
                       (utc_now_iso(), row["id"]))
    root = Path(settings.storage_root) / "export-jobs"
    if root.exists():
        with get_connection() as db:
            known = {row[0] for row in db.execute("SELECT id FROM material_export_jobs")}
        for directory in root.iterdir():
            if directory.is_dir() and directory.name not in known:
                shutil.rmtree(directory, ignore_errors=True)


def package_next_export():
    with get_connection() as db:
        db.execute("BEGIN IMMEDIATE")
        job = db.execute("SELECT * FROM material_export_jobs WHERE status = 'pending' ORDER BY created_at LIMIT 1").fetchone()
        if job is None:
            return
        db.execute("UPDATE material_export_jobs SET status = 'running', error = NULL WHERE id = ?", (job["id"],))
    directory = export_job_directory(job["id"])
    shutil.rmtree(directory, ignore_errors=True)
    archive = None
    try:
        selection = get_version_submission_export(job["version_id"], job["teacher_id"])
        archive = build_version_submission_archive(selection, directory=directory)
        expires = (datetime.now(UTC) + timedelta(days=7)).isoformat()
        with get_connection() as db:
            updated = db.execute("""UPDATE material_export_jobs SET status = 'completed', filename = ?,
                finished_at = ?, expires_at = ?, seen_at = NULL WHERE id = ? AND status = 'running'""",
                (archive.filename, utc_now_iso(), expires, job["id"])).rowcount
        if not updated:
            cleanup_material_archive(archive)
    except Exception:
        logger.exception("Export job %s failed", job["id"])
        shutil.rmtree(directory, ignore_errors=True)
        with get_connection() as db:
            db.execute("""UPDATE material_export_jobs SET status = 'failed',
                error = '打包失败，请重试；如持续失败，请联系管理员检查材料与存储服务。',
                finished_at = ?, seen_at = NULL WHERE id = ?""", (utc_now_iso(), job["id"]))


async def run_export_worker(stop: asyncio.Event):
    with get_connection() as db:
        db.execute("UPDATE material_export_jobs SET status = 'pending' WHERE status = 'running'")
    while not stop.is_set():
        try:
            await asyncio.to_thread(cleanup_expired_exports)
            await asyncio.to_thread(package_next_export)
        except Exception:
            logger.exception("Export queue processing failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=3)
        except TimeoutError:
            pass
