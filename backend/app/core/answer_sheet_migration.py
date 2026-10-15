"""Keep current answers in node config and discard persisted score snapshots."""
import hashlib
import json
from datetime import UTC, datetime

from app.domain.answer_sheet import validate_private_answer_key
from app.domain.node_configuration import ANSWER_KEY, META_KEY

MIGRATION_ID = '20261015_consolidate_answer_sheets'
REMOVED_TABLES = (
    'answer_sheet_grade_history', 'answer_sheet_grades',
    'answer_sheet_key_revisions', 'flow_version_answer_keys', 'answer_sheet_drafts',
)


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def migrate_answer_sheets(connection):
    connection.execute('BEGIN IMMEDIATE')
    if connection.execute('SELECT 1 FROM schema_migrations WHERE id = ?', (MIGRATION_ID,)).fetchone():
        return
    tables = {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    drafts = {}
    if 'answer_sheet_drafts' in tables:
        drafts = {(r['flow_id'], r['node_key']): dict(r)
                  for r in connection.execute('SELECT * FROM answer_sheet_drafts')}
    revisions = {}
    if 'answer_sheet_key_revisions' in tables:
        for row in connection.execute('SELECT * FROM answer_sheet_key_revisions ORDER BY generation'):
            revisions[(row['flow_id'], row['node_key'])] = dict(row)
    frozen = {}
    if 'flow_version_answer_keys' in tables:
        frozen = {(r['flow_version_id'], r['node_key']): json.loads(r['grading_snapshot'])
                  for r in connection.execute('SELECT * FROM flow_version_answer_keys')}
    fallback = {}
    versions = connection.execute('SELECT * FROM flow_versions ORDER BY version_no').fetchall()
    for version in versions:
        if version['status'] == 'preview':
            continue
        for node in json.loads(version['config_snapshot']).get('nodes', []):
            key = frozen.get((version['id'], node['id']))
            if key is not None:
                fallback[(version['flow_id'], node['id'])] = key

    for flow in connection.execute('SELECT id, draft_config FROM flows').fetchall():
        config = json.loads(flow['draft_config'])
        changed = False
        for node in config.get('nodes', []):
            if node.get('kind') != 'answer_sheet':
                continue
            identity = (flow['id'], node['id'])
            revision, draft = revisions.get(identity), drafts.get(identity)
            row = revision or draft
            key = (json.loads(revision['grading_snapshot']) if revision else
                   json.loads(draft['grading_config']) if draft else
                   node.get(ANSWER_KEY, fallback.get(identity)))
            if key is None:
                raise ValueError('答题卡标准答案缺失，迁移已取消')
            validate_private_answer_key(node, key, require_publishable=False)
            node[ANSWER_KEY] = key
            if row:
                node.setdefault(META_KEY, {})['answerKey'] = {
                    'generation': revision['generation'] if revision else 1,
                    'updatedBy': row['updated_by'], 'updatedAt': row['updated_at'],
                }
            changed = True
        if changed:
            connection.execute('UPDATE flows SET draft_config = ? WHERE id = ?', (_json(config), flow['id']))

    # Preview is isolated: retain its original answers, never substitute current ones.
    for version in versions:
        if version['status'] != 'preview':
            continue
        config = json.loads(version['config_snapshot'])
        changed = False
        for node in config.get('nodes', []):
            if node.get('kind') != 'answer_sheet':
                continue
            key = frozen.get((version['id'], node['id']), node.get(ANSWER_KEY))
            if key is None:
                raise ValueError('预览答题卡标准答案缺失，迁移已取消')
            validate_private_answer_key(node, key, require_publishable=True)
            node[ANSWER_KEY] = key
            changed = True
        if changed:
            snapshot = _json(config)
            connection.execute('UPDATE flow_versions SET config_snapshot = ?, config_hash = ? WHERE id = ?',
                               (snapshot, hashlib.sha256(snapshot.encode()).hexdigest(), version['id']))
    for table in REMOVED_TABLES:
        if table in tables:
            connection.execute(f'DROP TABLE {table}')
    if connection.execute('PRAGMA foreign_key_check').fetchone():
        raise ValueError('答题卡迁移后外键不完整，迁移已取消')
    connection.execute('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
                       (MIGRATION_ID, datetime.now(UTC).isoformat()))
