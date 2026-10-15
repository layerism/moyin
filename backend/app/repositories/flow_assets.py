"""Teacher resources are selected by references in workflow configuration."""
import json

from app.domain.node_assets import node_asset_references


def insert_asset(connection, asset_kind, *, id, flow_id, node_key, storage_key,
                 original_name, content_type, size_bytes, sha256, etag, created_by, created_at):
    connection.execute(
        """INSERT INTO flow_assets
           (id, asset_kind, flow_id, node_key, storage_key, original_name, content_type,
            size_bytes, sha256, etag, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (id, asset_kind, flow_id, node_key, storage_key, original_name, content_type,
         size_bytes, sha256, etag, created_by, created_at),
    )


def get_node_template(connection, flow_id, node):
    """Resolve the main template from an already selected runtime node."""
    reference = node.get('templateAsset')
    if not reference:
        return None
    row = connection.execute(
        """SELECT id, storage_key, original_name, content_type, size_bytes
           FROM flow_assets WHERE id = ? AND flow_id = ? AND node_key = ?
             AND asset_kind = 'template'""",
        (reference['assetId'], flow_id, node['id']),
    ).fetchone()
    if row is None:
        raise KeyError(reference['assetId'])
    return dict(row)


def asset_is_referenced(connection, asset_id, asset_kind):
    """Call inside the delete transaction; retain references in every saved version."""
    configs = connection.execute(
        "SELECT draft_config AS config FROM flows UNION ALL SELECT config_snapshot FROM flow_versions"
    )
    for row in configs:
        for node in json.loads(row['config']).get('nodes', []):
            if (asset_kind, asset_id) in node_asset_references(node):
                return True
    # Download records are evidence too, even if no config currently uses the file.
    return asset_kind == 'template' and connection.execute(
        'SELECT 1 FROM template_download_events WHERE template_asset_id = ? LIMIT 1', (asset_id,)
    ).fetchone() is not None
