"""Draft and published teacher feedback, separate from student originals."""
import json
import uuid

from app.core.database import get_connection
from app.repositories.flow_roster import assert_student_roster_access
from app.repositories.manual_reviews import ManualReviewConflict, _context
from app.repositories.manual_review_state import review_evidence
from app.services.security import utc_now_iso


def draft_feedback(connection, node_instance_id, evidence_hash):
    connection.execute(
        """INSERT INTO manual_feedback_drafts (node_instance_id, evidence_hash, revision)
           VALUES (?, ?, 0) ON CONFLICT(node_instance_id) DO UPDATE SET
           evidence_hash = excluded.evidence_hash, revision = revision + 1, files_json = '[]'
           WHERE manual_feedback_drafts.evidence_hash != excluded.evidence_hash""",
        (node_instance_id, evidence_hash),
    )
    row = connection.execute('SELECT * FROM manual_feedback_drafts WHERE node_instance_id = ?', (node_instance_id,)).fetchone()
    latest = connection.execute('SELECT remark FROM manual_feedback WHERE node_instance_id = ? AND evidence_hash = ? ORDER BY revision DESC LIMIT 1', (node_instance_id, evidence_hash)).fetchone()
    return {'revision': row['revision'], 'files': file_items(connection, json.loads(row['files_json'])), 'remark': latest['remark'] if latest else ''}


def file_items(connection, ids):
    result = []
    for file_id in ids:
        row = connection.execute('SELECT f.id, f.source_file_id, f.source_name, f.original_name, f.size_bytes, n.node_key AS source_node_key FROM manual_feedback_files f LEFT JOIN uploaded_files u ON u.id = f.source_file_id LEFT JOIN node_instances n ON n.id = u.node_instance_id WHERE f.id = ?', (file_id,)).fetchone()
        if row:
            result.append({'id': row['id'], 'sourceFileId': row['source_file_id'], 'sourceNodeKey': row['source_node_key'], 'sourceName': row['source_name'], 'name': row['original_name'], 'sizeBytes': row['size_bytes']})
    return result


def published_feedback(connection, instance_id, node_key, evidence_hash):
    rows = connection.execute('SELECT * FROM manual_feedback WHERE flow_instance_id = ? AND node_key = ? ORDER BY created_at DESC, revision DESC', (instance_id, node_key)).fetchall()
    return [{'id': row['id'], 'remark': row['remark'], 'publishedAt': row['created_at'], 'historical': row['evidence_hash'] != evidence_hash or row['id'] != rows[0]['id'],
             'files': file_items(connection, json.loads(row['files_json']))} for row in rows]


def checked_draft(connection, node_instance_id, teacher_id, evidence_hash, revision):
    row, config, node, status = _context(connection, node_instance_id, teacher_id)
    evidence, current_hash = review_evidence(connection, row['flow_instance_id'], config, row['node_key'])
    if node.get('kind') == 'file':
        from app.repositories.file_reviews import review_stage
        submission_id = evidence['sources'][0]['submissionId']
        if status != 'reviewing' or review_stage(connection, submission_id) != 'manual':
            raise ManualReviewConflict('当前材料未轮到人工审核或本轮已结束，请刷新')

    if current_hash != evidence_hash:
        raise ManualReviewConflict('学生材料已更新，请刷新后重新处理批改文件')
    draft = draft_feedback(connection, node_instance_id, current_hash)
    if draft['revision'] != revision:
        raise ManualReviewConflict('反馈已被修改，请刷新后重试')
    if status not in {'reviewing', 'approved', 'rejected'}:
        raise ManualReviewConflict('材料尚未就绪，暂不能提交教师反馈')
    return row, evidence, draft


def check_upload(node_instance_id, teacher_id, evidence_hash, revision, source_file_id):
    with get_connection() as connection:
        connection.execute('BEGIN IMMEDIATE')
        _, evidence, _ = checked_draft(connection, node_instance_id, teacher_id, evidence_hash, revision)
        if not any(file['id'] == source_file_id for source in evidence['sources'] for file in source['files']):
            raise ValueError('原文件不属于本次审核材料')


