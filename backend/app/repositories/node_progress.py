"""Teacher-scoped node progress and atomic student redo operations."""
import hashlib
import json
from datetime import UTC, datetime

from app.core.database import get_connection
from app.domain.workflow_revision import reachable_successors
from app.domain.workflow_runtime import node_by_key, parse_datetime, pending_node_status
from app.repositories.branch_state import node_is_ready
from app.repositories.flow_instances import _set_student_deadline, get_version_progress
from app.repositories.flow_runtime_state import effective_deadline
from app.repositories.manual_review_state import invalidate_nodes
from app.services.security import utc_now_iso


class ProgressConflict(ValueError):
    pass


def _context(connection, instance_id, node_key, teacher_id):
    row = connection.execute('''SELECT i.*, v.config_snapshot FROM flow_instances i
        JOIN flow_versions v ON v.id = i.flow_version_id JOIN flows f ON f.id = v.flow_id
        WHERE i.id = ? AND f.owner_id = ? AND v.status = 'published' ''',
        (instance_id, str(teacher_id))).fetchone()
    if row is None:
        raise KeyError(instance_id)
    config = json.loads(row['config_snapshot'])
    node_by_key(config, node_key)
    return row, config


def _impact(connection, instance, config, node_key):
    affected = reachable_successors(config, {node_key})
    rows = {r['node_key']: dict(r) for r in connection.execute(
        'SELECT * FROM node_instances WHERE flow_instance_id = ?', (instance['id'],))}
    now = datetime.now(UTC)
    nodes = []
    for node in config['nodes']:
        key = node['id']
        if key not in affected:
            continue
        deadline = effective_deadline(connection, instance['id'], instance['flow_version_id'], key)
        expired = bool(deadline and parse_datetime(deadline) <= now)
        answer_exposed = (node.get('kind') == 'answer_sheet' and expired
                          and node.get('answerSheet', {}).get('gradingPolicy', {}).get('feedback') == 'full_after_deadline')
        nodes.append({'nodeKey': key, 'title': node['title'], 'status': rows[key]['status'],
                      'deadline': deadline, 'expired': expired,
                      'canExtend': bool(deadline) and node.get('kind') not in {'branch', 'or_gate'} and not answer_exposed})
    # Include all node states: an upstream change can alter readiness during confirmation.
    fingerprint = hashlib.sha256(json.dumps(
        [instance['flow_version_id'], config, rows, nodes], sort_keys=True, ensure_ascii=False,
    ).encode()).hexdigest()
    return {'fingerprint': fingerprint, 'nodes': nodes}


def get_impact(instance_id, node_key, teacher_id):
    with get_connection() as connection:
        connection.execute('BEGIN')
        instance, config = _context(connection, instance_id, node_key, teacher_id)
        return _impact(connection, instance, config, node_key)


def get_node_progress(version_id, node_key, teacher_id):
    progress = get_version_progress(version_id, teacher_id)
    with get_connection() as connection:
        config = json.loads(connection.execute('SELECT config_snapshot FROM flow_versions WHERE id = ?', (version_id,)).fetchone()[0])
        node = node_by_key(config, node_key)
        students = []
        for student in progress['students']:
            item = next((n for n in student['nodes'] if n['nodeKey'] == node_key), None)
            if item is None:
                continue
            deadline = item['effectiveDeadline']
            if item['status'] in {'available', 'draft', 'rejected', 'locked', 'scheduled', 'expired'}:
                computed = pending_node_status(node_is_ready(connection, student['instanceId'], config, node_key),
                    node.get('startAt'), deadline, kind=node.get('kind'))
                item = {**item, 'status': item['status'] if computed == 'available' and item['status'] in {'draft', 'rejected'} else computed}
            exposed = (node.get('kind') == 'answer_sheet' and deadline
                       and parse_datetime(deadline) <= datetime.now(UTC)
                       and node.get('answerSheet', {}).get('gradingPolicy', {}).get('feedback') == 'full_after_deadline')
            students.append({**student, 'nodes': [], **item,
                'canRevoke': item['status'] == 'approved' and node.get('kind') != 'or_gate',
                'canExtend': bool(deadline) and node.get('kind') not in {'branch', 'or_gate'}
                    and (item['status'] != 'approved' or node.get('kind') == 'form') and not exposed})
        logs = connection.execute('''SELECT l.action, l.after_data, l.reason, l.created_at, l.actor_id, a.name, a.student_no FROM audit_logs l
            JOIN flow_instances i ON l.entity_id = i.id || ':' || ?
            JOIN student_accounts a ON a.id = i.student_account_id
            WHERE action IN ('node_progress_reset', 'deadline_override') AND entity_type = 'node_instance'
              AND i.flow_version_id = ?
            ORDER BY l.id DESC LIMIT 100''', (node_key, version_id)).fetchall()
    return {'title': node['title'], 'students': students, 'logs': [dict(r) for r in logs]}


