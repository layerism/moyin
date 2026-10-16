"""Explicit account ownership graph and transactional online-data removal."""
import hashlib
import json
import uuid

from fastapi import HTTPException

from app.core.database import get_connection
from app.services.security import utc_now_iso

# Order is child-first, including the RESTRICT references between assets/versions.
ORDER = ['audit_manual_feedback_context', 'audit_manual_node_rejections',
         'audit_manual_feedback_drafts', 'audit_manual_feedback', 'audit_manual_feedback_files', 'audit_manual_reviews',
         'audit_jobs', 'audit_runs',
         'student_uploaded_files', 'node_template_download_events', 'node_submissions', 'node_drafts',
         'node_deadline_overrides', 'flow_preview_sessions', 'node_instances', 'flow_instances',
         'flow_versions',
         'flow_assets', 'flow_roster_entries', 'flows',
         'flow_groups',
         'teacher_drive_files', 'audit_model_cards', 'teacher_invitations',
         'sms_challenges', 'password_recoveries', 'audit_logs', 'student_sessions',
         'teacher_sessions', 'student_accounts', 'teacher_accounts']


def scope(db, kind, account_id):
    account = db.execute(f'SELECT * FROM {kind}_accounts WHERE id = ?', (account_id,)).fetchone()
    if account is None:
        raise HTTPException(404, detail='用户不存在')
    if (kind == 'teacher' and account['role'] == 'super_admin') or (kind == 'student' and account['account_kind'] != 'normal'):
        raise HTTPException(409, detail='系统账号受到保护')
    data = {}

    def select(table, condition, args=()):
        rows = db.execute(f'SELECT rowid AS _rowid, * FROM {table} WHERE {condition}', args).fetchall()
        data.setdefault(table, {}).update({r['_rowid']: dict(r) for r in rows})

    def children(table, column, parent, parent_key='id'):
        values = [r[parent_key] for r in data.get(parent, {}).values()]
        for offset in range(0, len(values), 400):
            batch = values[offset:offset + 400]
            select(table, f'{column} IN ({",".join("?" for _ in batch)})', batch)

    select(f'{kind}_accounts', 'id = ?', (account_id,))
    if kind == 'teacher':
        select('teacher_drive_files', 'owner_teacher_id = ?', (account_id,))
        select('flows', 'owner_id = ?', (str(account_id),))
        select('flow_groups', 'owner_teacher_id = ?', (account_id,))
        select('student_accounts', 'preview_owner_teacher_id = ?', (account_id,))
        select('audit_model_cards', 'owner_teacher_id = ?', (account_id,))
        select('teacher_invitations', 'created_by = ? OR used_by_teacher_id = ? OR employee_no = ?', (account_id, account_id, account['employee_no']))
    else:
        select('flow_roster_entries', 'student_no = ?', (account['student_no'],))
    children('flow_versions', 'flow_id', 'flows')
    children('flow_instances', 'flow_version_id', 'flow_versions')
    children('flow_instances', 'student_account_id', 'student_accounts')
    children('flow_preview_sessions', 'flow_instance_id', 'flow_instances')
    children('node_instances', 'flow_instance_id', 'flow_instances')
    children('node_submissions', 'node_instance_id', 'node_instances')
    for table in ['audit_manual_reviews', 'audit_manual_feedback_files', 'audit_manual_feedback', 'node_deadline_overrides']:
        children(table, 'flow_instance_id', 'flow_instances')
    for table in ['audit_manual_feedback_drafts', 'audit_manual_node_rejections', 'node_drafts', 'student_uploaded_files', 'node_template_download_events', 'audit_jobs']:
        children(table, 'node_instance_id', 'node_instances')
    for table in ['audit_runs', 'audit_manual_feedback_context']:
        children(table, 'submission_id', 'node_submissions')
    for table in ['flow_assets', 'flow_roster_entries']:
        children(table, 'flow_id', 'flows')
    for role in ['student', 'teacher']:
        children(f'{role}_sessions', f'{role}_account_id', f'{role}_accounts')
        for row in data.get(f'{role}_accounts', {}).values():
            for table in ['sms_challenges', 'password_recoveries']:
                select(table, 'role = ? AND (account_id = ? OR phone = ?)', (role, row['id'], row.get('phone')))
    # Audit row identifiers are scoped by entity type; UUID-based flow records are globally unique.
    for table, rows in list(data.items()):
        primary_keys = [r['name'] for r in db.execute(f'PRAGMA table_info({table})') if r['pk']]
        for row in rows.values():
            key = json.dumps({column: row[column] for column in primary_keys}, ensure_ascii=False, sort_keys=True)
            select('audit_logs', 'entity_type = ? AND entity_id = ?', ('database:' + table, key))
            legacy_tables = {
                'audit_runs': ('file_review_runs',),
                'audit_jobs': ('file_review_ai_tasks',),
                'audit_manual_feedback_context': ('file_review_feedback_context', 'audit_feedback_context'),
                'audit_manual_reviews': ('manual_reviews',),
                'audit_manual_feedback': ('manual_feedback',),
                'audit_manual_feedback_drafts': ('manual_feedback_drafts',),
                'audit_manual_feedback_files': ('manual_feedback_files',),
                'audit_manual_node_rejections': ('manual_node_rejections',),
            }.get(table, ())
            for legacy_table in legacy_tables:
                select('audit_logs', 'entity_type = ? AND entity_id = ?', ('database:' + legacy_table, key))
            if table == 'node_submissions':
                select('audit_logs', 'entity_type = ? AND entity_id = ?', ('database:submissions', key))
            if table == 'student_uploaded_files':
                select('audit_logs', 'entity_type = ? AND entity_id = ?', ('database:uploaded_files', key))
            if table == 'teacher_drive_files':
                select('audit_logs', 'entity_type = ? AND entity_id = ?', ('database:personal_drive_files', key))
            if table == 'node_template_download_events':
                select('audit_logs', 'entity_type = ? AND entity_id = ?', ('database:template_download_events', key))
            if table == 'node_deadline_overrides':
                select('audit_logs', 'entity_type = ? AND entity_id = ?', ('database:student_deadline_overrides', key))
            if table == 'flow_groups':
                select('audit_logs', 'entity_type = ? AND entity_id = ?', ('database:workflow_groups', key))
            if table == 'flow_roster_entries':
                select('audit_logs', "entity_type = 'flow_roster' AND entity_id = ?", (f"{row['flow_id']}:{row['id']}",))
            if table in ('student_accounts', 'teacher_accounts'):
                select('audit_logs', 'entity_type = ? AND entity_id = ?', (table.removesuffix('s'), str(row['id'])))
            value = row.get('id')
            if value is not None:
                if isinstance(value, str) and len(value) >= 32:
                    select('audit_logs', 'entity_id = ? OR substr(entity_id, 1, ?) = ?', (value, len(value) + 1, value + ':'))
                else:
                    select('audit_logs', 'entity_type = ? AND entity_id = ?', (table, str(value)))
    if kind == 'teacher':
        select('audit_logs', 'actor_id = ?', (str(account_id),))
    # Historic rows may no longer exist, so also match identities inside snapshots.
    number_keys = ('student_no', 'studentNo') if kind == 'student' else ('employee_no', 'employeeNo')
    number = account[number_keys[0]]

    def contains_identity(value):
        if isinstance(value, dict):
            if any(value.get(k) == number for k in number_keys):
                return True
            return any(contains_identity(v) for v in value.values())
        return isinstance(value, list) and any(contains_identity(v) for v in value)

    for log in db.execute('SELECT rowid AS _rowid, * FROM audit_logs'):
        for column in ('before_data', 'after_data'):
            try:
                snapshot = json.loads(log[column] or 'null')
            except (ValueError, TypeError):
                continue
            if contains_identity(snapshot):
                data.setdefault('audit_logs', {})[log['_rowid']] = dict(log)
                break
    return dict(account), data


