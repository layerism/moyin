import hashlib
import json
import uuid
from typing import Any

from app.domain.node_assets import reference_assets, asset_entries
from app.repositories.branch_state import node_is_ready
from app.core.database import get_connection
from app.domain.workflow_runtime import (
    node_by_key,
    pending_node_status,
    validate_file_metadata,
)
from app.repositories.flow_roster import assert_student_roster_access
from app.repositories.flow_runtime_state import effective_deadline, is_preview_instance
from app.services.security import utc_now_iso


class TemplateMutationError(ValueError):
    pass


class TemplateDownloadError(ValueError):
    pass


def supports_template(node: dict[str, Any], reference: bool = False) -> bool:
    return node.get("kind") in {"file", "confirmation"}


def _validate_template_name(node: dict[str, Any], original_name: str) -> None:
    if node.get("kind") == "confirmation" and not original_name.lower().endswith(".docx"):
        raise TemplateMutationError("确认承诺模板必须为 DOCX 文件")


def _canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _published_node_ids(connection: Any, flow_id: str) -> set[str]:
    result: set[str] = set()
    rows = connection.execute(
        "SELECT config_snapshot FROM flow_versions WHERE flow_id = ? AND status = 'published'", (flow_id,)
    ).fetchall()
    for row in rows:
        result.update(node["id"] for node in json.loads(row["config_snapshot"])["nodes"])
    return result


def _published_template_editable(
    connection: Any, flow_id: str, node_key: str, node: dict[str, Any], reference: bool
) -> bool:
    if node_key not in _published_node_ids(connection, flow_id):
        return True
    return node.get("kind") in {"file", "confirmation"}


def get_editable_template_node(flow_id: str, node_key: str, teacher_id: int, reference: bool = False) -> dict[str, Any]:
    with get_connection() as connection:
        flow = connection.execute(
            "SELECT draft_config FROM flows WHERE id = ? AND owner_id = ? AND status != 'archived'",
            (flow_id, str(teacher_id)),
        ).fetchone()
        if flow is None:
            raise KeyError(flow_id)
        config = json.loads(flow["draft_config"])
        node = node_by_key(config, node_key)
        if not supports_template(node, reference):
            raise TemplateMutationError("当前节点不支持模板")
        if not _published_template_editable(connection, flow_id, node_key, node, reference):
            raise TemplateMutationError("已发布节点的模板不可修改")
        return dict(node)