def reset_progress(instance_id, node_key, teacher_id, fingerprint, reason, deadline_at=None, extend_current=False, extend_downstream=False):
    if not reason.strip():
        raise ValueError('请填写撤销原因')
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute('BEGIN IMMEDIATE')
        instance, config = _context(connection, instance_id, node_key, teacher_id)
        impact = _impact(connection, instance, config, node_key)
        if impact['fingerprint'] != fingerprint:
            raise ProgressConflict('学生进度或截止时间已变化，请关闭确认框后重新操作')
        target = connection.execute('SELECT * FROM node_instances WHERE flow_instance_id = ? AND node_key = ?',
                                    (instance_id, node_key)).fetchone()
        if target['status'] != 'approved' or node_by_key(config, node_key).get('kind') == 'or_gate':
            raise ProgressConflict('仅可撤销已通过的非或节点')
        affected = {n['nodeKey'] for n in impact['nodes']}
        extension_keys = [n['nodeKey'] for n in impact['nodes'] if n['expired'] and n['canExtend']
                          and ((n['nodeKey'] == node_key and extend_current) or (n['nodeKey'] != node_key and extend_downstream))]
        if (extend_current or extend_downstream) and (not deadline_at or not extension_keys):
            raise ValueError('请选择可延期的已截止节点及新的截止时间')
        running_jobs = []
        for key in affected:
            running_jobs.extend(r['id'] for r in connection.execute('''SELECT j.id FROM audit_jobs j
                JOIN node_instances n ON n.id = j.node_instance_id
                WHERE n.flow_instance_id = ? AND n.node_key = ? AND j.status = 'running' ''', (instance_id, key)))
        invalidate_nodes(connection, instance_id, config, affected, now)
        for key in affected:
            connection.execute('''UPDATE file_review_ai_tasks SET status = 'cancelled', finished_at = ?
                WHERE status IN ('pending','running') AND submission_id IN
                (SELECT s.id FROM submissions s JOIN node_instances n ON n.id = s.node_instance_id
                 WHERE n.flow_instance_id = ? AND n.node_key = ?)''', (now, instance_id, key))
            if key != node_key:
                connection.execute('INSERT OR IGNORE INTO node_redo_dependencies VALUES (?, ?, ?)', (instance_id, node_key, key))
        for key in extension_keys:
            _set_student_deadline(connection, instance_id, key, deadline_at, reason.strip(), teacher_id, now)
        node = node_by_key(config, node_key)
        status = pending_node_status(node_is_ready(connection, instance_id, config, node_key), node.get('startAt'),
                                     effective_deadline(connection, instance_id, instance['flow_version_id'], node_key), kind=node.get('kind'))
        if status == 'available' and connection.execute('SELECT 1 FROM node_drafts WHERE node_instance_id = ?', (target['id'],)).fetchone():
            status = 'draft'
        connection.execute('UPDATE node_instances SET status = ?, opened_at = ? WHERE id = ?',
                           (status, now if status in {'available','draft'} else None, target['id']))
        connection.execute('''INSERT INTO audit_logs
            (actor_id, action, entity_type, entity_id, before_data, after_data, reason, created_at)
            VALUES (?, 'node_progress_reset', 'node_instance', ?, ?, ?, ?, ?)''',
            (str(teacher_id), f'{instance_id}:{node_key}', json.dumps(impact, ensure_ascii=False),
             json.dumps({'instanceId': instance_id, 'affectedNodes': impact['nodes'], 'extendedNodes': extension_keys,
                         'deadlineAt': deadline_at if extension_keys else None,
                         'resetAttempts': {r['node_key']: r['attempt_no'] for r in connection.execute(
                             'SELECT node_key, attempt_no FROM node_instances WHERE flow_instance_id = ?', (instance_id,)) if r['node_key'] in affected}}, ensure_ascii=False), reason.strip(), now))
    return running_jobs
