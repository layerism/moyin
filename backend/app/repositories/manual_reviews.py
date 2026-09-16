"""Teacher-owned manual review queues and approvals."""
import json
import uuid

from app.core.database import get_connection
from app.domain.workflow_runtime import node_by_key
from app.domain.workflow_revision import reachable_successors
from app.repositories.flow_roster import assert_student_roster_access
from app.repositories.flow_runtime_state import advance_downstream, complete_flow_if_ready
from app.repositories.manual_review_state import latest_review, review_evidence, sync_manual_reviews, source_reviews, invalidate_nodes
from app.services.security import utc_now_iso
from app.repositories.file_reviews import has_manual_review, review_stage


class ManualReviewConflict(ValueError):
    pass


def _version(connection, version_id, node_key, teacher_id):
    version = connection.execute(
        """SELECT v.* FROM flow_versions v JOIN flows f ON f.id = v.flow_id
           WHERE v.id = ? AND f.owner_id = ? AND (
             v.status = 'published' OR (v.status = 'preview' AND EXISTS (
               SELECT 1 FROM flow_preview_sessions p WHERE p.flow_version_id = v.id
               AND p.teacher_account_id = ? AND p.status = 'active' AND p.expires_at > ?)))""",
        (version_id, str(teacher_id), teacher_id, utc_now_iso()),
    ).fetchone()
    if version is None:
        raise KeyError(version_id)
    config = json.loads(version['config_snapshot'])
    node = node_by_key(config, node_key)
    if node.get('kind') != 'manual_review' and not has_manual_review(node):
        raise ValueError('该节点不是人工审核节点')
    if node.get('kind') == 'file' and str(version['published_by']) != str(teacher_id):
        raise KeyError(version_id)
    return version, config, node


def list_manual_reviews(version_id, node_key, teacher_id):
    with get_connection() as connection:
        connection.execute('BEGIN IMMEDIATE')
        version, config, node = _version(connection, version_id, node_key, teacher_id)
        if version['status'] == 'preview':
            students = connection.execute(
                """SELECT a.id AS roster_id, a.name, a.student_no, i.id AS instance_id
                   FROM flow_preview_sessions p JOIN student_accounts a ON a.id = p.preview_student_account_id
                   JOIN flow_instances i ON i.id = p.flow_instance_id WHERE p.flow_version_id = ?""",
                (version_id,),
            ).fetchall()
        else:
            students = connection.execute(
                """SELECT r.id AS roster_id, r.name, r.student_no, i.id AS instance_id
                   FROM flow_roster_entries r
                   LEFT JOIN student_accounts a ON a.student_no = r.student_no AND a.name = r.name AND a.account_kind = 'normal'
                   LEFT JOIN flow_instances i ON i.student_account_id = a.id AND i.flow_version_id = ?
                   WHERE r.flow_id = ? AND r.status = 'active' ORDER BY r.student_no""",
                (version_id, version['flow_id']),
            ).fetchall()
        result = []
        for student in students:
            instance_id = student['instance_id']
            row = None
            if instance_id:
                sync_manual_reviews(connection, instance_id, config)
                row = connection.execute('SELECT n.id, n.status, s.id AS submission_id FROM node_instances n LEFT JOIN submissions s ON s.node_instance_id = n.id AND s.attempt_no = n.attempt_no WHERE n.flow_instance_id = ? AND n.node_key = ?', (instance_id, node_key)).fetchone()
            stage = review_stage(connection, row['submission_id']) if row else None
            result.append({
                'id': student['roster_id'], 'name': student['name'], 'studentNo': student['student_no'],
                'nodeInstanceId': row['id'] if row else None,
                'status': row['status'] if row else 'locked',
                'canReview': bool(row and row['status'] == 'reviewing' and stage == 'manual'),
            })
        return {'title': node['title'], 'requirement': node.get('requirement', ''), 'students': result}


