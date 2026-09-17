"""Student-facing review disclosure, grouped by immutable submission and step."""
import json

from app.domain.file_review_steps import step_kind
from app.repositories.manual_feedback import file_items


def review_timeline(connection, node_id, audits):
    runs = connection.execute('''SELECT r.*, s.attempt_no FROM file_review_runs r
        JOIN submissions s ON s.id = r.submission_id WHERE s.node_instance_id = ?
        ORDER BY s.attempt_no DESC''', (node_id,)).fetchall()
    feedback = connection.execute('''SELECT f.*, c.submission_id, c.step_index FROM manual_feedback f
        LEFT JOIN file_review_feedback_context c ON c.feedback_id = f.id
        WHERE f.node_instance_id = ? ORDER BY f.created_at, f.revision''', (node_id,)).fetchall()
    decisions = connection.execute('SELECT * FROM manual_reviews WHERE node_instance_id = ? ORDER BY created_at, rowid', (node_id,)).fetchall()
    result = []
    for run in runs:
        steps = json.loads(run['steps_json'])
        items = []
        for index, step in enumerate(steps):
            kind = step_kind(step)
            decisions_here = []
            for decision in decisions:
                evidence = json.loads(decision['evidence_snapshot'])
                sources = evidence.get('sources', [])
                legacy_index = next((i for i, s in enumerate(steps) if step_kind(s) == 'manual'), -1)
                if sources and sources[0].get('submissionId') == run['submission_id'] and evidence.get('reviewStepIndex', legacy_index) == index:
                    decisions_here.append(decision)
            annotations = []
            for record in feedback:
                matched = record['submission_id'] == run['submission_id'] and record['step_index'] == index
                # Existing records are linked by their exact evidence fingerprint, never by display time.
                matched = matched or (record['submission_id'] is None and any(d['evidence_hash'] == record['evidence_hash'] for d in decisions_here))
                if not matched:
                    continue
                annotations.append({'id': record['id'], 'remark': record['remark'], 'publishedAt': record['created_at'],
                                    'files': file_items(connection, json.loads(record['files_json']))})
            final = decisions_here[-1] if decisions_here else None
            if final:
                passed = json.loads(final['evidence_snapshot']).get('passed')
                if annotations and annotations[-1]['remark'] == final['remark']:
                    annotations[-1]['passed'] = passed
                    annotations[-1]['corrected'] = len(decisions_here) > 1
                    annotations[-1]['publishedAt'] = final['created_at']
                else:
                    annotations.append({'id': final['id'], 'remark': final['remark'], 'publishedAt': final['created_at'], 'files': [], 'passed': passed})
            audit = next((a for a in audits if a['attemptNo'] == run['attempt_no'] and a.get('stepIndex', 0) == index), None) if kind != 'manual' else None
            status = 'waiting'
            if audit:
                status = 'passed' if audit['passed'] else 'rejected'
            elif final:
                status = 'passed' if json.loads(final['evidence_snapshot']).get('passed') else 'rejected'
            elif index < run['step_index']:
                status = 'passed'
            elif index == run['step_index'] and run['status'] == 'active':
                status = 'active'
            elif run['status'] in ('rejected', 'cancelled'):
                status = 'stopped'
            items.append({'index': index, 'kind': kind, 'status': status, 'audit': audit, 'annotations': annotations})
        result.append({'attemptNo': run['attempt_no'], 'steps': items})
    return result
