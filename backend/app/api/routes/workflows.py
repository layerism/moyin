import hashlib
from pathlib import PurePosixPath
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field

from app.domain.workflow import FlowValidationError, validate_flow_config
from app.domain.answer_sheet import AnswerSheetConfigError
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
    clone_flow,
    create_flow,
    delete_flow,
    get_flow,
    get_revision_impact,
    list_flows,
    publish_flow,
    rename_flow,
    resolve_share_token,
    save_draft,
)
from app.repositories.audit_policies import (
    AuditPolicyConflictError,
    get_node_audit_policy,
    update_node_audit_policy,
)
from app.repositories.answer_sheet_keys import validate_answer_sheet_key_map
from app.repositories.flow_previews import (
    PreviewConflictError,
    create_preview,
    delete_marked_preview,
    list_expired_preview_teacher_ids,
    mark_preview_for_cleanup,
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
from app.repositories.flow_content_assets import (
    CONTENT_ASSET_LIMIT_BYTES,
    CONTENT_ASSET_TYPES,
    ContentAssetError,
    create_content_asset,
    delete_content_asset,
    get_editable_content_node,
    get_teacher_content_asset,
)
from app.services.object_storage import (
    ObjectStorageError,
    ObjectStorageNotConfigured,
    get_object_storage,
    object_key,
    timestamped_object_name,
)
from app.services.security import get_current_teacher

router = APIRouter(dependencies=[Depends(get_current_teacher)])
shared_router = APIRouter()


class CreateFlowRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)


class CloneFlowRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class RenameFlowRequest(BaseModel):
    name: str


class FlowConfigRequest(BaseModel):
    answerSheetKeys: dict[str, dict[str, Any]] = Field(default_factory=dict)
    config: dict[str, Any]


class PublishFlowRequest(BaseModel):
    answerSheetKeys: dict[str, dict[str, Any]] | None = None
    config: dict[str, Any] | None = None
    expectedDraftConfigHash: str | None = None
    expectedCurrentVersionId: str | None = None


class AuditPolicyRequest(BaseModel):
    expectedGeneration: int = Field(ge=1)
    params: dict[str, str | int | float | bool]


def not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="流程不存在")


@router.get("/{flow_id}/nodes/{node_key}/audit-policy")
def get_audit_policy_route(
    flow_id: str,
    node_key: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return get_node_audit_policy(flow_id, node_key, int(teacher["id"]))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="节点审核规则不存在") from exc