def add_feedback_file(node_instance_id, teacher_id, evidence_hash, revision, source_file_id, name, storage_key, size_bytes):
    with get_connection() as connection:
        connection.execute('BEGIN IMMEDIATE')
        row, evidence, draft = checked_draft(connection, node_instance_id, teacher_id, evidence_hash, revision)
        source_file = next((file for source in evidence['sources'] for file in source['files'] if file['id'] == source_file_id), None)
        if source_file is None:
            raise ValueError('原文件不属于本次审核材料')
        file_id = str(uuid.uuid4())
        connection.execute('''INSERT INTO manual_feedback_files
            (id, flow_instance_id, node_instance_id, evidence_hash, source_file_id, source_name, original_name, storage_key, size_bytes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (file_id, row['flow_instance_id'], node_instance_id, evidence_hash, source_file_id, source_file['original_name'], name, storage_key, size_bytes, utc_now_iso()))
        embedded = connection.execute('SELECT 1 FROM file_review_runs r JOIN submissions s ON s.id = r.submission_id WHERE s.node_instance_id = ? AND s.attempt_no = ?',
                                      (row['id'], row['attempt_no'])).fetchone()
        ids = [file['id'] for file in draft['files'] if embedded or file['sourceFileId'] != source_file_id] + [file_id]
        connection.execute('UPDATE manual_feedback_drafts SET files_json = ?, revision = revision + 1 WHERE node_instance_id = ?', (json.dumps(ids), node_instance_id))
        return draft_feedback(connection, node_instance_id, evidence_hash)


def remove_feedback_file(node_instance_id, teacher_id, evidence_hash, revision, file_id):
    with get_connection() as connection:
        connection.execute('BEGIN IMMEDIATE')
        _, _, draft = checked_draft(connection, node_instance_id, teacher_id, evidence_hash, revision)
        if file_id not in [file['id'] for file in draft['files']]:
            raise KeyError(file_id)
        ids = [file['id'] for file in draft['files'] if file['id'] != file_id]
        connection.execute('UPDATE manual_feedback_drafts SET files_json = ?, revision = revision + 1 WHERE node_instance_id = ?', (json.dumps(ids), node_instance_id))
        return draft_feedback(connection, node_instance_id, evidence_hash)


def publish_feedback(connection, node_instance_id, teacher_id, evidence_hash, revision, remark):
    row, _, draft = checked_draft(connection, node_instance_id, teacher_id, evidence_hash, revision)
    ids = [file['id'] for file in draft['files']]
    existing = connection.execute('SELECT remark, files_json FROM manual_feedback WHERE node_instance_id = ? AND evidence_hash = ? ORDER BY revision DESC LIMIT 1', (node_instance_id, evidence_hash)).fetchone()
    if existing and existing['remark'] == remark.strip() and json.loads(existing['files_json']) == ids:
        return
    connection.execute('''INSERT INTO manual_feedback
        (id, flow_instance_id, node_instance_id, node_key, evidence_hash, revision, files_json, remark, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
        (str(uuid.uuid4()), row['flow_instance_id'], node_instance_id, row['node_key'], evidence_hash, revision, json.dumps(ids), remark.strip(), utc_now_iso()))
    connection.execute('UPDATE manual_feedback_drafts SET revision = revision + 1 WHERE node_instance_id = ?', (node_instance_id,))


def save_feedback(node_instance_id, teacher_id, evidence_hash, revision, remark):
    with get_connection() as connection:
        connection.execute('BEGIN IMMEDIATE')
        publish_feedback(connection, node_instance_id, teacher_id, evidence_hash, revision, remark)


def feedback_download(file_id, *, teacher_id=None, student_id=None):
    with get_connection() as connection:
        file = connection.execute('SELECT f.*, i.student_account_id, v.flow_id FROM manual_feedback_files f JOIN flow_instances i ON i.id = f.flow_instance_id JOIN flow_versions v ON v.id = i.flow_version_id WHERE f.id = ?', (file_id,)).fetchone()
        if file is None:
            raise KeyError(file_id)
        if teacher_id is not None:
            # The node may have been replaced by a published revision; authorize by the surviving instance.
            owner = connection.execute('SELECT 1 FROM flows WHERE id = ? AND owner_id = ?', (file['flow_id'], str(teacher_id))).fetchone()
            if owner is None:
                raise KeyError(file_id)
            assert_student_roster_access(connection, file['flow_id'], file['student_account_id'])
        else:
            if file['student_account_id'] != student_id:
                raise KeyError(file_id)
            assert_student_roster_access(connection, file['flow_id'], student_id)
            visible = connection.execute('SELECT 1 FROM manual_feedback m, json_each(m.files_json) j WHERE m.flow_instance_id = ? AND j.value = ? LIMIT 1', (file['flow_instance_id'], file_id)).fetchone()
            if not visible:
                raise KeyError(file_id)
        return dict(file)
