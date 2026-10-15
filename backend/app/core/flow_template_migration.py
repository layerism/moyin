"""Move immutable template definitions and availability into flows."""
import json
from datetime import UTC, datetime


MIGRATION_ID = '20261015_immutable_flow_templates'
LEGACY_TABLES = ('workflow_blueprints', 'workflow_blueprint_versions', 'workflow_blueprint_drafts')


def migrate_flow_templates(connection):
    connection.execute('BEGIN IMMEDIATE')
    if connection.execute('SELECT 1 FROM schema_migrations WHERE id = ?', (MIGRATION_ID,)).fetchone():
        return
    columns = {row['name'] for row in connection.execute('PRAGMA table_info(flows)')}
    if 'kind' not in columns:
        connection.execute("ALTER TABLE flows ADD COLUMN kind TEXT NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal', 'template'))")
    if 'is_shared' not in columns:
        connection.execute("ALTER TABLE flows ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0 CHECK (is_shared IN (0, 1) AND (kind = 'template' OR is_shared = 0))")
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    legacy = {table: [dict(row) for row in connection.execute(f'SELECT * FROM {table}')]
              if table in tables else [] for table in LEGACY_TABLES}
    now = datetime.now(UTC).isoformat()

    # Already archived definitions without a surviving catalog entry remain
    # archived and retain their owner and resources.
    connection.execute("UPDATE flows SET kind = 'template' WHERE owner_id = 'workflow-template-library'")
    for version in legacy['workflow_blueprint_versions']:
        connection.execute("""UPDATE flows SET kind = 'template', is_shared = 0,
            status = 'archived', owner_id = ?, group_id = NULL WHERE id = ?""",
            (str(version['created_by']), version['snapshot_flow_id']))
    for blueprint in legacy['workflow_blueprints']:
        changed = connection.execute("""UPDATE flows SET kind = 'template', is_shared = ?,
            status = 'draft', name = ?, description = ?, owner_id = ?, group_id = NULL,
            created_at = ?, updated_at = ? WHERE id = ?""",
            (blueprint['active'], blueprint['name'], blueprint['description'], str(blueprint['created_by']),
             blueprint['created_at'], blueprint['updated_at'], blueprint['snapshot_flow_id']))
        if changed.rowcount != 1:
            raise ValueError('模板定义缺失，迁移已取消')
    for draft in legacy['workflow_blueprint_drafts']:
        connection.execute("UPDATE flows SET kind = 'normal', is_shared = 0, owner_id = ? WHERE id = ?",
                           (str(draft['teacher_id']), draft['flow_id']))
    if any(legacy.values()):
        connection.execute("""INSERT INTO audit_logs
            (action, entity_type, entity_id, before_data, after_data, created_at)
            VALUES ('flow_templates_migrated', 'schema_migration', ?, ?, ?, ?)""",
            (MIGRATION_ID, json.dumps(legacy, ensure_ascii=False),
             json.dumps({b['id']: b['snapshot_flow_id'] for b in legacy['workflow_blueprints']}), now))
    for table in ('workflow_blueprint_drafts', 'workflow_blueprint_versions', 'workflow_blueprints'):
        if table in tables:
            connection.execute(f'DROP TABLE {table}')
    if connection.execute('PRAGMA foreign_key_check').fetchone():
        raise ValueError('模板迁移后外键不完整，迁移已取消')
    connection.execute('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', (MIGRATION_ID, now))
