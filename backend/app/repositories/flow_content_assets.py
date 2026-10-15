import uuid
from typing import Any

from app.repositories.flow_assets import asset_is_referenced, insert_asset
from app.domain.node_assets import ContentAssetError, referenced_content_asset_ids
from app.core.database import get_connection
from app.domain.workflow_runtime import node_by_key
from app.repositories.flow_roster import assert_student_roster_access
from app.services.security import utc_now_iso


CONTENT_ASSET_TYPES = {"image/jpeg", "image/png", "image/webp"}
CONTENT_ASSET_LIMIT_BYTES = 5 * 1024 * 1024


def get_editable_content_node(
    flow_id: str, node_key: str, teacher_id: int, kind: str = "answer_sheet"
) -> dict[str, Any]:
    with get_connection() as connection:
        flow = connection.execute(
            """
            SELECT draft_config FROM flows
            WHERE id = ? AND owner_id = ? AND kind = 'normal' AND status != 'archived'
            """,
            (flow_id, str(teacher_id)),
        ).fetchone()
        if flow is None:
            raise KeyError(flow_id)
        import json

        node = node_by_key(json.loads(flow["draft_config"]), node_key)
        if node.get("kind") != kind:
            raise ContentAssetError("当前节点不支持图片上传")
        if kind == "announcement":
            return dict(node)
        historical = connection.execute(
            """
            SELECT config_snapshot FROM flow_versions
            WHERE flow_id = ? AND status = 'published'
            """,
            (flow_id,),
        ).fetchall()
        for version in historical:
            if any(
                item.get("id") == node_key
                for item in json.loads(version["config_snapshot"]).get("nodes", [])
            ):
                raise ContentAssetError("已发布答题卡节点不可新增或替换题图")
        return dict(node)


def validate_content_assets(
    connection: Any, flow_id: str, config: dict[str, Any]
) -> dict[str, set[str]]:
    result: dict[str, set[str]] = {}
    for node in config.get("nodes", []):
        references = referenced_content_asset_ids(node)
        if not references:
            continue
        placeholders = ",".join("?" for _ in references)
        rows = connection.execute(
            f"""
            SELECT id FROM flow_assets
            WHERE asset_kind = 'content' AND flow_id = ? AND node_key = ? AND id IN ({placeholders})
            """,
            (flow_id, node["id"], *sorted(references)),
        ).fetchall()
        if {str(row["id"]) for row in rows} != references:
            raise ContentAssetError("节点包含不存在或不属于当前节点的图片")
        result[str(node["id"])] = references
    return result


def save_content_asset(
    connection: Any,
    *,
    flow_id: str,
    node_key: str,
    teacher_id: int,
    storage_key: str,
    original_name: str,
    content_type: str,
    size_bytes: int,
    sha256: str,
    etag: str,
    kind: str = "answer_sheet",
) -> dict[str, object]:
    if content_type not in CONTENT_ASSET_TYPES:
        raise ContentAssetError("图片仅支持 PNG、JPEG 和 WebP")
    if not 0 < size_bytes <= CONTENT_ASSET_LIMIT_BYTES:
        raise ContentAssetError("图片大小不能超过 5 MB")
    flow = connection.execute(
        """
        SELECT draft_config FROM flows
        WHERE id = ? AND owner_id = ? AND kind = 'normal' AND status != 'archived'
        """,
        (flow_id, str(teacher_id)),
    ).fetchone()
    if flow is None:
        raise KeyError(flow_id)
    import json

    node = node_by_key(json.loads(flow["draft_config"]), node_key)
    if node.get("kind") != kind:
        raise ContentAssetError("当前节点不支持图片上传")
    version_rows = connection.execute(
        """
        SELECT config_snapshot FROM flow_versions
        WHERE flow_id = ? AND status = 'published'
        """,
        (flow_id,),
    ).fetchall()
    published_node_ids = {
        str(published_node["id"])
        for version in version_rows
        for published_node in json.loads(version["config_snapshot"]).get("nodes", [])
    }
    if kind == "answer_sheet" and node_key in published_node_ids:
        raise ContentAssetError("已发布答题卡节点不可新增或替换题图")
    asset_id = str(uuid.uuid4())
    now = utc_now_iso()
    insert_asset(connection, 'content',
        id=asset_id, flow_id=flow_id, node_key=node_key,
        storage_key=storage_key, original_name=original_name, content_type=content_type,
        size_bytes=size_bytes, sha256=sha256, etag=etag,
        created_by=teacher_id, created_at=now,
    )
    return {
        "assetId": asset_id,
        "originalName": original_name,
        "contentType": content_type,
        "sizeBytes": size_bytes,
        "sha256": sha256,
    }


