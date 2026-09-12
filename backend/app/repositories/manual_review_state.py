"""Manual review evidence and state transitions within the caller's transaction."""
import hashlib
import json

from app.domain.workflow_revision import reachable_successors
from app.domain.workflow_runtime import incoming_nodes, pending_node_status
from app.services.security import utc_now_iso


def review_evidence(connection, instance_id, config, node_key):
    sources = []
    predecessors = incoming_nodes(config)[node_key]
    target = next(node for node in config['nodes'] if node['id'] == node_key)
    for node in config['nodes']:
        if node['id'] not in predecessors:
            continue
        row = connection.execute(
            """SELECT n.id, n.status, n.approved_at, n.attempt_no,
                      s.id AS submission_id, s.payload_snapshot, s.submitted_at,
                      j.result_json, j.effective_params_json, g.result_snapshot
               FROM node_instances n
               LEFT JOIN submissions s ON s.node_instance_id = n.id AND s.attempt_no = n.attempt_no
               LEFT JOIN audit_jobs j ON j.submission_id = s.id
               LEFT JOIN answer_sheet_grades g ON g.submission_id = s.id
               WHERE n.flow_instance_id = ? AND n.node_key = ?""",
            (instance_id, node['id']),
        ).fetchone()
        files = connection.execute(
            """SELECT id, original_name, content_type, size_bytes, storage_key
               FROM uploaded_files WHERE submission_id = ? ORDER BY display_order, created_at, id""",
            (row['submission_id'],),
        ).fetchall() if row and row['submission_id'] else []
        manual = latest_review(connection, row['id']) if row and row['status'] == 'approved' and node['kind'] == 'manual_review' else None
        sources.append({
            'nodeKey': node['id'], 'title': node['title'], 'kind': node['kind'],
            'requirement': node.get('requirement', ''), 'infoFields': node.get('infoFields', []),
            'answerSheet': node.get('answerSheet'),
            'status': row['status'] if row else 'locked',
            'submissionId': row['submission_id'] if row else None,
            'submittedAt': row['submitted_at'] if row else None,
            'approvedAt': row['approved_at'] if row else None,
            'submission': json.loads(row['payload_snapshot']) if row and row['payload_snapshot'] else {},
            'audit': json.loads(row['result_json']) if row and row['result_json'] else None,
            'auditParams': json.loads(row['effective_params_json']) if row and row['effective_params_json'] else node.get('auditScriptParams', {}),
            'grade': json.loads(row['result_snapshot']) if row and row['result_snapshot'] else None,
            'manualReview': {'id': manual['id'], 'remark': manual['remark'], 'reviewedAt': manual['created_at']} if manual else None,
            'files': [dict(file) for file in files],
        })
    evidence = {'nodeKey': node_key, 'requirement': target.get('requirement', ''), 'sources': sources}
    encoded = json.dumps(evidence, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return evidence, hashlib.sha256(encoded.encode()).hexdigest()


def latest_review(connection, node_instance_id):
    return connection.execute(
        'SELECT * FROM manual_reviews WHERE node_instance_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
        (node_instance_id,),
    ).fetchone()


def sync_manual_reviews(connection, instance_id, config):
    manual_nodes = [node for node in config['nodes'] if node.get('kind') == 'manual_review']
    if not manual_nodes:
        return
    now = utc_now_iso()
    rows = {row['node_key']: row for row in connection.execute(
        'SELECT * FROM node_instances WHERE flow_instance_id = ?', (instance_id,),
    ).fetchall()}
    invalidated = set()
    for node in manual_nodes:
        row = rows.get(node['id'])
        if row is None or row['status'] != 'approved':
            continue
        previous = latest_review(connection, row['id'])
        _, fingerprint = review_evidence(connection, instance_id, config, node['id'])
        if previous is None or previous['evidence_hash'] != fingerprint:
            invalidated.add(node['id'])
    if invalidated:
        invalidated |= reachable_successors(config, invalidated)
        for node_key in invalidated:
            row = rows.get(node_key)
            if row is None:
                continue
            connection.execute(
                "UPDATE node_instances SET status = 'locked', approved_at = NULL, attempt_reset_no = attempt_no WHERE id = ?", (row['id'],),
            )
            node = next(item for item in config['nodes'] if item['id'] == node_key)
            if node.get('kind') in {'form', 'answer_sheet'}:
                connection.execute(
                    """INSERT INTO node_drafts (node_instance_id, payload, updated_at)
                       SELECT node_instance_id, payload_snapshot, ? FROM submissions
                       WHERE node_instance_id = ? AND attempt_no = ?
                       ON CONFLICT(node_instance_id) DO NOTHING""",
                    (now, row['id'], row['attempt_no']),
                )
            connection.execute(
                """UPDATE audit_jobs SET status = 'cancelled', cancellation_reason = 'source_updated',
                   finished_at = ?, updated_at = ?
                   WHERE node_instance_id = ? AND status IN ('pending', 'running')""",
                (now, now, row['id']),
            )
        connection.execute(
            "UPDATE flow_instances SET status = 'in_progress', completed_at = NULL WHERE id = ?", (instance_id,),
        )
    statuses = {row['node_key']: row['status'] for row in connection.execute(
        'SELECT node_key, status FROM node_instances WHERE flow_instance_id = ?', (instance_id,),
    ).fetchall()}
    preview = connection.execute('SELECT 1 FROM flow_preview_sessions WHERE flow_instance_id = ?', (instance_id,)).fetchone()
    incoming = incoming_nodes(config)
    for node in manual_nodes:
        row = rows.get(node['id'])
        if row is None or statuses[node['id']] == 'approved':
            continue
        predecessors = incoming[node['id']]
        status = pending_node_status(
            bool(predecessors) and all(statuses.get(key) == 'approved' for key in predecessors),
            None if preview else node.get('startAt'), None,
        )
        if status == 'available':
            status = 'reviewing'
        if status != statuses[node['id']]:
            connection.execute(
                'UPDATE node_instances SET status = ?, opened_at = ? WHERE id = ?',
                (status, now if status == 'reviewing' else row['opened_at'], row['id']),
            )
