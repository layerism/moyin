"""One-time, transactional consolidation; keep identifiers and frozen versions intact."""
import json
from datetime import UTC, datetime


MIGRATION_ID = "20261015_consolidate_flow_tables"
ASSET_TABLES = (
    ("flow_template_assets", "flow_version_templates", "template_asset_id", "template"),
    ("flow_content_assets", "flow_version_content_assets", "content_asset_id", "content"),
    ("flow_announcement_files", "flow_version_announcement_files", "announcement_file_id", "announcement"),
)


def migrate_flow_tables(connection):
    connection.execute("BEGIN IMMEDIATE")
    if connection.execute("SELECT 1 FROM schema_migrations WHERE id = ?", (MIGRATION_ID,)).fetchone():
        return
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    columns = "id, flow_id, node_key, storage_key, original_name, content_type, size_bytes, sha256, etag, created_by, created_at"
    for assets, references, asset_column, kind in ASSET_TABLES:
        if assets in tables:
            connection.execute(
                f"INSERT INTO flow_assets ({columns}, asset_kind) SELECT {columns}, ? FROM {assets}", (kind,),
            )
        if references in tables:
            connection.execute(
                f"""INSERT INTO flow_version_assets (flow_version_id, node_key, asset_id, asset_kind)
                    SELECT flow_version_id, node_key, {asset_column}, ? FROM {references}""", (kind,),
            )

    # The download event continues to reference a template, not an arbitrary resource kind.
    if any(row['table'] == 'flow_template_assets'
           for row in connection.execute('PRAGMA foreign_key_list(template_download_events)')):
        connection.execute("""CREATE TABLE template_download_events_consolidated (
            node_instance_id TEXT NOT NULL REFERENCES node_instances(id) ON DELETE CASCADE,
            template_asset_id TEXT NOT NULL,
            asset_kind TEXT NOT NULL DEFAULT 'template' CHECK (asset_kind = 'template'),
            student_account_id INTEGER NOT NULL REFERENCES student_accounts(id) ON DELETE CASCADE,
            downloaded_at TEXT NOT NULL,
            PRIMARY KEY(node_instance_id, template_asset_id),
            FOREIGN KEY(template_asset_id, asset_kind)
                REFERENCES flow_assets(id, asset_kind) ON DELETE RESTRICT
        )""")
        connection.execute("""INSERT INTO template_download_events_consolidated
            (node_instance_id, template_asset_id, student_account_id, downloaded_at)
            SELECT node_instance_id, template_asset_id, student_account_id, downloaded_at
            FROM template_download_events""")
        connection.execute("DROP TABLE template_download_events")
        connection.execute("ALTER TABLE template_download_events_consolidated RENAME TO template_download_events")
        connection.execute("CREATE INDEX idx_template_download_events_student ON template_download_events(student_account_id, node_instance_id)")

    drafts = {}

    def parameters(flow_id):
        if flow_id not in drafts:
            row = connection.execute("SELECT draft_config FROM flows WHERE id = ?", (flow_id,)).fetchone()
            drafts[flow_id] = json.loads(row['draft_config'])
        return drafts[flow_id].setdefault('publishedNodeParameters', {})

    if 'node_form_parameters' in tables:
        for row in connection.execute('SELECT * FROM node_form_parameters'):
            entries = parameters(row['flow_id'])
            existing = entries.get(row['node_key'])
            if existing and (existing.get('params') != json.loads(row['params_json'])
                             or existing.get('generation') != row['generation']):
                raise ValueError('表单参数存在两份不同的生效记录，迁移已取消')
            entries[row['node_key']] = {
                **(existing or {}), 'params': json.loads(row['params_json']),
                'generation': row['generation'], 'updatedBy': row['updated_by'], 'updatedAt': row['updated_at'],
            }
    if 'flow_node_runtime_configs' in tables:
        rows = connection.execute("""SELECT r.*, v.flow_id, v.config_snapshot
            FROM flow_node_runtime_configs r JOIN flow_versions v ON v.id = r.flow_version_id""")
        for row in rows:
            nodes = {node['id']: node for node in json.loads(row['config_snapshot'])['nodes']}
            if row['node_key'] not in nodes:
                raise ValueError('运行截止时间引用不存在的版本节点，迁移已取消')
            if row['deadline_at'] == nodes[row['node_key']].get('deadlineAt'):
                continue
            entry = parameters(row['flow_id']).setdefault(row['node_key'], {'params': {}, 'generation': 0})
            entry.setdefault('versionOverrides', {})[row['flow_version_id']] = {
                'params': {'deadlineAt': row['deadline_at']},
                'updatedBy': row['updated_by'], 'updatedAt': row['updated_at'],
            }
    for flow_id, draft in drafts.items():
        connection.execute('UPDATE flows SET draft_config = ? WHERE id = ?',
                           (json.dumps(draft, ensure_ascii=False), flow_id))

    for assets, references, _, _ in ASSET_TABLES:
        if references in tables:
            connection.execute(f'DROP TABLE {references}')
        if assets in tables:
            connection.execute(f'DROP TABLE {assets}')
    for table in ('node_form_parameters', 'flow_node_runtime_configs'):
        if table in tables:
            connection.execute(f'DROP TABLE {table}')
    if connection.execute('PRAGMA foreign_key_check').fetchone():
        raise ValueError('数据库迁移后外键不完整，迁移已取消')
    connection.execute('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
                       (MIGRATION_ID, datetime.now(UTC).isoformat()))
