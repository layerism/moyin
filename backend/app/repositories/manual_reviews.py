"""Teacher-owned manual review queues and approvals."""
import json
import uuid

from app.core.database import get_connection
from app.domain.workflow_runtime import node_by_key
from app.repositories.flow_roster import assert_student_roster_access
from app.repositories.flow_runtime_state import advance_downstream, complete_flow_if_ready
from app.repositories.manual_review_state import latest_review, review_evidence, sync_manual_reviews
from app.services.security import utc_now_iso


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
    if node.get('kind') != 'manual_review':
        raise ValueError('该节点不是人工审核节点')
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
                row = connection.execute('SELECT id, status FROM node_instances WHERE flow_instance_id = ? AND node_key = ?', (instance_id, node_key)).fetchone()
            result.append({
                'id': student['roster_id'], 'name': student['name'], 'studentNo': student['student_no'],
                'nodeInstanceId': row['id'] if row else None,
                'status': row['status'] if row else 'locked',
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
        evidence, fingerprint = review_evidence(connection, row['flow_instance_id'], config, row['node_key'])
        history = connection.execute(
            """SELECT m.id, m.remark, m.created_at, a.name AS teacher_name FROM manual_reviews m
               LEFT JOIN teacher_accounts a ON a.id = m.teacher_id
               WHERE m.flow_instance_id = ? AND m.node_key = ? ORDER BY m.created_at DESC, m.id DESC""",
            (row['flow_instance_id'], row['node_key']),
        ).fetchall()
        from app.repositories.manual_feedback import draft_feedback, published_feedback
        return {
            'feedbackDraft': draft_feedback(connection, node_instance_id, fingerprint),
            'feedback': published_feedback(connection, row['flow_instance_id'], row['node_key'], fingerprint),
            'nodeInstanceId': node_instance_id, 'title': node['title'], 'requirement': node.get('requirement', ''),
            'student': {'name': row['name'], 'studentNo': row['student_no']},
            'status': status, 'evidenceHash': fingerprint, 'sources': evidence['sources'],
            'history': [{'id': item['id'], 'remark': item['remark'], 'reviewedAt': item['created_at'],
                         'teacherName': item['teacher_name'] or '原审核教师'} for item in history],
        }


def approve_manual_review(node_instance_id, teacher_id, evidence_hash, remark, feedback_revision):
    with get_connection() as connection:
        connection.execute('BEGIN IMMEDIATE')
        row, config, node, status = _context(connection, node_instance_id, teacher_id)
        evidence, fingerprint = review_evidence(connection, row['flow_instance_id'], config, row['node_key'])
        if fingerprint != evidence_hash:
            raise ManualReviewConflict('材料已更新，请重新查看后审核')
        from app.repositories.manual_feedback import publish_feedback
        publish_feedback(connection, node_instance_id, teacher_id, evidence_hash, feedback_revision, remark)
        if status == 'approved':
            previous = latest_review(connection, node_instance_id)
            if previous and previous['evidence_hash'] == fingerprint:
                return
        if status != 'reviewing':
            raise ManualReviewConflict('前置材料尚未全部通过或尚未到审核开始时间')
        now = utc_now_iso()
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
