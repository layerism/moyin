import hashlib
import uuid
from pathlib import PurePosixPath
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field

from app.domain.workflow import FlowValidationError, validate_flow_config
from app.domain.workflow_revision import (
    PublishedEdgeDeletionError,
    PublishedEdgeMutationError,
    PublishedNodeDeletionError,
    PublishedNodeMutationError,
)
from app.repositories.workflows import (
    ArchivedFlowError,
    DraftRevisionConflictError,
    DuplicateFlowNameError,
    create_flow,
    delete_flow,
    get_flow,
    get_revision_impact,
    list_flows,
    publish_flow,
    resolve_share_token,
    save_draft,
)
from app.core.config import settings
from app.domain.workflow_runtime import validate_file_metadata
from app.repositories.flow_templates import (
    TemplateMutationError,
    delete_unreferenced_asset,
    get_editable_template_node,
    remove_template_asset,
    save_template_asset,
)
from app.services.object_storage import (
    ObjectStorageNotConfigured,
    get_object_storage,
    object_key,
)
from app.services.security import get_current_teacher

router = APIRouter(dependencies=[Depends(get_current_teacher)])
shared_router = APIRouter()


class CreateFlowRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)


class FlowConfigRequest(BaseModel):
    config: dict[str, Any]


class PublishFlowRequest(BaseModel):
    config: dict[str, Any] | None = None
    expectedDraftConfigHash: str | None = None
    expectedCurrentVersionId: str | None = None


def not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="流程不存在")


@router.post("/{flow_id}/nodes/{node_key}/template")
def upload_node_template(
    flow_id: str,
    node_key: str,
    file: UploadFile = File(...),
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    teacher_id = int(teacher["id"])
    try:
        node = get_editable_template_node(flow_id, node_key, teacher_id)
    except KeyError as exc:
        raise not_found() from exc
    except TemplateMutationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    filename = PurePosixPath(str(file.filename or "").replace("\\", "/")).name
    if not filename:
        raise HTTPException(status_code=422, detail="请选择模板文件")
    digest = hashlib.sha256()
    size_bytes = 0
    file.file.seek(0)
    while chunk := file.file.read(1024 * 1024):
        size_bytes += len(chunk)
        digest.update(chunk)
    file.file.seek(0)
    try:
        validate_file_metadata(node, filename, size_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    content_type = file.content_type or "application/octet-stream"
    storage_key = object_key(settings.oss_prefix, "templates", flow_id, node_key, str(uuid.uuid4()), filename)
    try:
        storage = get_object_storage()
        uploaded = storage.put_object(storage_key, file.file, content_type)
        metadata, old_id, draft_hash = save_template_asset(
            flow_id=flow_id, node_key=node_key, teacher_id=teacher_id,
            storage_key=storage_key, original_name=filename, content_type=content_type,
            size_bytes=size_bytes, sha256=digest.hexdigest(), etag=uploaded.etag,
        )
    except ObjectStorageNotConfigured as exc:
        raise HTTPException(status_code=503, detail="模板存储服务未配置，请联系管理员") from exc
    except TemplateMutationError as exc:
        try:
            get_object_storage().delete_object(storage_key)
        except Exception:
            pass
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        try:
            get_object_storage().delete_object(storage_key)
        except Exception:
            pass
        raise HTTPException(status_code=502, detail="模板上传失败，请稍后重试") from exc
    if old_id:
        old = delete_unreferenced_asset(old_id)
        if old:
            try:
                storage.delete_object(str(old["storage_key"]))
            except Exception:
                pass
    return {"templateAsset": metadata, "draftConfigHash": draft_hash}


@router.delete("/{flow_id}/nodes/{node_key}/template")
def delete_node_template(
    flow_id: str,
    node_key: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        asset = remove_template_asset(flow_id, node_key, int(teacher["id"]))
    except KeyError as exc:
        raise not_found() from exc
    except TemplateMutationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if asset:
        removed = delete_unreferenced_asset(str(asset["id"]))
        if removed:
            try:
                get_object_storage().delete_object(str(removed["storage_key"]))
            except Exception:
                pass
    return {"templateAsset": None}


@router.get("")
def get_flows(
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> list[dict[str, object]]:
    return list_flows(int(teacher["id"]))


@router.post("", status_code=status.HTTP_201_CREATED)
def post_flow(
    payload: CreateFlowRequest,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return create_flow(payload.name.strip(), payload.description.strip(), int(teacher["id"]))
    except DuplicateFlowNameError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/{flow_id}")
def get_flow_route(
    flow_id: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return get_flow(flow_id, int(teacher["id"]))
    except KeyError as exc:
        raise not_found() from exc


@router.post("/validate")
def validate(payload: FlowConfigRequest) -> dict[str, bool]:
    try:
        validate_flow_config(payload.config)
    except FlowValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"valid": True}


@router.put("/{flow_id}/draft")
def put_draft(
    flow_id: str,
    payload: FlowConfigRequest,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return save_draft(flow_id, payload.config, int(teacher["id"]))
    except KeyError as exc:
        raise not_found() from exc
    except ArchivedFlowError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FlowValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (PublishedNodeDeletionError, PublishedEdgeDeletionError,
            PublishedNodeMutationError, PublishedEdgeMutationError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except TemplateMutationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{flow_id}/revision-impact")
def revision_impact(
    flow_id: str,
    payload: FlowConfigRequest | None = None,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return get_revision_impact(
            flow_id,
            int(teacher["id"]),
            payload.config if payload else None,
        )
    except KeyError as exc:
        raise not_found() from exc
    except FlowValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (PublishedNodeDeletionError, PublishedEdgeDeletionError,
            PublishedNodeMutationError, PublishedEdgeMutationError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except TemplateMutationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{flow_id}/publish", status_code=status.HTTP_201_CREATED)
def publish(
    flow_id: str,
    payload: PublishFlowRequest | None = None,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return publish_flow(
            flow_id,
            int(teacher["id"]),
            payload.expectedDraftConfigHash if payload else None,
            payload.expectedCurrentVersionId if payload else None,
            payload.config if payload else None,
        )
    except KeyError as exc:
        raise not_found() from exc
    except FlowValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ArchivedFlowError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (PublishedNodeDeletionError, PublishedEdgeDeletionError,
            PublishedNodeMutationError, PublishedEdgeMutationError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except DraftRevisionConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except TemplateMutationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/{flow_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workflow(
    flow_id: str, teacher: dict[str, object] = Depends(get_current_teacher)
) -> Response:
    try:
        delete_flow(flow_id, int(teacher["id"]))
    except KeyError as exc:
        raise not_found() from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@shared_router.get("/{token}")
def get_shared_flow(token: str) -> dict[str, object]:
    try:
        shared = resolve_share_token(token)
        return {"name": shared["name"], "description": shared["description"]}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="分享链接无效或已停用") from exc
