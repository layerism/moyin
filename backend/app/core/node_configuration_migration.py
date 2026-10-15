"""Move effective node parameters into flows.nodes without changing student records."""
import copy
import hashlib
import json
from datetime import UTC, datetime

from app.domain.node_configuration import FIELDS, META_KEY, copy_fields

MIGRATION_ID = '20261015_node_configuration'


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def migrate_node_configuration(connection):
    connection.execute('BEGIN IMMEDIATE')
    if connection.execute('SELECT 1 FROM schema_migrations WHERE id = ?', (MIGRATION_ID,)).fetchone():
        return
    now = datetime.now(UTC).isoformat()
    tables = {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    flows = {r['id']: json.loads(r['draft_config']) for r in connection.execute('SELECT id, draft_config FROM flows')}
    before = copy.deepcopy(flows)

    def node(flow_id, key):
        result = next((n for n in flows[flow_id]['nodes'] if n['id'] == key), None)
        if result is None:
            raise ValueError('生效参数对应的草稿节点缺失，迁移已取消')
        return result

    def metadata(target, scope, row):
        target.setdefault(META_KEY, {})[scope] = {
            'generation': row['generation'], 'updatedBy': row['updated_by'], 'updatedAt': row['updated_at'],
        }

    # Published values take precedence over unpublished drafts during this migration.
    for version in connection.execute("""SELECT v.* FROM flow_versions v WHERE status = 'published'
        AND version_no = (SELECT MAX(version_no) FROM flow_versions WHERE flow_id = v.flow_id AND status = 'published')"""):
        for base in json.loads(version['config_snapshot'])['nodes']:
            target = node(version['flow_id'], base['id'])
            if target['kind'] != base['kind']:
                raise ValueError('已发布节点类型与草稿不一致，迁移已取消')
            copy_fields(target, base, FIELDS.get(base['kind'], ()))
            if 'referenceAsset' in base and 'referenceAssets' not in base:
                target['referenceAsset'] = copy.deepcopy(base['referenceAsset'])

    for flow_id, config in flows.items():
        for key, entry in config.pop('publishedNodeParameters', {}).items():
            target = node(flow_id, key)
            for version_id, override in entry.get('versionOverrides', {}).items():
                version = connection.execute('SELECT * FROM flow_versions WHERE id = ? AND flow_id = ?', (version_id, flow_id)).fetchone()
                if version is None:
                    raise ValueError('历史参数引用不存在的版本，迁移已取消')
                snapshot = json.loads(version['config_snapshot'])
                original = copy.deepcopy(snapshot)
                old_node = next((n for n in snapshot['nodes'] if n['id'] == key), None)
                if old_node is None:
                    raise ValueError('历史参数引用不存在的版本节点，迁移已取消')
                old_node.update(override['params'])
                encoded = _json(snapshot)
                connection.execute('UPDATE flow_versions SET config_snapshot = ?, config_hash = ? WHERE id = ?',
                                   (encoded, hashlib.sha256(encoded.encode()).hexdigest(), version_id))
                connection.execute("""INSERT INTO audit_logs
                    (action, entity_type, entity_id, before_data, after_data, created_at)
                    VALUES ('node_config_version_migrated', 'flow_version', ?, ?, ?, ?)""",
                    (version_id, _json({'config': original, 'configHash': version['config_hash']}),
                     _json({'config': snapshot, 'override': override}), now))
                if version['status'] == 'published':
                    target.update(override['params'])
            target.update(entry.get('params', {}))
            if 'referenceAssets' in entry.get('params', {}):
                target.pop('referenceAsset', None)
            target.setdefault(META_KEY, {})['parameters'] = {
                'generation': entry.get('generation', 0), 'updatedBy': entry.get('updatedBy'), 'updatedAt': entry.get('updatedAt'),
            }

    if 'node_audit_policies' in tables:
        for row in connection.execute('SELECT * FROM node_audit_policies'):
            target = node(row['flow_id'], row['node_key'])
            if target.get('auditScriptId') != row['script_id']:
                raise ValueError('单脚本策略与节点脚本不一致，迁移已取消')
            target['auditScriptParams'] = json.loads(row['params_json'])
            target['auditModelCardId'] = row['model_card_id']
            if target['kind'] == 'confirmation':
                for field in ('scanAuditMode', 'scanAuditPrompt', 'scanAuditThreshold'):
                    target.pop(field, None)
                    if field in target['auditScriptParams']:
                        target[field] = target['auditScriptParams'][field]
            metadata(target, 'audit', row)
    if 'node_review_step_policies' in tables:
        for row in connection.execute('SELECT * FROM node_review_step_policies'):
            target = node(row['flow_id'], row['node_key'])
            steps = [s for s in target.get('fileReviewSteps', []) if isinstance(s, dict) and s['kind'] != 'manual']
            overrides = json.loads(row['steps_json'])
            if [(s['id'], s.get('auditScriptId')) for s in steps] != [(s['id'], s['auditScriptId']) for s in overrides]:
                raise ValueError('多步骤策略与节点结构不一致，迁移已取消')
            for step, override in zip(steps, overrides):
                step['auditScriptParams'] = override['auditScriptParams']
                step['auditModelCardId'] = override.get('auditModelCardId')
            metadata(target, 'review', row)

    for flow_id, config in flows.items():
        if config == before[flow_id]:
            continue
        connection.execute('UPDATE flows SET draft_config = ? WHERE id = ?', (_json(config), flow_id))
        connection.execute("""INSERT INTO audit_logs
            (action, entity_type, entity_id, before_data, after_data, created_at)
            VALUES ('node_config_migrated', 'flow', ?, ?, ?, ?)""",
            (flow_id, _json(before[flow_id]), _json(config), now))
    for table in ('node_audit_policies', 'node_review_step_policies'):
        if table in tables:
            connection.execute(f'DROP TABLE {table}')
    if connection.execute('PRAGMA foreign_key_check').fetchone():
        raise ValueError('节点参数迁移后外键不完整，迁移已取消')
    connection.execute('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', (MIGRATION_ID, now))