def _context(connection, node_instance_id, teacher_id):
    row = connection.execute(
        """SELECT n.*, i.flow_version_id, i.student_account_id, a.name, a.student_no
           FROM node_instances n JOIN flow_instances i ON i.id = n.flow_instance_id
           JOIN student_accounts a ON a.id = i.student_account_id WHERE n.id = ?""",
        (node_instance_id,),
    ).fetchone()
    if row is None:
        raise KeyError(node_instance_id)
    version, config, node = _version(connection, row['flow_version_id'], row['node_key'], teacher_id)
    assert_student_roster_access(connection, version['flow_id'], row['student_account_id'])
    sync_manual_reviews(connection, row['flow_instance_id'], config)
    status = connection.execute('SELECT status FROM node_instances WHERE id = ?', (node_instance_id,)).fetchone()['status']
    return row, config, node, status


def get_manual_review(node_instance_id, teacher_id):
    with get_connection() as connection:
        connection.execute('BEGIN IMMEDIATE')
        row, config, node, status = _context(connection, node_instance_id, teacher_id)
        if node.get('kind') == 'file':
            from app.repositories.file_reviews import file_review_detail
            return file_review_detail(connection, row, config, node, status)
        evidence, fingerprint = review_evidence(connection, row['flow_instance_id'], config, row['node_key'])
        history = connection.execute(
            """SELECT m.id, m.remark, m.created_at, a.name AS teacher_name FROM manual_reviews m
               LEFT JOIN teacher_accounts a ON a.id = m.teacher_id
               WHERE m.flow_instance_id = ? AND m.node_key = ? ORDER BY m.created_at DESC, m.id DESC""",
            (row['flow_instance_id'], row['node_key']),
        ).fetchall()
        from app.repositories.manual_feedback import draft_feedback, published_feedback
        return {
            'sourceReviews': source_reviews(connection, node_instance_id, evidence, fingerprint),
            'feedbackDraft': draft_feedback(connection, node_instance_id, fingerprint),
            'feedback': published_feedback(connection, row['flow_instance_id'], row['node_key'], fingerprint),
            'nodeInstanceId': node_instance_id, 'title': node['title'], 'requirement': node.get('requirement', ''),
            'student': {'name': row['name'], 'studentNo': row['student_no']},
            'status': status, 'evidenceHash': fingerprint, 'sources': evidence['sources'],
            'history': [{'id': item['id'], 'remark': item['remark'], 'reviewedAt': item['created_at'],
                         'teacherName': item['teacher_name'] or '原审核教师'} for item in history],
        }


