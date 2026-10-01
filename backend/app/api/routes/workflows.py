import hashlib
from io import BytesIO
from pathlib import PurePosixPath
from typing import Any

from app.repositories.node_copy import copy_node
from app.services.image_compression import compress_image_to_jpeg

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
    save_draft,
)
from app.repositories.workflow_groups import move_flow_to_group
from app.repositories.audit_policies import (
    AuditPolicyConflictError,
    get_node_audit_policy,
    update_node_audit_policy,
)
from app.repositories.review_step_policies import (
    ReviewStepPolicyConflict,
    get_review_step_policy,
    update_review_step_policy,
)
from app.repositories.answer_sheet_keys import validate_answer_sheet_key_map
from app.repositories.answer_sheet_policies import (
    AnswerSheetPolicyConflictError,
    get_node_answer_key_policy,
    update_node_answer_key_policy,
)
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
    get_teacher_material_asset,
    remove_template_asset,
    save_template_asset,
    validate_reference_metadata,
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
from app.repositories.flow_announcement_files import (
    ANNOUNCEMENT_FILE_TYPES,
    AnnouncementFileError,
    create_announcement_file,
    get_editable_announcement_node,
    get_teacher_announcement_file,
)
from app.services.announcement_file_validation import (
    InvalidAnnouncementFile,
    inspect_announcement_file,
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


class CreateFlowRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    groupId: str | None = None


class MoveFlowGroupRequest(BaseModel):
    groupId: str | None = None


class CopyNodeRequest(BaseModel):
    node: dict[str, Any]


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


class ReviewStepPolicyRequest(BaseModel):
    expectedGeneration: int = Field(ge=1)
    steps: list[dict[str, Any]]


class AuditPolicyRequest(BaseModel):
    modelCardId: str | None = Field(max_length=64)
    expectedGeneration: int = Field(ge=1)
    params: dict[str, str | int | float | bool]


class AnswerKeyPolicyRequest(BaseModel):
    expectedGeneration: int = Field(ge=1)
    gradingKey: dict[str, Any]


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
            payload.modelCardId,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="节点审核规则不存在") from exc
    except AuditPolicyConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/{flow_id}/nodes/{node_key}/answer-key-policy")
def get_answer_key_policy_route(
    flow_id: str,
    node_key: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return get_node_answer_key_policy(flow_id, node_key, int(teacher["id"]))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="已发布答题卡不存在") from exc


@router.get("/{flow_id}/nodes/{node_key}/review-step-policy")
def get_review_step_policy_route(
    flow_id: str,
    node_key: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return get_review_step_policy(flow_id, node_key, int(teacher['id']))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail='已发布审核步骤不存在') from exc


