"""Ordered file review state; all transitions use the caller's transaction."""
import hashlib
import json
import uuid

from app.domain.node_assets import asset_entries

from app.domain.workflow_runtime import node_by_key
from app.domain.file_review_steps import step_kind, structured_steps
from app.services.security import utc_now_iso


def has_manual_review(node):
    return node.get('kind') in {'file', 'confirmation'} and any(step_kind(step) == 'manual' for step in node.get('fileReviewSteps', []))


def review_stage(connection, submission_id):
    run = connection.execute('SELECT * FROM file_review_runs WHERE submission_id = ?', (submission_id,)).fetchone()
    if run is None or run['status'] != 'active':
        return None
    steps = json.loads(run['steps_json'])
    kind = step_kind(steps[run['step_index']]) if run['step_index'] < len(steps) else None
    return 'ai' if kind == 'score' else kind


def finish_step(connection, submission_id, kind, passed, now):
    """Return False for legacy submissions; never complete a later step early."""
    run = connection.execute('SELECT * FROM file_review_runs WHERE submission_id = ?', (submission_id,)).fetchone()
    if run is None:
        return False
    if review_stage(connection, submission_id) != kind:
        return True
    row = connection.execute('''SELECT n.*, i.flow_version_id FROM submissions s
        JOIN node_instances n ON n.id = s.node_instance_id
        JOIN flow_instances i ON i.id = n.flow_instance_id
        WHERE s.id = ? AND s.attempt_no = n.attempt_no''', (submission_id,)).fetchone()
    if row is None or row['status'] not in {'reviewing', 'audit_error'}:
        return True
    next_index = run['step_index'] + (1 if passed else 0)
    completed = passed and next_index == len(json.loads(run['steps_json']))
    status = 'approved' if completed else 'reviewing' if passed else 'rejected'
    connection.execute('UPDATE file_review_runs SET step_index = ?, status = ? WHERE submission_id = ?',
                       (next_index, 'completed' if completed else 'active' if passed else 'rejected', submission_id))
    connection.execute('UPDATE submissions SET status = ? WHERE id = ?', (status, submission_id))
    connection.execute('UPDATE node_instances SET status = ?, approved_at = ? WHERE id = ?',
                       (status, now if completed else None, row['id']))
    if not passed:
        connection.execute("UPDATE file_review_ai_tasks SET status = 'cancelled', finished_at = ? WHERE submission_id = ? AND status = 'pending'", (now, submission_id))
        connection.execute('''UPDATE audit_jobs SET status = 'cancelled', cancellation_reason = 'manual_rejected', finished_at = ?, updated_at = ? WHERE submission_id = ? AND status = 'pending' ''', (now, now, submission_id))
    if completed:
        from app.repositories.flow_runtime_state import advance_downstream, complete_flow_if_ready, version_config
        config = version_config(connection, row['flow_version_id'])
        advance_downstream(connection, row['flow_instance_id'], row['flow_version_id'], config)
        complete_flow_if_ready(connection, row['flow_instance_id'], now)
    return True


def can_amend_review(connection, submission_id, status):
    run = connection.execute('SELECT * FROM file_review_runs WHERE submission_id = ?', (submission_id,)).fetchone()
    if not run or status not in {'approved', 'rejected'}:
        return False
    steps = json.loads(run['steps_json'])
    return bool(steps and step_kind(steps[-1]) == 'manual' and
                (run['status'] == 'completed' or (run['status'] == 'rejected' and run['step_index'] == len(steps) - 1)))


