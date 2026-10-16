"""Upgrade review tables to the shared audit task model without changing student state."""
import json
from datetime import UTC, datetime

MIGRATION_ID = '20261016_unified_audit_jobs'

MANUAL_AUDIT_TABLE_RENAMES = {
    'manual_reviews': 'audit_manual_reviews',
    'manual_feedback': 'audit_manual_feedback',
    'manual_feedback_drafts': 'audit_manual_feedback_drafts',
    'manual_feedback_files': 'audit_manual_feedback_files',
    'manual_node_rejections': 'audit_manual_node_rejections',
    'manual_source_reviews': 'audit_manual_source_reviews',
    'audit_feedback_context': 'audit_manual_feedback_context',
}

AUDIT_JOBS_SCHEMA = """
CREATE TABLE IF NOT EXISTS audit_jobs (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL REFERENCES node_submissions(id) ON DELETE CASCADE,
    node_instance_id TEXT NOT NULL REFERENCES node_instances(id) ON DELETE CASCADE,
    flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    node_key TEXT NOT NULL,
    step_index INTEGER CHECK (step_index >= 0),
    snapshot_json TEXT NOT NULL DEFAULT '{}',
    max_retries INTEGER NOT NULL DEFAULT 3 CHECK (max_retries >= 0),
    script_id TEXT NOT NULL,
    script_generation INTEGER NOT NULL CHECK (script_generation > 0),
    script_content_hash TEXT NOT NULL,
    policy_generation INTEGER NOT NULL CHECK (policy_generation > 0),
    policy_hash TEXT NOT NULL,
    effective_params_json TEXT NOT NULL,
    effective_settings_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    result_json TEXT,
    error_message TEXT,
    cancellation_reason TEXT,
    claimed_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


def rename_audit_tables(connection):
    for old, new in [('file_review_runs', 'audit_runs'),
                     ('file_review_feedback_context', 'audit_manual_feedback_context')]:
        if connection.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (old,)).fetchone():
            connection.execute(f'ALTER TABLE {old} RENAME TO {new}')


def rename_manual_audit_tables(connection):
    # Run before SCHEMA; ALTER TABLE preserves records and updates foreign keys.
    connection.execute('SAVEPOINT audit_manual_rename')
    try:
        for old, new in MANUAL_AUDIT_TABLE_RENAMES.items():
            if connection.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (old,)).fetchone():
                connection.execute(f'ALTER TABLE {old} RENAME TO {new}')
        # SQLite renames autoindexes, but explicitly named indexes retain old names.
        for old in ('manual_reviews', 'manual_feedback', 'manual_node_rejections'):
            name = f'idx_{old}_node'
            index = connection.execute("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?", (name,)).fetchone()
            if index:
                connection.execute(f'DROP INDEX {name}')
                connection.execute(index[0].replace(name, f'idx_audit_{old}_node', 1))
    except Exception:
        connection.execute('ROLLBACK TO audit_manual_rename')
        raise
    finally:
        connection.execute('RELEASE audit_manual_rename')


def migrate_audit_jobs(connection):
    from app.repositories.audit_policies import canonical_json, policy_hash
    connection.execute('BEGIN IMMEDIATE')
    if connection.execute('SELECT 1 FROM schema_migrations WHERE id = ?', (MIGRATION_ID,)).fetchone():
        return
    rename_audit_tables(connection)
    columns = [r['name'] for r in connection.execute('PRAGMA table_info(audit_jobs)')]
    if 'step_index' not in columns:
        connection.execute(AUDIT_JOBS_SCHEMA.replace('audit_jobs', 'audit_jobs_unified', 1))
        names = ', '.join(columns)
        connection.execute(f'INSERT INTO audit_jobs_unified ({names}) SELECT {names} FROM audit_jobs')
        connection.execute('DROP TABLE audit_jobs')
        connection.execute('ALTER TABLE audit_jobs_unified RENAME TO audit_jobs')
    legacy = connection.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'file_review_ai_tasks'").fetchone()
    if legacy:
        tasks = connection.execute("""SELECT t.*, n.id AS node_instance_id, n.node_key, v.flow_id
            FROM file_review_ai_tasks t
            JOIN node_submissions s ON s.id = t.submission_id
            JOIN node_instances n ON n.id = s.node_instance_id
            JOIN flow_instances i ON i.id = n.flow_instance_id
            JOIN flow_versions v ON v.id = i.flow_version_id""").fetchall()
        if len(tasks) != connection.execute('SELECT COUNT(*) FROM file_review_ai_tasks').fetchone()[0]:
            raise ValueError('审核任务关联不完整，迁移已取消')
        for task in tasks:
            snapshot = json.loads(task['snapshot_json'])
            connection.execute("""INSERT INTO audit_jobs
                (id, submission_id, node_instance_id, flow_id, node_key, step_index, snapshot_json,
                 max_retries, script_id, script_generation, script_content_hash, policy_generation,
                 policy_hash, effective_params_json, effective_settings_json, status, attempt_count,
                 next_attempt_at, result_json, finished_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (task['id'], task['submission_id'], task['node_instance_id'], task['flow_id'], task['node_key'],
                 task['step_index'], task['snapshot_json'], snapshot['auditScriptId'], snapshot['generation'],
                 snapshot['hash'], policy_hash(snapshot['auditScriptId'], snapshot['params'], snapshot.get('auditModelCardId')),
                 canonical_json(snapshot['params']), canonical_json(snapshot['settings']), task['status'],
                 task['attempt_count'], task['created_at'], task['result_json'], task['finished_at'],
                 task['created_at'], task['finished_at'] or task['created_at']))
        # Preserve every original task field, including the exact execution snapshot and result.
        fields = 'id, submission_id, step_index, snapshot_json, status, attempt_count, result_json, created_at, finished_at'
        before = {tuple(r) for r in connection.execute(f'SELECT {fields} FROM file_review_ai_tasks')}
        after = {tuple(r) for r in connection.execute(f'SELECT {fields} FROM audit_jobs WHERE step_index IS NOT NULL')}
        if before != after:
            raise ValueError('审核任务迁移前后不一致，迁移已取消')
        connection.execute('DROP TABLE file_review_ai_tasks')
    for statement in [
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_jobs_submission ON audit_jobs(submission_id) WHERE step_index IS NULL',
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_jobs_step ON audit_jobs(submission_id, step_index) WHERE step_index IS NOT NULL',
        'CREATE INDEX IF NOT EXISTS idx_audit_jobs_claim ON audit_jobs(status, next_attempt_at, created_at)',
        'CREATE INDEX IF NOT EXISTS idx_audit_jobs_node ON audit_jobs(node_instance_id)',
        'CREATE INDEX IF NOT EXISTS idx_audit_jobs_script_status ON audit_jobs(script_id, status)',
        'CREATE INDEX IF NOT EXISTS idx_audit_jobs_policy_status ON audit_jobs(flow_id, node_key, status)',
    ]:
        connection.execute(statement)
    if connection.execute('PRAGMA foreign_key_check').fetchone():
        raise ValueError('审核表迁移后外键不完整，迁移已取消')
    connection.execute('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
                       (MIGRATION_ID, datetime.now(UTC).isoformat()))
