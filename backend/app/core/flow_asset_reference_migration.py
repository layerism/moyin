"""Remove the resource link table only after proving saved configs retain its references."""
import json
from datetime import UTC, datetime

from app.domain.node_assets import node_asset_references

MIGRATION_ID = '20261015_direct_flow_asset_references'


def version_asset_references(config):
    """The legacy link table contains main templates, images and announcement files."""
    return {
        (node['id'], kind, asset_id)
        for node in config.get('nodes', [])
        for kind, asset_id in node_asset_references(node)
        if kind != 'template' or asset_id == (node.get('templateAsset') or {}).get('assetId')
    }


def assert_version_asset_reference(connection, version_id, node_key, asset_id, asset_kind):
    """Used when upgrading databases that still have the original split asset tables."""
    version = connection.execute('SELECT flow_id, config_snapshot FROM flow_versions WHERE id = ?',
                                 (version_id,)).fetchone()
    asset = connection.execute('SELECT flow_id, node_key, asset_kind FROM flow_assets WHERE id = ?',
                               (asset_id,)).fetchone()
    if (version is None or asset is None
            or tuple(asset) != (version['flow_id'], node_key, asset_kind)
            or (node_key, asset_kind, asset_id) not in version_asset_references(json.loads(version['config_snapshot']))):
        raise ValueError('版本资源关联与快照不一致，迁移已取消')


def migrate_flow_asset_references(connection):
    connection.execute('BEGIN IMMEDIATE')
    if connection.execute('SELECT 1 FROM schema_migrations WHERE id = ?', (MIGRATION_ID,)).fetchone():
        return
    assets = {r['id']: r for r in connection.execute('SELECT id, flow_id, node_key, asset_kind FROM flow_assets')}
    versions = connection.execute('SELECT id, flow_id, config_snapshot FROM flow_versions').fetchall()
    configs = [(r['flow_id'], json.loads(r['config_snapshot'])) for r in versions]
    configs.extend((r['id'], json.loads(r['draft_config']))
                   for r in connection.execute('SELECT id, draft_config FROM flows'))
    for flow_id, config in configs:
        for node in config.get('nodes', []):
            for kind, asset_id in node_asset_references(node):
                asset = assets.get(asset_id)
                if asset is None or (asset['flow_id'], asset['node_key'], asset['asset_kind']) != (flow_id, node['id'], kind):
                    raise ValueError('配置引用了缺失或归属不符的资源，迁移已取消')
    legacy = connection.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'flow_version_assets'").fetchone()
    if legacy:
        expected = {(r['id'], *reference) for r in versions
                    for reference in version_asset_references(json.loads(r['config_snapshot']))}
        actual = {tuple(r) for r in connection.execute(
            'SELECT flow_version_id, node_key, asset_kind, asset_id FROM flow_version_assets')}
        if actual != expected:
            raise ValueError('版本资源关联与快照不一致，迁移已取消')
        connection.execute('DROP TABLE flow_version_assets')
    if connection.execute('PRAGMA foreign_key_check').fetchone():
        raise ValueError('资源引用迁移后外键不完整，迁移已取消')
    connection.execute('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
                       (MIGRATION_ID, datetime.now(UTC).isoformat()))