def save_template_asset(
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
    reference: bool = False,
    replace_asset_id: str | None = None,
) -> tuple[dict[str, object], str | None, str]:
    asset_id = str(uuid.uuid4())
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        flow = connection.execute(
            "SELECT draft_config FROM flows WHERE id = ? AND owner_id = ? AND status != 'archived'",
            (flow_id, str(teacher_id)),
        ).fetchone()
        if flow is None:
            raise KeyError(flow_id)
        config = json.loads(flow["draft_config"])
        node = node_by_key(config, node_key)
        if not supports_template(node, reference) or not _published_template_editable(
            connection, flow_id, node_key, node, reference
        ):
            raise TemplateMutationError("已发布节点的模板不可修改")
        if replace_asset_id and not reference:
            raise TemplateMutationError("只有填写参考支持指定替换")
        if reference:
            validate_reference_metadata(original_name, size_bytes)
        else:
            _validate_template_name(node, original_name)
        references = reference_assets(node) if reference else []
        if replace_asset_id and not any(item["assetId"] == replace_asset_id for item in references):
            raise TemplateMutationError("待替换的参考文件不存在")
        old_id = replace_asset_id if reference else (node.get("templateAsset") or {}).get("assetId")
        connection.execute(
            """
            INSERT INTO flow_template_assets
                (id, flow_id, node_key, storage_key, original_name, content_type,
                 size_bytes, sha256, etag, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (asset_id, flow_id, node_key, storage_key, original_name, content_type,
             size_bytes, sha256, etag, teacher_id, now),
        )
        metadata = {
            "assetId": asset_id,
            "contentType": content_type,
            "originalName": original_name,
            "sha256": sha256,
            "sizeBytes": size_bytes,
        }
        if reference:
            node["referenceAssets"] = [
                metadata if item["assetId"] == replace_asset_id else item for item in references
            ] if replace_asset_id else [*references, metadata]
            node.pop("referenceAsset", None)
        else:
            node["templateAsset"] = metadata
        serialized = _canonical_json(config)
        connection.execute(
            "UPDATE flows SET draft_config = ?, updated_at = ? WHERE id = ?",
            (serialized, now, flow_id),
        )
        connection.execute(
            """
            INSERT INTO audit_logs
                (actor_id, action, entity_type, entity_id, before_data, after_data, created_at)
            VALUES (?, 'template_replace', 'flow_node', ?, ?, ?, ?)
            """,
            (str(teacher_id), f"{flow_id}:{node_key}",
             _canonical_json({"assetId": old_id}) if old_id else None,
             _canonical_json(metadata), now),
        )
    return metadata, str(old_id) if old_id else None, hashlib.sha256(serialized.encode()).hexdigest()


def remove_template_asset(flow_id: str, node_key: str, teacher_id: int, reference: bool = False, reference_id: str | None = None) -> dict[str, object] | None:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        flow = connection.execute(
            "SELECT draft_config FROM flows WHERE id = ? AND owner_id = ? AND status != 'archived'",
            (flow_id, str(teacher_id)),
        ).fetchone()
        if flow is None:
            raise KeyError(flow_id)
        config = json.loads(flow["draft_config"])
        node = node_by_key(config, node_key)
        if not supports_template(node, reference) or (
            node_key in _published_node_ids(connection, flow_id) and node.get("kind") not in {"file", "confirmation"}
        ):
            raise TemplateMutationError("已发布节点的模板不可修改")
        references = reference_assets(node) if reference else []
        if reference:
            if reference_id is None and len(references) > 1:
                raise TemplateMutationError("请选择要移除的参考文件")
            selected = next((item for item in references if reference_id is None or item["assetId"] == reference_id), None)
            asset_id = selected["assetId"] if selected else None
            if reference_id and asset_id is None:
                raise KeyError(reference_id)
        else:
            asset_id = (node.get("templateAsset") or {}).get("assetId")
        if not asset_id:
            return None
        asset = connection.execute(
            "SELECT id, storage_key FROM flow_template_assets WHERE id = ? AND flow_id = ? AND node_key = ?",
            (asset_id, flow_id, node_key),
        ).fetchone()
        if asset is None:
            raise KeyError(asset_id)
        if reference:
            node["referenceAssets"] = [item for item in references if item["assetId"] != asset_id]
            node.pop("referenceAsset", None)
        else:
            node["templateAsset"] = None
        connection.execute(
            "UPDATE flows SET draft_config = ?, updated_at = ? WHERE id = ?",
            (_canonical_json(config), now, flow_id),
        )
        connection.execute(
            """
            INSERT INTO audit_logs
                (actor_id, action, entity_type, entity_id, before_data, created_at)
            VALUES (?, 'template_delete', 'flow_node', ?, ?, ?)
            """,
            (str(teacher_id), f"{flow_id}:{node_key}", _canonical_json({"assetId": asset_id}), now),
        )
        return dict(asset)


def delete_unreferenced_asset(asset_id: str) -> dict[str, object] | None:
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        referenced = connection.execute(
            "SELECT 1 FROM flow_version_templates WHERE template_asset_id = ? LIMIT 1", (asset_id,)
        ).fetchone()
        reference = connection.execute(
            "SELECT 1 FROM flow_versions v, json_each(v.config_snapshot, '$.nodes') n WHERE json_extract(n.value, '$.referenceAsset.assetId') = ? OR EXISTS (SELECT 1 FROM json_each(n.value, '$.referenceAssets') a WHERE json_extract(a.value, '$.assetId') = ?) LIMIT 1", (asset_id, asset_id),
        ).fetchone()
        draft_reference = connection.execute(
            """SELECT 1 FROM flows f, json_each(f.draft_config, '$.nodes') n
               WHERE json_extract(n.value, '$.referenceAsset.assetId') = ?
                  OR json_extract(n.value, '$.templateAsset.assetId') = ? OR EXISTS (SELECT 1 FROM json_each(n.value, '$.referenceAssets') a WHERE json_extract(a.value, '$.assetId') = ?) LIMIT 1""", (asset_id, asset_id, asset_id),
        ).fetchone()
        if referenced is not None or reference is not None or draft_reference is not None:
            return None
        row = connection.execute(
            "SELECT id, storage_key FROM flow_template_assets WHERE id = ?", (asset_id,)
        ).fetchone()
        if row is not None:
            connection.execute("DELETE FROM flow_template_assets WHERE id = ?", (asset_id,))
        return dict(row) if row else None


def validate_version_templates(connection: Any, flow_id: str, config: dict[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    for node in config["nodes"]:
        for field, template in asset_entries(node):
            if not template:
                continue
            row = connection.execute(
                """
                SELECT id, flow_id, node_key, original_name, content_type, size_bytes, sha256
                FROM flow_template_assets WHERE id = ?
                """,
                (template.get("assetId"),),
            ).fetchone()
            if row is None or row["flow_id"] != flow_id or row["node_key"] != node["id"]:
                raise TemplateMutationError("模板资产不存在或不属于当前节点")
            expected = {
                "assetId": row["id"], "contentType": row["content_type"],
                "originalName": row["original_name"], "sha256": row["sha256"],
                "sizeBytes": row["size_bytes"],
            }
            if template != expected:
                raise TemplateMutationError("模板资产元数据已变更，请重新加载")
            if field == "referenceAsset":
                if node.get("kind") not in {"file", "confirmation"}:
                    raise TemplateMutationError("只有文件或视觉审核节点可以配置参考材料")
                validate_reference_metadata(row["original_name"], row["size_bytes"])
            elif node.get("kind") == "confirmation":
                _validate_template_name(node, row["original_name"])
            else:
                try:
                    validate_file_metadata(node, row["original_name"], row["size_bytes"])
                except ValueError as exc:
                    raise TemplateMutationError(str(exc)) from exc
            if field == "templateAsset":
                result[node["id"]] = row["id"]
    return result


def get_version_template_original_name(
    connection: Any, flow_version_id: str, node_key: str
) -> str | None:
    row = connection.execute(
        """
        SELECT a.original_name
        FROM flow_version_templates t
        JOIN flow_template_assets a ON a.id = t.template_asset_id
        WHERE t.flow_version_id = ? AND t.node_key = ?
        """,
        (flow_version_id, node_key),
    ).fetchone()
    return str(row["original_name"]) if row else None


def get_student_template(node_instance_id: str, student_id: int) -> dict[str, object]:
    with get_connection() as connection:
        connection.execute("BEGIN")
        row = connection.execute(
            """
            SELECT n.id, n.node_key, n.flow_instance_id, n.status,
                   i.flow_version_id, i.student_account_id, v.flow_id, v.config_snapshot,
                   a.id AS asset_id, a.storage_key, a.original_name, a.content_type, a.size_bytes
            FROM node_instances n
            JOIN flow_instances i ON i.id = n.flow_instance_id
            JOIN flow_versions v ON v.id = i.flow_version_id
              AND v.status IN ('published', 'preview')
            JOIN flow_version_templates t
              ON t.flow_version_id = v.id AND t.node_key = n.node_key
            JOIN flow_template_assets a ON a.id = t.template_asset_id
            WHERE n.id = ? AND i.student_account_id = ?
            """,
            (node_instance_id, student_id),
        ).fetchone()
        if row is None:
            raise KeyError(node_instance_id)
        assert_student_roster_access(connection, row["flow_id"], student_id)
        config = json.loads(row["config_snapshot"])
        node = node_by_key(config, row["node_key"])
        state = pending_node_status(
            node_is_ready(connection, row["flow_instance_id"], config, row["node_key"]),
            None if is_preview_instance(connection, row["flow_instance_id"]) else node.get("startAt"),
            effective_deadline(connection, row["flow_instance_id"], row["flow_version_id"], row["node_key"]),
        )
        if state != "available" or row["status"] not in {
            "available", "draft", "rejected", "scheduled", "locked", "expired"
        }:
            raise TemplateDownloadError("当前节点尚未开放或已截止")
        return dict(row)


def record_template_download(node_instance_id: str, template_asset_id: str, student_id: int) -> None:
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO template_download_events
                (node_instance_id, template_asset_id, student_account_id, downloaded_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(node_instance_id, template_asset_id)
            DO UPDATE SET downloaded_at = excluded.downloaded_at
            """,
            (node_instance_id, template_asset_id, student_id, utc_now_iso()),
        )


