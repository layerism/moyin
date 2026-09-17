"""Durable per-step AI tasks; reuse the script executor and its isolation contract."""
import json
import logging
import uuid

from app.core.database import get_connection
from app.services.security import utc_now_iso

logger = logging.getLogger(__name__)


def enqueue_steps(connection, submission_id, node, now):
    from app.services.audit_script_catalog import find_audit_script
    from app.services.audit_script_parameters import default_script_settings, validate_script_params, validate_script_settings
    for index, step in enumerate(node['fileReviewSteps']):
        if step['kind'] == 'manual':
            continue
        record = find_audit_script(step['auditScriptId'])
        state = connection.execute('SELECT * FROM audit_script_runtime_states WHERE script_id = ?', (record.id,)).fetchone()
        if not state or state['status'] != 'ready' or state['content_hash'] != record.content_hash:
            raise ValueError('审核脚本正在更新，请稍后提交')
        snapshot = {**step, 'scriptName': record.name, 'generation': state['generation'], 'hash': state['content_hash'],
                    'params': validate_script_params(record.config, step.get('auditScriptParams') or {}),
                    'settings': validate_script_settings(record.config, default_script_settings(record.config))}
        connection.execute('''INSERT INTO file_review_ai_tasks
            (id, submission_id, step_index, snapshot_json, status, created_at)
            VALUES (?, ?, ?, ?, 'pending', ?)''',
            (str(uuid.uuid4()), submission_id, index, json.dumps(snapshot, ensure_ascii=False), now))


def recover_tasks():
    with get_connection() as connection:
        connection.execute("UPDATE file_review_ai_tasks SET status = 'pending' WHERE status = 'running'")


def run_next_task():
    from app.services.audit_script_executor import AuditMaterial, execute_audit_script
    from app.services.audit_script_runtime import resolve_audit_script
    with get_connection() as connection:
        connection.execute('BEGIN IMMEDIATE')
        task = connection.execute('''SELECT t.*, n.id AS node_instance_id, n.node_key, n.flow_instance_id,
                v.flow_id, v.id AS flow_version_id, s.attempt_no
            FROM file_review_ai_tasks t
            JOIN file_review_runs r ON r.submission_id = t.submission_id AND r.step_index = t.step_index AND r.status = 'active'
            JOIN submissions s ON s.id = t.submission_id
            JOIN node_instances n ON n.id = s.node_instance_id AND n.attempt_no = s.attempt_no
            JOIN flow_instances i ON i.id = n.flow_instance_id
            JOIN flow_versions v ON v.id = i.flow_version_id
            WHERE t.status = 'pending' AND n.status = 'reviewing'
              AND (v.status != 'preview' OR EXISTS (SELECT 1 FROM flow_preview_sessions p
                WHERE p.flow_instance_id = i.id AND p.status = 'active' AND p.expires_at > ?))
            ORDER BY t.created_at, t.step_index LIMIT 1''', (utc_now_iso(),)).fetchone()
        if task is None:
            return False
        task = dict(task)
        snapshot = json.loads(task['snapshot_json'])
        state = connection.execute('SELECT max_concurrency FROM audit_script_runtime_states WHERE script_id = ?',
                                   (snapshot['auditScriptId'],)).fetchone()
        running = connection.execute("SELECT COUNT(*) FROM file_review_ai_tasks WHERE status = 'running' AND json_extract(snapshot_json, '$.auditScriptId') = ?", (snapshot['auditScriptId'],)).fetchone()[0]
        running += connection.execute("SELECT COUNT(*) FROM audit_jobs WHERE status = 'running' AND script_id = ?", (snapshot['auditScriptId'],)).fetchone()[0]
        if state and running >= state['max_concurrency']:
            return False
        connection.execute("UPDATE file_review_ai_tasks SET status = 'running', attempt_count = attempt_count + 1 WHERE id = ?", (task['id'],))
        files = connection.execute('SELECT * FROM uploaded_files WHERE submission_id = ? ORDER BY display_order, created_at', (task['submission_id'],)).fetchall()
        materials = [AuditMaterial(id=f['id'], name=f['original_name'], storage_key=f['storage_key'], content_type=f['content_type'], size=f['size_bytes'], sha256=f['sha256'], page_count=f['page_count']) for f in files]
    result = None
    try:
        descriptor = resolve_audit_script(snapshot['auditScriptId'], snapshot['generation'], snapshot['hash'])
        result = execute_audit_script(descriptor, materials, {
            'flowId': task['flow_id'], 'flowVersionId': task['flow_version_id'],
            'flowInstanceId': task['flow_instance_id'], 'nodeKey': task['node_key'],
            'nodeInstanceId': task['node_instance_id'], 'submissionId': task['submission_id'],
            'attemptNo': task['attempt_no'], 'scriptParams': snapshot['params'], 'scriptSettings': snapshot['settings'],
            'stepModelCardId': snapshot.get('auditModelCardId'),
        })
    except Exception as exc:
        logger.warning('File review task %s failed: %s', task['id'], type(exc).__name__)
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute('BEGIN IMMEDIATE')
        current = connection.execute('''SELECT t.id FROM file_review_ai_tasks t
            JOIN file_review_runs r ON r.submission_id = t.submission_id AND r.step_index = t.step_index AND r.status = 'active'
            JOIN submissions s ON s.id = t.submission_id
            JOIN node_instances n ON n.id = s.node_instance_id AND n.attempt_no = s.attempt_no
            JOIN flow_instances i ON i.id = n.flow_instance_id JOIN flow_versions v ON v.id = i.flow_version_id
            WHERE t.id = ? AND t.status = 'running' AND n.status = 'reviewing'
            AND (v.status != 'preview' OR EXISTS (SELECT 1 FROM flow_preview_sessions p WHERE p.flow_instance_id = i.id AND p.status = 'active' AND p.expires_at > ?))''', (task['id'], now)).fetchone()
        if not current:
            connection.execute("UPDATE file_review_ai_tasks SET status = 'cancelled', finished_at = ? WHERE id = ?", (now, task['id']))
            return True
        state = connection.execute('SELECT generation, content_hash, status FROM audit_script_runtime_states WHERE script_id = ?',
                                   (snapshot['auditScriptId'],)).fetchone()
        if not state or state['status'] != 'ready' or state['generation'] != snapshot['generation'] or state['content_hash'] != snapshot['hash']:
            connection.execute("UPDATE file_review_ai_tasks SET status = 'cancelled', finished_at = ? WHERE submission_id = ? AND status IN ('pending', 'running')", (now, task['submission_id']))
            connection.execute("UPDATE file_review_runs SET status = 'cancelled' WHERE submission_id = ?", (task['submission_id'],))
            connection.execute("UPDATE submissions SET status = 'cancelled' WHERE id = ?", (task['submission_id'],))
            connection.execute("UPDATE node_instances SET status = 'available' WHERE id = ?", (task['node_instance_id'],))
            return True
        if result is None:
            connection.execute("UPDATE file_review_ai_tasks SET status = 'failed', finished_at = ? WHERE id = ?", (now, task['id']))
            connection.execute("UPDATE node_instances SET status = 'audit_error' WHERE id = ?", (task['node_instance_id'],))
            connection.execute("UPDATE submissions SET status = 'audit_error' WHERE id = ?", (task['submission_id'],))
        else:
            connection.execute("UPDATE file_review_ai_tasks SET status = 'succeeded', result_json = ?, finished_at = ? WHERE id = ?", (json.dumps(result, ensure_ascii=False), now, task['id']))
            from app.repositories.file_reviews import finish_step
            finish_step(connection, task['submission_id'], 'ai', result['passed'], now)
    return True