def approve_manual_review(node_instance_id, teacher_id, evidence_hash, remark, feedback_revision, source_node_key, source_remark):
    with get_connection() as connection:
        connection.execute('BEGIN IMMEDIATE')
        row, config, node, status = _context(connection, node_instance_id, teacher_id)
        if node.get('kind') == 'file':
            from app.repositories.file_reviews import decide_file_review
            return decide_file_review(connection, row, config, node, status, teacher_id,
                                      evidence_hash, remark, feedback_revision, True)
        evidence, fingerprint = review_evidence(connection, row['flow_instance_id'], config, row['node_key'])
        if fingerprint != evidence_hash:
            raise ManualReviewConflict('材料已更新，请重新查看后审核')
        source_keys = {source['nodeKey'] for source in evidence['sources']}
        if source_keys and source_node_key not in source_keys:
            raise ValueError('请选择一个前置节点进行审核')
        if not source_keys and source_node_key is not None:
            raise ValueError('该人工审核节点没有前置节点')
        from app.repositories.manual_feedback import publish_feedback
        publish_feedback(connection, node_instance_id, teacher_id, evidence_hash, feedback_revision, remark)
        if status == 'approved':
            previous = latest_review(connection, node_instance_id)
            if previous and previous['evidence_hash'] == fingerprint:
                return True
        if status not in {'reviewing', 'rejected'}:
            raise ManualReviewConflict('前置材料尚未全部通过或尚未到审核开始时间')
        now = utc_now_iso()
        if source_node_key is not None:
            connection.execute('''INSERT INTO manual_source_reviews
                (node_instance_id, evidence_hash, source_node_key, teacher_id, remark, created_at)
                VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(node_instance_id, evidence_hash, source_node_key) DO UPDATE SET
                teacher_id = excluded.teacher_id, remark = excluded.remark, created_at = excluded.created_at''',
                (node_instance_id, fingerprint, source_node_key, teacher_id, source_remark.strip(), now))
            if not all(item['approved'] for item in source_reviews(connection, node_instance_id, evidence, fingerprint)):
                return False
        connection.execute(
            """INSERT INTO manual_reviews
               (id, flow_instance_id, node_instance_id, node_key, evidence_hash, evidence_snapshot, teacher_id, remark, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (str(uuid.uuid4()), row['flow_instance_id'], node_instance_id, row['node_key'], fingerprint,
             json.dumps(evidence, ensure_ascii=False), teacher_id, remark.strip(), now),
        )
        connection.execute("UPDATE node_instances SET status = 'approved', approved_at = ? WHERE id = ?", (now, node_instance_id))
        advance_downstream(connection, row['flow_instance_id'], row['flow_version_id'], config)
        complete_flow_if_ready(connection, row['flow_instance_id'], now)
        return True


def reject_manual_source(node_instance_id, teacher_id, evidence_hash, feedback_revision, source_node_key, source_remark):
    if not source_remark.strip():
        raise ValueError('审核不通过时必须填写该节点的审核意见')
    with get_connection() as connection:
        connection.execute('BEGIN IMMEDIATE')
        from app.repositories.manual_feedback import checked_draft, publish_feedback
        row, config, node, status = _context(connection, node_instance_id, teacher_id)
        if node.get('kind') == 'file':
            from app.repositories.file_reviews import decide_file_review
            return decide_file_review(connection, row, config, node, status, teacher_id,
                                      evidence_hash, source_remark, feedback_revision, False)
        row, evidence, draft = checked_draft(connection, node_instance_id, teacher_id, evidence_hash, feedback_revision)
        if not any(source['nodeKey'] == source_node_key for source in evidence['sources']):
            raise ValueError('只能退回当前审核的前置节点')
        source = connection.execute('SELECT * FROM node_instances WHERE flow_instance_id = ? AND node_key = ?',
                                    (row['flow_instance_id'], source_node_key)).fetchone()
        if source is None or source['status'] != 'approved':
            raise ManualReviewConflict('该节点当前不可退回，请刷新材料后重试')
        # Publish the correction files before changing the evidence and locking descendants.
        publish_feedback(connection, node_instance_id, teacher_id, evidence_hash, feedback_revision, draft['remark'])
        feedback = connection.execute('SELECT id FROM manual_feedback WHERE node_instance_id = ? AND evidence_hash = ? ORDER BY revision DESC LIMIT 1',
                                      (node_instance_id, evidence_hash)).fetchone()
        now = utc_now_iso()
        connection.execute("""INSERT INTO manual_node_rejections
            (id, node_instance_id, reviewer_node_instance_id, feedback_id, attempt_no, teacher_id, remark, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (str(uuid.uuid4()), source['id'], node_instance_id, feedback['id'] if feedback else None,
             source['attempt_no'], teacher_id, source_remark.strip(), now))
        config = json.loads(connection.execute('SELECT config_snapshot FROM flow_versions WHERE id = ?',
                                               (row['flow_version_id'],)).fetchone()['config_snapshot'])
        affected = {source_node_key} | reachable_successors(config, {source_node_key})
        invalidate_nodes(connection, row['flow_instance_id'], config, affected, now)
        connection.execute("UPDATE node_instances SET status = 'rejected' WHERE id = ?", (source['id'],))