def template_downloaded(
    connection: Any, node_instance_id: str, template_asset_id: str, student_id: int
) -> bool:
    return connection.execute(
        """
        SELECT 1 FROM template_download_events
        WHERE node_instance_id = ? AND template_asset_id = ? AND student_account_id = ?
        """,
        (node_instance_id, template_asset_id, student_id),
    ).fetchone() is not None


REFERENCE_EXTENSIONS = {'.docx', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff'}


def validate_reference_metadata(filename: str, size_bytes: int) -> None:
    from pathlib import PurePosixPath
    if PurePosixPath(filename).suffix.lower() not in REFERENCE_EXTENSIONS:
        raise TemplateMutationError('填写参考仅支持 DOCX、PDF 和图片（PNG/JPEG/WEBP/GIF/BMP/TIFF）')
    if size_bytes <= 0 or size_bytes > 50 * 1024 * 1024:
        raise TemplateMutationError('填写参考须为非空文件，且不超过 50 MB')


def get_student_reference(node_instance_id: str, student_id: int, asset_id: str | None = None) -> dict[str, object]:
    with get_connection() as connection:
        row = connection.execute("""SELECT n.node_key, v.flow_id, v.config_snapshot
            FROM node_instances n JOIN flow_instances i ON i.id = n.flow_instance_id
            JOIN flow_versions v ON v.id = i.flow_version_id
            WHERE n.id = ? AND i.student_account_id = ? AND v.status IN ('published', 'preview')""",
            (node_instance_id, student_id)).fetchone()
        if row is None:
            raise KeyError(node_instance_id)
        assert_student_roster_access(connection, row['flow_id'], student_id)
        node = node_by_key(json.loads(row['config_snapshot']), row['node_key'])
        asset = next((item for item in reference_assets(node) if asset_id is None or item['assetId'] == asset_id), None)
        if node.get('kind') not in {'file', 'confirmation'} or not asset:
            raise KeyError(node_instance_id)
        record = connection.execute('SELECT * FROM flow_template_assets WHERE id = ? AND flow_id = ? AND node_key = ?',
            (asset['assetId'], row['flow_id'], row['node_key'])).fetchone()
        if record is None:
            raise KeyError(node_instance_id)
        return dict(record)


def get_teacher_material_asset(flow_id: str, node_key: str, asset_id: str, teacher_id: int) -> dict[str, object]:
    with get_connection() as connection:
        row = connection.execute(
            """SELECT a.* FROM flow_template_assets a
               JOIN flows f ON f.id = a.flow_id
               WHERE a.id = ? AND a.flow_id = ? AND a.node_key = ?
                 AND f.owner_id = ? AND f.status != 'archived'""",
            (asset_id, flow_id, node_key, str(teacher_id)),
        ).fetchone()
        if row is None:
            raise KeyError(asset_id)
        return dict(row)