def summarize(account, data, kind):
    digest = hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    keys = sorted({r['storage_key'] for rows in data.values() for r in rows.values() if r.get('storage_key')})
    return {'account': account['student_no' if kind == 'student' else 'employee_no'], 'name': account['name'],
            'digest': digest, 'counts': {k: len(v) for k, v in data.items() if v}, 'files': len(keys),
            'affectedStudents': len({r['student_account_id'] for r in data.get('flow_instances', {}).values()}), 'keys': keys}


def preview(kind, account_id):
    with get_connection() as db:
        db.execute('BEGIN')
        account, data = scope(db, kind, account_id)
        result = summarize(account, data, kind)
        result.pop('keys')
        return result


def start(kind, account_id, confirmation, digest, remove_allowlist):
    with get_connection() as db:
        db.execute('BEGIN IMMEDIATE')
        account, data = scope(db, kind, account_id)
        summary = summarize(account, data, kind)
        if confirmation != summary['account'] or digest != summary['digest']:
            raise HTTPException(409, detail='确认账号不匹配或关联数据已变化，请重新预览')
        # Unknown or shared RESTRICT references abort the entire transaction.
        # No account or resource disappears on such a failure.
        if kind == 'teacher':
            db.execute('UPDATE audit_script_runtime_states SET updated_by = NULL WHERE updated_by = ?', (account_id,))
        for table in ORDER:
            rows = data.get(table, {})
            if rows:
                db.executemany(f'DELETE FROM {table} WHERE rowid = ?', [(i,) for i in rows])
        if remove_allowlist and kind == 'student':
            db.execute('DELETE FROM registration_allowlist WHERE student_no = ?', (summary['account'],))
        job_id = str(uuid.uuid4())
        db.execute('INSERT INTO user_deletion_jobs (id, status, keys_json, created_at) VALUES (?, ?, ?, ?)',
                   (job_id, 'pending', json.dumps(summary['keys']), utc_now_iso()))
        return {'id': job_id, 'status': 'pending'}
