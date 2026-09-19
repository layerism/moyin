"""Persistent, retryable OSS cleanup after transactional account deletion."""
import asyncio
import json
import logging

from app.core.database import get_connection
from app.services.object_storage import get_object_storage

logger = logging.getLogger(__name__)


def cleanup_one():
    with get_connection() as db:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute("SELECT * FROM user_deletion_jobs WHERE status = 'pending' ORDER BY created_at LIMIT 1").fetchone()
        if row is None:
            return
        db.execute("UPDATE user_deletion_jobs SET status = 'running', error = NULL WHERE id = ?", (row['id'],))
    try:
        keys = json.loads(row['keys_json'])
        storage = get_object_storage() if keys else None
        while keys:
            key = keys[0]
            with get_connection() as db:
                shared = any(db.execute(f'SELECT 1 FROM {table} WHERE storage_key = ? LIMIT 1', (key,)).fetchone()
                             for table in ['uploaded_files', 'manual_feedback_files', 'flow_template_assets', 'flow_content_assets'])
            if not shared:
                storage.delete_object(key)
            keys.pop(0)
            with get_connection() as db:
                db.execute('UPDATE user_deletion_jobs SET keys_json = ? WHERE id = ?', (json.dumps(keys), row['id']))
        with get_connection() as db:
            db.execute("UPDATE user_deletion_jobs SET status = 'completed', keys_json = '[]', error = NULL WHERE id = ?", (row['id'],))
    except Exception:
        logger.exception('User deletion file cleanup failed')
        with get_connection() as db:
            db.execute("UPDATE user_deletion_jobs SET status = 'failed', error = '文件清理失败，请检查存储服务后重试' WHERE id = ?", (row['id'],))


async def run_cleanup(stop: asyncio.Event):
    with get_connection() as db:
        db.execute("UPDATE user_deletion_jobs SET status = 'pending' WHERE status = 'running'")
    while not stop.is_set():
        await asyncio.to_thread(cleanup_one)
        try:
            await asyncio.wait_for(stop.wait(), timeout=2)
        except TimeoutError:
            pass