@router.put("/{flow_id}/nodes/{node_key}/audit-policy")
def put_audit_policy_route(
    flow_id: str,
    node_key: str,
    payload: AuditPolicyRequest,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return update_node_audit_policy(
            flow_id,
            node_key,
            int(teacher["id"]),
            payload.expectedGeneration,
            dict(payload.params),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="节点审核规则不存在") from exc
    except AuditPolicyConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


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
        if node.get("kind") == "confirmation":
            if not filename.lower().endswith(".docx"):
                raise ValueError("确认承诺模板必须为 DOCX 文件")
        else:
            validate_file_metadata(node, filename, size_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    content_type = file.content_type or "application/octet-stream"
    sha256 = digest.hexdigest()
    storage_key = object_key(
        settings.oss_prefix,
        "templates",
        flow_id,
        timestamped_object_name(filename, sha256),
    )
    try:
        storage = get_object_storage()
        uploaded = storage.put_object(storage_key, file.file, content_type)
        metadata, old_id, draft_hash = save_template_asset(
            flow_id=flow_id, node_key=node_key, teacher_id=teacher_id,
            storage_key=storage_key, original_name=filename, content_type=content_type,
            size_bytes=size_bytes, sha256=sha256, etag=uploaded.etag,
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


@router.post("/{flow_id}/nodes/{node_key}/answer-sheet-assets")
def upload_answer_sheet_asset(
    flow_id: str,
    node_key: str,
    file: UploadFile = File(...),
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    teacher_id = int(teacher["id"])
    try:
        get_editable_content_node(flow_id, node_key, teacher_id)
    except KeyError as exc:
        raise not_found() from exc
    except ContentAssetError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    filename = PurePosixPath(str(file.filename or "").replace("\\", "/")).name
    suffix = PurePosixPath(filename).suffix.lower()
    expected_content_type = {
        ".jpeg": "image/jpeg",
        ".jpg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }.get(suffix)
    content_type = file.content_type or ""
    if not filename or expected_content_type is None or content_type not in CONTENT_ASSET_TYPES:
        raise HTTPException(status_code=422, detail="题图仅支持 PNG、JPEG 和 WebP")
    if content_type != expected_content_type:
        raise HTTPException(status_code=422, detail="题图扩展名与文件类型不一致")
    digest = hashlib.sha256()
    size_bytes = 0
    file.file.seek(0)
    while chunk := file.file.read(1024 * 1024):
        size_bytes += len(chunk)
        digest.update(chunk)
    file.file.seek(0)
    if not 0 < size_bytes <= CONTENT_ASSET_LIMIT_BYTES:
        raise HTTPException(status_code=422, detail="题图大小不能超过 5 MB")
    sha256 = digest.hexdigest()
    storage_key = object_key(
        settings.oss_prefix,
        "content-assets",
        flow_id,
        node_key,
        timestamped_object_name(filename, sha256),
    )
    try:
        storage = get_object_storage()
        uploaded = storage.put_object(storage_key, file.file, content_type)
        return create_content_asset(
            flow_id=flow_id,
            node_key=node_key,
            teacher_id=teacher_id,
            storage_key=storage_key,
            original_name=filename,
            content_type=content_type,
            size_bytes=size_bytes,
            sha256=sha256,
            etag=uploaded.etag,
        )
    except ObjectStorageNotConfigured as exc:
        raise HTTPException(status_code=503, detail="题图存储服务未配置，请联系管理员") from exc
    except ContentAssetError as exc:
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
        raise HTTPException(status_code=502, detail="题图上传失败，请稍后重试") from exc


@router.delete("/{flow_id}/answer-sheet-assets/{asset_id}")
def delete_answer_sheet_asset(
    flow_id: str,
    asset_id: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, bool]:
    try:
        removed = delete_content_asset(flow_id, asset_id, int(teacher["id"]))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="题图不存在") from exc
    except ContentAssetError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    try:
        get_object_storage().delete_object(removed["storageKey"])
    except ObjectStorageError as exc:
        raise HTTPException(status_code=502, detail="题图记录已删除，但存储对象清理失败") from exc
    return {"deleted": True}


@router.get("/{flow_id}/answer-sheet-assets/{asset_id}")
def get_answer_sheet_asset(
    flow_id: str,
    asset_id: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        asset = get_teacher_content_asset(flow_id, asset_id, int(teacher["id"]))
        url = get_object_storage().signed_inline_url(
            str(asset["storage_key"]), str(asset["content_type"])
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="题图不存在") from exc
    except ObjectStorageNotConfigured as exc:
        raise HTTPException(status_code=503, detail="题图存储服务未配置，请联系管理员") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="题图预览链接生成失败") from exc
    return {
        "assetId": asset["id"],
        "contentType": asset["content_type"],
        "originalName": asset["original_name"],
        "sizeBytes": asset["size_bytes"],
        "url": url,
    }


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


@router.post("/{flow_id}/clone", status_code=status.HTTP_201_CREATED)
def post_flow_clone(
    flow_id: str,
    payload: CloneFlowRequest,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return clone_flow(flow_id, payload.name, int(teacher["id"]))
    except KeyError as exc:
        raise not_found() from exc
    except DuplicateFlowNameError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FlowValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ObjectStorageError as exc:
        raise HTTPException(status_code=502, detail="模板复制失败，请稍后重试") from exc


@router.patch("/{flow_id}/name")
def patch_flow_name(
    flow_id: str,
    payload: RenameFlowRequest,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return rename_flow(flow_id, payload.name, int(teacher["id"]))
    except KeyError as exc:
        raise not_found() from exc
    except DuplicateFlowNameError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FlowValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/{flow_id}")
def get_flow_route(
    flow_id: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return get_flow(flow_id, int(teacher["id"]))
    except KeyError as exc:
        raise not_found() from exc


def _cleanup_teacher_preview(teacher_id: int) -> None:
    storage_keys = mark_preview_for_cleanup(teacher_id)
    if storage_keys:
        try:
            storage = get_object_storage()
            for storage_key in storage_keys:
                storage.delete_object(storage_key)
        except Exception as exc:
            raise ObjectStorageError("旧预览文件清理失败，请重试") from exc
    delete_marked_preview(teacher_id)


@router.post("/{flow_id}/preview")
def post_flow_preview(
    flow_id: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    teacher_id = int(teacher["id"])
    for expired_teacher_id in list_expired_preview_teacher_ids():
        if expired_teacher_id == teacher_id:
            continue
        try:
            _cleanup_teacher_preview(expired_teacher_id)
        except ObjectStorageError:
            pass
    try:
        _cleanup_teacher_preview(teacher_id)
        instance, preview_token = create_preview(flow_id, teacher_id)
    except KeyError as exc:
        raise not_found() from exc
    except (
        AnswerSheetConfigError,
        ContentAssetError,
        FlowValidationError,
        TemplateMutationError,
    ) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except PreviewConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ObjectStorageError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    instance_id = str(instance["id"])
    return {
        "instanceId": instance_id,
        "previewToken": preview_token,
        "previewUrl": f"/student/flows/{instance_id}?preview=1",
    }


@router.post("/validate")
def validate(payload: FlowConfigRequest) -> dict[str, bool]:
    try:
        validate_flow_config(payload.config, require_publishable=True)
        validate_answer_sheet_key_map(
            payload.config, payload.answerSheetKeys, require_publishable=True
        )
    except (AnswerSheetConfigError, FlowValidationError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"valid": True}


@router.put("/{flow_id}/draft")
def put_draft(
    flow_id: str,
    payload: FlowConfigRequest,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return save_draft(
            flow_id,
            payload.config,
            int(teacher["id"]),
            payload.answerSheetKeys,
        )
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
            payload.answerSheetKeys if payload else None,
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
            payload.answerSheetKeys if payload else None,
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
        _cleanup_teacher_preview(int(teacher["id"]))
        delete_flow(flow_id, int(teacher["id"]))
    except KeyError as exc:
        raise not_found() from exc
    except ObjectStorageError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@shared_router.get("/{token}")
def get_shared_flow(token: str) -> dict[str, object]:
    try:
        shared = resolve_share_token(token)
        return {"name": shared["name"], "description": shared["description"]}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="分享链接无效或已停用") from exc