@router.put("/{flow_id}/nodes/{node_key}/review-step-policy")
def put_review_step_policy_route(
    flow_id: str,
    node_key: str,
    payload: ReviewStepPolicyRequest,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return update_review_step_policy(
            flow_id, node_key, int(teacher['id']), payload.expectedGeneration, payload.steps,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail='已发布审核步骤不存在') from exc
    except ReviewStepPolicyConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.put("/{flow_id}/nodes/{node_key}/answer-key-policy")
def put_answer_key_policy_route(
    flow_id: str,
    node_key: str,
    payload: AnswerKeyPolicyRequest,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return update_node_answer_key_policy(
            flow_id,
            node_key,
            int(teacher["id"]),
            payload.expectedGeneration,
            dict(payload.gradingKey),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="已发布答题卡不存在") from exc
    except AnswerSheetPolicyConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except AnswerSheetConfigError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/{flow_id}/nodes/{node_key}/materials/{asset_id}/download")
def download_node_material(flow_id: str, node_key: str, asset_id: str,
                           preview: bool = False, teacher=Depends(get_current_teacher)):
    import tempfile
    from pathlib import Path
    from fastapi.responses import FileResponse
    from starlette.background import BackgroundTask

    try:
        asset = get_teacher_material_asset(flow_id, node_key, asset_id, int(teacher["id"]))
    except KeyError as exc:
        raise HTTPException(404, "文件不存在或无权查看") from exc
    extension = Path(str(asset["original_name"])).suffix.lower()
    preview_types = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg",
                     ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
                     ".bmp": "image/bmp", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
    if preview and extension not in preview_types:
        raise HTTPException(415, "此格式请下载原件查看")
    with tempfile.NamedTemporaryFile(prefix="moyin-material-", delete=False) as temporary:
        path = Path(temporary.name)
    try:
        get_object_storage().download_to_file(str(asset["storage_key"]), path)
    except Exception as exc:
        path.unlink(missing_ok=True)
        raise HTTPException(502, "文件读取失败，请稍后重试") from exc
    return FileResponse(
        path, filename=None if preview else str(asset["original_name"]),
        media_type=preview_types[extension] if preview else "application/octet-stream",
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
        background=BackgroundTask(path.unlink, missing_ok=True),
    )


@router.post("/{flow_id}/nodes/{node_key}/template")
def upload_node_template(flow_id: str, node_key: str, file: UploadFile = File(...), teacher=Depends(get_current_teacher)):
    return _upload_node_asset(flow_id, node_key, file, teacher)


@router.post("/{flow_id}/nodes/{node_key}/reference")
def upload_node_reference(flow_id: str, node_key: str, file: UploadFile = File(...), replace_asset_id: str | None = None, teacher=Depends(get_current_teacher)):
    return _upload_node_asset(flow_id, node_key, file, teacher, reference=True, replace_asset_id=replace_asset_id)


@router.delete("/{flow_id}/nodes/{node_key}/template")
def delete_node_template(flow_id: str, node_key: str, teacher=Depends(get_current_teacher)):
    return _delete_node_asset(flow_id, node_key, teacher)


@router.delete("/{flow_id}/nodes/{node_key}/reference")
def delete_node_reference(flow_id: str, node_key: str, asset_id: str | None = None, teacher=Depends(get_current_teacher)):
    return _delete_node_asset(flow_id, node_key, teacher, reference=True, reference_id=asset_id)


def _validate_reference_content(file: UploadFile, filename: str) -> None:
    from zipfile import ZipFile, BadZipFile
    from PIL import Image, UnidentifiedImageError
    extension = PurePosixPath(filename).suffix.lower()
    try:
        if extension == '.docx':
            with ZipFile(file.file) as archive:
                if not {'[Content_Types].xml', 'word/document.xml'}.issubset(archive.namelist()):
                    raise ValueError('请选择有效的 DOCX 文件')
        elif extension == '.pdf':
            if not file.file.read(1024).lstrip().startswith(b'%PDF-'):
                raise ValueError('请选择有效的 PDF 文件')
        else:
            formats = {'.png': 'PNG', '.jpg': 'JPEG', '.jpeg': 'JPEG', '.webp': 'WEBP', '.gif': 'GIF', '.bmp': 'BMP', '.tif': 'TIFF', '.tiff': 'TIFF'}
            with Image.open(file.file) as image:
                if image.format != formats[extension]:
                    raise ValueError('图片格式与文件扩展名不一致')
                image.verify()
    except (BadZipFile, UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError) as exc:
        raise ValueError('参考文件内容无效，请选择 DOCX、PDF 或图片') from exc
    finally:
        file.file.seek(0)


def _upload_node_asset(
    flow_id: str,
    node_key: str,
    file: UploadFile = File(...),
    teacher: dict[str, object] = Depends(get_current_teacher),
    reference: bool = False,
    replace_asset_id: str | None = None,
) -> dict[str, object]:
    teacher_id = int(teacher["id"])
    try:
        node = get_editable_template_node(flow_id, node_key, teacher_id, reference)
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
    upload_stream = file.file
    content_type = file.content_type or "application/octet-stream"
    try:
        if reference:
            validate_reference_metadata(filename, size_bytes)
            _validate_reference_content(file, filename)
            if PurePosixPath(filename).suffix.lower() not in {".docx", ".pdf"}:
                compressed = compress_image_to_jpeg(file.file)
                upload_stream = BytesIO(compressed)
                filename = str(PurePosixPath(filename).with_suffix(".jpg"))
                content_type = "image/jpeg"
                size_bytes = len(compressed)
                digest = hashlib.sha256(compressed)
        elif node.get("kind") == "confirmation":
            if not filename.lower().endswith(".docx"):
                raise ValueError("确认承诺模板必须为 DOCX 文件")
        else:
            validate_file_metadata(node, filename, size_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    sha256 = digest.hexdigest()
    storage_key = object_key(
        settings.oss_prefix,
        "templates",
        flow_id,
        timestamped_object_name(filename, sha256),
    )
    try:
        storage = get_object_storage()
        uploaded = storage.put_object(storage_key, upload_stream, content_type)
        metadata, old_id, draft_hash = save_template_asset(
            flow_id=flow_id, node_key=node_key, teacher_id=teacher_id,
            storage_key=storage_key, original_name=filename, content_type=content_type,
            size_bytes=size_bytes, sha256=sha256, etag=uploaded.etag, reference=reference,
            replace_asset_id=replace_asset_id,
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
    return {"referenceAsset" if reference else "templateAsset": metadata, "draftConfigHash": draft_hash}


def _delete_node_asset(
    flow_id: str,
    node_key: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
    reference: bool = False,
    reference_id: str | None = None,
) -> dict[str, object]:
    try:
        asset = remove_template_asset(flow_id, node_key, int(teacher["id"]), reference, reference_id)
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
    return {"referenceAsset" if reference else "templateAsset": None}


@router.post("/{flow_id}/nodes/{node_key}/answer-sheet-assets")
def upload_answer_sheet_asset(
    flow_id: str,
    node_key: str,
    file: UploadFile = File(...),
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    return _upload_content_image(flow_id, node_key, file, teacher, "answer_sheet")


@router.post("/{flow_id}/nodes/{node_key}/announcement-assets")
def upload_announcement_asset(
    flow_id: str,
    node_key: str,
    file: UploadFile = File(...),
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    return _upload_content_image(flow_id, node_key, file, teacher, "announcement")


@router.post("/{flow_id}/nodes/{node_key}/announcement-files")
def upload_announcement_file(
    flow_id: str,
    node_key: str,
    file: UploadFile = File(...),
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    teacher_id = int(teacher["id"])
    try:
        get_editable_announcement_node(flow_id, node_key, teacher_id)
    except KeyError as exc:
        raise not_found() from exc
    except AnnouncementFileError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    filename = PurePosixPath(str(file.filename or "").replace("\\", "/")).name
    suffix = PurePosixPath(filename).suffix.lower()
    content_type = ANNOUNCEMENT_FILE_TYPES.get(suffix)
    if not filename or content_type is None:
        raise HTTPException(status_code=422, detail="附件仅支持 PDF、DOCX、XLSX 和 PPTX")
    if file.content_type not in (content_type, "application/octet-stream", None, ""):
        raise HTTPException(status_code=422, detail="附件扩展名与文件类型不一致")
    try:
        size_bytes, sha256 = inspect_announcement_file(file.file, suffix)
    except InvalidAnnouncementFile as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    storage_key = object_key(
        settings.oss_prefix,
        "announcement-files",
        flow_id,
        node_key,
        timestamped_object_name(filename, sha256),
    )
    try:
        storage = get_object_storage()
        uploaded = storage.put_object(storage_key, file.file, content_type)
        return create_announcement_file(
            flow_id=flow_id, node_key=node_key, teacher_id=teacher_id,
            storage_key=storage_key, original_name=filename, content_type=content_type,
            size_bytes=size_bytes, sha256=sha256, etag=uploaded.etag,
        )
    except ObjectStorageNotConfigured as exc:
        raise HTTPException(status_code=503, detail="附件存储服务未配置，请联系管理员") from exc
    except (AnnouncementFileError, KeyError) as exc:
        try:
            get_object_storage().delete_object(storage_key)
        except Exception:
            pass
        if isinstance(exc, KeyError):
            raise not_found() from exc
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        try:
            get_object_storage().delete_object(storage_key)
        except Exception:
            pass
        raise HTTPException(status_code=502, detail="附件上传失败，请稍后重试") from exc


@router.get("/{flow_id}/nodes/{node_key}/announcement-files/{asset_id}")
def get_announcement_file_metadata(
    flow_id: str,
    node_key: str,
    asset_id: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        asset = get_teacher_announcement_file(flow_id, node_key, asset_id, int(teacher["id"]))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="附件不存在") from exc
    return {
        "assetId": asset["id"], "originalName": asset["original_name"],
        "contentType": asset["content_type"], "sizeBytes": asset["size_bytes"],
    }


@router.get("/{flow_id}/nodes/{node_key}/announcement-files/{asset_id}/download")
def download_announcement_file(
    flow_id: str,
    node_key: str,
    asset_id: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        asset = get_teacher_announcement_file(flow_id, node_key, asset_id, int(teacher["id"]))
        url = get_object_storage().signed_download_url(
            str(asset["storage_key"]), str(asset["original_name"])
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="附件不存在") from exc
    except ObjectStorageNotConfigured as exc:
        raise HTTPException(status_code=503, detail="附件存储服务未配置，请联系管理员") from exc
    except ObjectStorageError as exc:
        raise HTTPException(status_code=502, detail="附件下载链接生成失败") from exc
    return {"url": url, "originalName": asset["original_name"]}


def _upload_content_image(
    flow_id: str,
    node_key: str,
    file: UploadFile,
    teacher: dict[str, object],
    kind: str,
) -> dict[str, object]:
    teacher_id = int(teacher["id"])
    try:
        get_editable_content_node(flow_id, node_key, teacher_id, kind)
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
        raise HTTPException(status_code=422, detail="图片仅支持 PNG、JPEG 和 WebP")
    if content_type != expected_content_type:
        raise HTTPException(status_code=422, detail="图片扩展名与文件类型不一致")
    digest = hashlib.sha256()
    size_bytes = 0
    file.file.seek(0)
    while chunk := file.file.read(1024 * 1024):
        size_bytes += len(chunk)
        digest.update(chunk)
    file.file.seek(0)
    if not 0 < size_bytes <= CONTENT_ASSET_LIMIT_BYTES:
        raise HTTPException(status_code=422, detail="图片大小不能超过 5 MB")
    from PIL import Image, UnidentifiedImageError
    try:
        with Image.open(file.file) as image:
            expected_format = "JPEG" if suffix in {".jpg", ".jpeg"} else expected_content_type.split("/")[1].upper()
            if image.format != expected_format:
                raise ValueError("图片内容与文件类型不一致")
            image.verify()
    except (ValueError, UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=422, detail="图片内容无效或与文件类型不一致") from exc
    finally:
        file.file.seek(0)
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
            kind=kind,
        )
    except ObjectStorageNotConfigured as exc:
        raise HTTPException(status_code=503, detail="图片存储服务未配置，请联系管理员") from exc
    except ContentAssetError as exc:
        try:
            get_object_storage().delete_object(storage_key)
        except Exception:
            pass
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except KeyError as exc:
        try:
            get_object_storage().delete_object(storage_key)
        except Exception:
            pass
        raise not_found() from exc
    except Exception as exc:
        try:
            get_object_storage().delete_object(storage_key)
        except Exception:
            pass
        raise HTTPException(status_code=502, detail="图片上传失败，请稍后重试") from exc


@router.delete("/{flow_id}/answer-sheet-assets/{asset_id}")
def delete_answer_sheet_asset(
    flow_id: str,
    asset_id: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, bool]:
    try:
        removed = delete_content_asset(flow_id, asset_id, int(teacher["id"]))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="图片不存在") from exc
    except ContentAssetError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    try:
        get_object_storage().delete_object(removed["storageKey"])
    except ObjectStorageError as exc:
        raise HTTPException(status_code=502, detail="图片记录已删除，但存储对象清理失败") from exc
    return {"deleted": True}


@router.get("/{flow_id}/content-assets/{asset_id}")
@router.get("/{flow_id}/answer-sheet-assets/{asset_id}")
def get_answer_sheet_asset(
    flow_id: str,
    asset_id: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        asset = get_teacher_content_asset(flow_id, asset_id, int(teacher["id"]))
        url = get_object_storage().signed_inline_url(str(asset["storage_key"]))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="图片不存在") from exc
    except ObjectStorageNotConfigured as exc:
        raise HTTPException(status_code=503, detail="图片存储服务未配置，请联系管理员") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="图片预览链接生成失败") from exc
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
        return create_flow(
            payload.name.strip(),
            payload.description.strip(),
            int(teacher["id"]),
            payload.groupId,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="流程分组不存在") from exc
    except DuplicateFlowNameError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{flow_id}/nodes/copy", status_code=201)
def post_node_copy(
    flow_id: str,
    payload: CopyNodeRequest,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return copy_node(flow_id, payload.node, int(teacher["id"]))
    except KeyError as exc:
        raise not_found() from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ObjectStorageError as exc:
        raise HTTPException(status_code=502, detail="节点文件复制失败，请重试") from exc


@router.put("/{flow_id}/group")
def put_flow_group(
    flow_id: str,
    payload: MoveFlowGroupRequest,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return move_flow_to_group(flow_id, payload.groupId, int(teacher["id"]))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="流程或目标分组不存在") from exc


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
    except (FlowValidationError, ContentAssetError, AnnouncementFileError) as exc:
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
        AnnouncementFileError,
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