def create_content_asset(**values: Any) -> dict[str, object]:
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        return save_content_asset(connection, **values)


def remove_content_asset(
    connection: Any, flow_id: str, asset_id: str, teacher_id: int
) -> dict[str, str]:
    row = connection.execute(
        """
        SELECT a.storage_key FROM flow_assets a
        JOIN flows f ON f.id = a.flow_id
        WHERE a.asset_kind = 'content' AND a.id = ? AND a.flow_id = ? AND f.owner_id = ? AND f.kind = 'normal' AND f.status != 'archived'
        """,
        (asset_id, flow_id, str(teacher_id)),
    ).fetchone()
    if row is None:
        raise KeyError(asset_id)
    if asset_is_referenced(connection, asset_id, 'content'):
        raise ContentAssetError("流程配置或版本仍引用的图片不可删除")
    connection.execute("DELETE FROM flow_assets WHERE asset_kind = 'content' AND id = ?", (asset_id,))
    return {"storageKey": str(row["storage_key"])}


def delete_content_asset(
    flow_id: str, asset_id: str, teacher_id: int
) -> dict[str, str]:
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        return remove_content_asset(connection, flow_id, asset_id, teacher_id)


def get_student_content_asset(
    instance_id: str, asset_id: str, student_id: int
) -> dict[str, object]:
    with get_connection() as connection:
        connection.execute("BEGIN")
        instance = connection.execute(
            """
            SELECT i.flow_version_id, v.flow_id
            FROM flow_instances i
            JOIN flow_versions v ON v.id = i.flow_version_id
            WHERE i.id = ? AND i.student_account_id = ?
              AND v.status IN ('published', 'preview')
            """,
            (instance_id, student_id),
        ).fetchone()
        if instance is None:
            raise KeyError(asset_id)
        assert_student_roster_access(connection, str(instance["flow_id"]), student_id)
        from app.repositories.flow_runtime_state import version_config
        config = version_config(connection, str(instance['flow_version_id']))
        node_keys = [node['id'] for node in config['nodes']
                     if asset_id in referenced_content_asset_ids(node)]
        if not node_keys:
            raise KeyError(asset_id)
        placeholders = ','.join('?' for _ in node_keys)
        row = connection.execute(
            f"""SELECT id, storage_key, original_name, content_type, size_bytes
            FROM flow_assets WHERE asset_kind = 'content' AND flow_id = ? AND id = ?
            AND node_key IN ({placeholders})""",
            (instance['flow_id'], asset_id, *node_keys),
        ).fetchone()
        if row is None:
            raise KeyError(asset_id)
        return dict(row)


def get_teacher_content_asset(
    flow_id: str, asset_id: str, teacher_id: int
) -> dict[str, object]:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT a.id, a.storage_key, a.original_name, a.content_type, a.size_bytes
            FROM flow_assets a
            JOIN flows f ON f.id = a.flow_id
            WHERE a.asset_kind = 'content' AND a.flow_id = ? AND a.id = ? AND f.owner_id = ?
              AND f.status != 'archived'
            """,
            (flow_id, asset_id, str(teacher_id)),
        ).fetchone()
        if row is None:
            raise KeyError(asset_id)
        return dict(row)
