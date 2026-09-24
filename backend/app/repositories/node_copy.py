"""Prepare an independent node and assets; the editor saves its draft normally."""
import copy
import logging
import uuid

from app.domain.node_assets import asset_entries
from app.core.config import settings
from app.core.database import get_connection
from app.domain.workflow import validate_flow_config
from app.repositories.flow_content_assets import validate_content_assets
from app.repositories.flow_announcement_files import validate_announcement_files
from app.repositories.flow_templates import validate_version_templates
from app.services.node_models import validate_flow_models
from app.services.object_storage import get_object_storage, object_key
from app.services.security import utc_now_iso

logger = logging.getLogger(__name__)


def copy_node(flow_id: str, source: dict, teacher_id: int) -> dict:
    node = copy.deepcopy(source)
    config = {"nodes": [node], "edges": []}
    copied_keys = []
    storage = None
    try:
        with get_connection() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute(
                "SELECT 1 FROM flows WHERE id = ? AND owner_id = ? AND status != 'archived'",
                (flow_id, str(teacher_id)),
            ).fetchone() is None:
                raise KeyError(flow_id)
            validate_flow_config(config)
            validate_version_templates(db, flow_id, config)
            references = validate_content_assets(db, flow_id, config)
            announcement_files = validate_announcement_files(db, flow_id, config)
            validate_flow_models(db, flow_id, config)
            assets = []
            for _, metadata in asset_entries(node):
                row = db.execute("SELECT * FROM flow_template_assets WHERE id = ?", (metadata["assetId"],)).fetchone()
                assets.append(("flow_template_assets", metadata, dict(row)))
            for asset_id in references.get(node["id"], set()):
                row = db.execute("SELECT * FROM flow_content_assets WHERE id = ?", (asset_id,)).fetchone()
                assets.append(("flow_content_assets", None, dict(row)))
            for asset_id in announcement_files.get(node["id"], set()):
                row = db.execute("SELECT * FROM flow_announcement_files WHERE id = ?", (asset_id,)).fetchone()
                assets.append(("flow_announcement_files", None, dict(row)))
            node["id"] = str(uuid.uuid4())
            node["status"] = "disabled"
            for branch in node.get("branches", []):
                branch["id"] = str(uuid.uuid4())
            for field in node.get("infoFields", []):
                if isinstance(field, dict) and "id" in field:
                    field["id"] = str(uuid.uuid4())
            for step in node.get("fileReviewSteps", []):
                if isinstance(step, dict):
                    step["id"] = str(uuid.uuid4())
            storage = get_object_storage() if assets else None
            for table, metadata, asset in assets:
                new_id = str(uuid.uuid4())
                key = object_key(settings.oss_prefix, "node-copies", flow_id, node["id"], new_id, asset["original_name"])
                uploaded = storage.copy_object(asset["storage_key"], key)
                copied_keys.append(key)
                db.execute(
                    f"""INSERT INTO {table}
                    (id, flow_id, node_key, storage_key, original_name, content_type,
                     size_bytes, sha256, etag, created_by, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (new_id, flow_id, node["id"], key, asset["original_name"], asset["content_type"],
                     asset["size_bytes"], asset["sha256"], uploaded.etag, teacher_id, utc_now_iso()),
                )
                if metadata is not None:
                    metadata["assetId"] = new_id
                else:
                    if node.get("kind") == "announcement":
                        node["requirement"] = str(node.get("requirement") or "").replace(
                            f"asset://{asset['id']}", f"asset://{new_id}"
                        )
                    for question in node.get("answerSheet", {}).get("questions", []):
                        for item in [question, *question.get("options", [])]:
                            item["content"] = str(item.get("content") or "").replace(f"asset://{asset['id']}", f"asset://{new_id}")
        return node
    except Exception:
        if storage:
            for key in reversed(copied_keys):
                try:
                    storage.delete_object(key)
                except Exception:
                    logger.exception("清理节点副本文件失败")
        raise
