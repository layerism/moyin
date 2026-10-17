"""Resolve published, approved revisions without mutating submission evidence."""
import json
import mimetypes


def effective_files(connection, rows, *, id_key='id'):
    """Keep original IDs as authorized resource handles; replace only file metadata."""
    result = []
    revisions = {}
    for original in rows:
        item = dict(original)
        source_id = item[id_key]
        context = connection.execute('''SELECT n.id FROM student_uploaded_files u
            JOIN node_submissions s ON s.id = u.submission_id
            JOIN node_instances n ON n.id = s.node_instance_id
            WHERE u.id = ? AND s.attempt_no = n.attempt_no
              AND s.status = 'approved' AND n.status = 'approved'
              AND n.attempt_no > n.attempt_reset_no''', (source_id,)).fetchone()
        if context:
            node_id = context['id']
            if node_id not in revisions:
                feedback = connection.execute('''SELECT files_json, evidence_hash
                    FROM audit_manual_feedback WHERE node_instance_id = ?
                    ORDER BY created_at DESC, revision DESC LIMIT 1''', (node_id,)).fetchone()
                replacements = {}
                review = connection.execute("""SELECT evidence_hash, evidence_snapshot
                    FROM audit_manual_reviews WHERE node_instance_id = ?
                    ORDER BY created_at DESC, rowid DESC LIMIT 1""", (node_id,)).fetchone()
                if (feedback and review and feedback['evidence_hash'] == review['evidence_hash']
                        and json.loads(review['evidence_snapshot']).get('passed') is True):
                    for file_id in json.loads(feedback['files_json']):
                        file = connection.execute('SELECT * FROM audit_manual_feedback_files WHERE id = ? AND node_instance_id = ?', (file_id, node_id)).fetchone()
                        if file:
                            replacements[file['source_file_id']] = dict(file)
                revisions[node_id] = replacements
            revision = revisions[node_id].get(source_id)
            if revision:
                item.update(content_version=revision['id'], original_name=revision['original_name'], storage_key=revision['storage_key'],
                            size_bytes=revision['size_bytes'],
                            content_type=mimetypes.guess_type(revision['original_name'])[0] or 'application/octet-stream',
                            sha256='', etag=None, page_count=0)
        result.append(item)
    return result


def effective_submission(connection, payload, submission_id):
    """Project final metadata into runtime payloads; never persist this projection."""
    payload = dict(payload)
    if not submission_id:
        return payload
    rows = connection.execute('SELECT * FROM student_uploaded_files WHERE submission_id = ?', (submission_id,)).fetchall()
    resolved = {row['id']: row for row in effective_files(connection, rows)}

    def project(file):
        row = resolved.get(file.get('fileId'))
        if row is None:
            return file
        updated = {**file, 'name': row['original_name'], 'size': row['size_bytes'], 'type': row['content_type']}
        if 'pageCount' in file:
            updated['pageCount'] = row['page_count']
        return updated

    if isinstance(payload.get('file'), dict):
        payload['file'] = project(payload['file'])
    if isinstance(payload.get('scans'), list):
        payload['scans'] = [project(file) for file in payload['scans']]
    return payload
