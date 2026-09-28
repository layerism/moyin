"""Teacher-owned manual review queues and approvals."""
import json

from app.core.database import get_connection
from app.domain.workflow_runtime import node_by_key
from app.repositories.flow_roster import assert_student_roster_access
from app.repositories.branch_state import sync_branch_states
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
    if not has_manual_review(node):
        raise ValueError('该节点不是人工审核节点')
    if node.get('kind') in {'file', 'confirmation'} and str(version['published_by']) != str(teacher_id):
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
                sync_branch_states(connection, instance_id, config)
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
    sync_branch_states(connection, row['flow_instance_id'], config)
    status = connection.execute('SELECT status FROM node_instances WHERE id = ?', (node_instance_id,)).fetchone()['status']
    return row, config, node, status


def get_manual_review(node_instance_id, teacher_id):
    from app.repositories.file_reviews import file_review_detail
    with get_connection() as connection:
        connection.execute('BEGIN IMMEDIATE')
        row, config, node, status = _context(connection, node_instance_id, teacher_id)
        return file_review_detail(connection, row, config, node, status)


def approve_manual_review(node_instance_id, teacher_id, evidence_hash, remark, feedback_revision, source_node_key, source_remark):
    from app.repositories.file_reviews import decide_file_review
    with get_connection() as connection:
        connection.execute('BEGIN IMMEDIATE')
        row, config, node, status = _context(connection, node_instance_id, teacher_id)
        return decide_file_review(connection, row, config, node, status, teacher_id,
                                  evidence_hash, remark, feedback_revision, True)


def reject_manual_source(node_instance_id, teacher_id, evidence_hash, feedback_revision, source_node_key, source_remark):
    from app.repositories.file_reviews import decide_file_review
    with get_connection() as connection:
        connection.execute('BEGIN IMMEDIATE')
        row, config, node, status = _context(connection, node_instance_id, teacher_id)
        return decide_file_review(connection, row, config, node, status, teacher_id,
                                  evidence_hash, source_remark, feedback_revision, False)