def file_review_evidence(connection, instance_id, config, node_key):
    node = node_by_key(config, node_key)
    row = connection.execute('''SELECT s.* FROM node_instances n LEFT JOIN submissions s
        ON s.node_instance_id = n.id AND s.attempt_no = n.attempt_no
        WHERE n.flow_instance_id = ? AND n.node_key = ?''', (instance_id, node_key)).fetchone()
    submission_id = row['id'] if row else None
    files = connection.execute('''SELECT id, original_name, content_type, size_bytes, storage_key
        FROM uploaded_files WHERE submission_id = ? ORDER BY created_at, id''', (submission_id,)).fetchall()
    # Neither AI results nor mutable node status belong in the teacher's evidence.
    source = {'nodeKey': node_key, 'title': node['title'], 'kind': node['kind'],
              'requirement': node.get('requirement', ''), 'infoFields': [], 'answerSheet': None,
              'status': 'submitted' if submission_id else 'locked', 'submissionId': submission_id,
              'submittedAt': row['submitted_at'] if submission_id else None,
              'submission': json.loads(row['payload_snapshot']) if submission_id else {},
              'files': [dict(file) for file in files]}
    run = connection.execute('SELECT step_index, steps_json, status FROM file_review_runs WHERE submission_id = ?', (submission_id,)).fetchone()
    evidence = {'nodeKey': node_key, 'sources': [source]}
    if structured_steps(node) and run:
        evidence['reviewStepIndex'] = min(run['step_index'], len(json.loads(run['steps_json'])) - 1)
    encoded = json.dumps(evidence, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return evidence, hashlib.sha256(encoded.encode()).hexdigest()


def file_review_detail(connection, row, config, node, status):
    from app.repositories.manual_feedback import draft_feedback, published_feedback
    evidence, fingerprint = file_review_evidence(connection, row['flow_instance_id'], config, row['node_key'])
    submission_id = evidence['sources'][0]['submissionId']
    history = connection.execute('''SELECT m.*, a.name AS teacher_name FROM manual_reviews m
        LEFT JOIN teacher_accounts a ON a.id = m.teacher_id WHERE m.flow_instance_id = ? AND m.node_key = ?
        ORDER BY m.created_at DESC, m.id DESC''', (row['flow_instance_id'], row['node_key'])).fetchall()
    reference_files = []
    for key, metadata in asset_entries(node):
        label = '填写模板' if key == 'templateAsset' else '参考示例' if node['kind'] == 'confirmation' else '填写参考'
        asset_id = metadata.get('assetId')
        if not asset_id:
            continue
        asset = connection.execute('''SELECT a.id, a.original_name, a.storage_key FROM flow_template_assets a
            JOIN flow_versions v ON v.flow_id = a.flow_id
            WHERE v.id = ? AND a.id = ? AND a.node_key = ?''',
            (row['flow_version_id'], asset_id, row['node_key'])).fetchone()
        if asset:
            reference_files.append({**dict(asset), 'label': label})
    prior_ai = []
    if submission_id:
        for task in connection.execute('''SELECT step_index, snapshot_json, result_json FROM file_review_ai_tasks
            WHERE submission_id = ? AND status = 'succeeded' ORDER BY step_index''', (submission_id,)):
            result = json.loads(task['result_json'])
            snapshot = json.loads(task['snapshot_json'])
            prior_ai.append({'step': task['step_index'] + 1, 'scriptName': snapshot.get('scriptName', 'AI 审核'),
                             'passed': result['passed'], 'reason': result.get('reason', '')})
    return {'referenceFiles': reference_files, 'nodeInstanceId': row['id'], 'title': node['title'], 'requirement': node.get('requirement', ''),
            'student': {'name': row['name'], 'studentNo': row['student_no']}, 'status': status,
            'canAmend': can_amend_review(connection, submission_id, status),
            'canReview': status == 'reviewing' and review_stage(connection, submission_id) == 'manual',
            'evidenceHash': fingerprint, 'sources': evidence['sources'], 'sourceReviews': [], 'priorAiResults': prior_ai,
            'feedbackDraft': draft_feedback(connection, row['id'], fingerprint),
            'feedback': published_feedback(connection, row['flow_instance_id'], row['node_key'], fingerprint),
            'history': [{'id': item['id'], 'remark': item['remark'], 'reviewedAt': item['created_at'],
                         'teacherName': item['teacher_name'] or '原审核教师',
                         'passed': json.loads(item['evidence_snapshot']).get('passed')}
                        for item in history]}


def decide_file_review(connection, row, config, node, status, teacher_id, evidence_hash, remark, revision, passed):
    from app.repositories.manual_reviews import ManualReviewConflict
    from app.repositories.manual_feedback import publish_feedback
    if not remark.strip() or len(remark) > 1000:
        raise ValueError('请填写 1–1000 字的审核评语')
    evidence, fingerprint = file_review_evidence(connection, row['flow_instance_id'], config, row['node_key'])
    submission_id = evidence['sources'][0]['submissionId']
    amending = can_amend_review(connection, submission_id, status)
    if fingerprint != evidence_hash or (not amending and (status != 'reviewing' or review_stage(connection, submission_id) != 'manual')):
        raise ManualReviewConflict('本次材料或审核状态已变化，请刷新后重试')
    publish_feedback(connection, row['id'], teacher_id, fingerprint, revision, remark)
    now = utc_now_iso()
    connection.execute('UPDATE manual_feedback_drafts SET revision = revision + 1 WHERE node_instance_id = ?', (row['id'],))
    connection.execute('''INSERT INTO manual_reviews
        (id, flow_instance_id, node_instance_id, node_key, evidence_hash, evidence_snapshot, teacher_id, remark, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
        (str(uuid.uuid4()), row['flow_instance_id'], row['id'], row['node_key'], fingerprint,
         json.dumps({**evidence, 'passed': passed}, ensure_ascii=False), teacher_id, remark.strip(), now))
    if amending:
        if status == 'approved' and not passed:
            from app.domain.workflow_revision import reachable_successors
            from app.repositories.manual_review_state import invalidate_nodes
            affected = reachable_successors(config, {row['node_key']})
            invalidate_nodes(connection, row['flow_instance_id'], config, affected, now)
            for key in affected:
                connection.execute('''UPDATE file_review_ai_tasks SET status = 'cancelled', finished_at = ?
                    WHERE status IN ('pending', 'running') AND submission_id IN
                    (SELECT s.id FROM submissions s JOIN node_instances n ON n.id = s.node_instance_id
                     WHERE n.flow_instance_id = ? AND n.node_key = ?)''', (now, row['flow_instance_id'], key))
        run = connection.execute('SELECT steps_json FROM file_review_runs WHERE submission_id = ?', (submission_id,)).fetchone()
        connection.execute("UPDATE file_review_runs SET status = 'active', step_index = ? WHERE submission_id = ?", (len(json.loads(run['steps_json'])) - 1, submission_id))
        connection.execute("UPDATE node_instances SET status = 'reviewing', approved_at = NULL WHERE id = ?", (row['id'],))
    finish_step(connection, submission_id, 'manual', passed, now)
    return connection.execute('SELECT status FROM node_instances WHERE id = ?', (row['id'],)).fetchone()['status'] == 'approved'


def discard_previous_rounds(connection, node_instance_id, submission_id):
    """Called only inside the successful submission transaction, after validation."""
    for table in ('manual_reviews', 'manual_feedback', 'manual_feedback_drafts', 'manual_feedback_files'):
        connection.execute(f'DELETE FROM {table} WHERE node_instance_id = ?', (node_instance_id,))
    connection.execute('DELETE FROM manual_node_rejections WHERE node_instance_id = ?', (node_instance_id,))
    # Cascades remove prior AI jobs, per-step tasks, runs, and feedback contexts.
    # File objects are separate resources and may still be referenced by other nodes.
    connection.execute('DELETE FROM submissions WHERE node_instance_id = ? AND id != ?',
                       (node_instance_id, submission_id))
