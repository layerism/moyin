"""Shared persistence for teacher resources; node-specific validation stays with callers."""


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


def bind_version_asset(connection, version_id, node_key, asset_id, asset_kind):
    connection.execute(
        """INSERT INTO flow_version_assets (flow_version_id, node_key, asset_id, asset_kind)
           VALUES (?, ?, ?, ?)""", (version_id, node_key, asset_id, asset_kind),
    )
