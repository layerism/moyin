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
from app.repositories.flow_assets import insert_asset
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
                "SELECT 1 FROM flows WHERE id = ? AND owner_id = ? AND kind = 'normal' AND status != 'archived'",
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
                row = db.execute("SELECT * FROM flow_assets WHERE id = ? AND asset_kind = 'template'", (metadata["assetId"],)).fetchone()
                assets.append(("template", metadata, dict(row)))
            for asset_id in references.get(node["id"], set()):
                row = db.execute("SELECT * FROM flow_assets WHERE id = ? AND asset_kind = 'content'", (asset_id,)).fetchone()
                assets.append(("content", None, dict(row)))
            for asset_id in announcement_files.get(node["id"], set()):
                row = db.execute("SELECT * FROM flow_assets WHERE id = ? AND asset_kind = 'announcement'", (asset_id,)).fetchone()
                assets.append(("announcement", None, dict(row)))
            node["id"] = str(uuid.uuid4())
            node["status"] = "disabled"
            for branch in node.get("branches", []):
                branch["id"] = str(uuid.uuid4())
            for field in node.get("infoFields", []):
                if isinstance(field, dict) and "id" in field:
                    field["id"] = str(uuid.uuid4())
            review_ids = {}
            for step in node.get("fileReviewSteps", []):
                if isinstance(step, dict):
                    old_id = step["id"]
                    step["id"] = str(uuid.uuid4())
                    review_ids[old_id] = step["id"]
            history = node.get("fileReviewConfigHistory")
            if history is not None:
                copied_history = {}
                for old_id, item in history.items():
                    new_id = review_ids.get(old_id) or str(uuid.uuid4())
                    item["step"]["id"] = new_id
                    copied_history[new_id] = item
                node["fileReviewConfigHistory"] = copied_history
            storage = get_object_storage() if assets else None
            for asset_kind, metadata, asset in assets:
                new_id = str(uuid.uuid4())
                key = object_key(settings.oss_prefix, "node-copies", flow_id, node["id"], new_id, asset["original_name"])
                uploaded = storage.copy_object(asset["storage_key"], key)
                copied_keys.append(key)
                insert_asset(
                    db, asset_kind, id=new_id, flow_id=flow_id, node_key=node['id'],
                    storage_key=key, original_name=asset['original_name'], content_type=asset['content_type'],
                    size_bytes=asset['size_bytes'], sha256=asset['sha256'], etag=uploaded.etag,
                    created_by=teacher_id, created_at=utc_now_iso(),
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
