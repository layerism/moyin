import hashlib
from pathlib import PurePosixPath
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.core.config import settings
from app.domain.form_fields import FormAnswerValidationError
from app.domain.workflow_runtime import validate_file_metadata, validate_template_filename
from app.repositories.flow_files import (
    FileContextError,
    add_pending_scan,
    delete_pending_scan,
    get_upload_context,
    get_uploaded_file_for_download,
    list_pending_scans,
    reorder_pending_scans,
    replace_uploaded_file,
)
from app.repositories.audit_jobs import AuditJobConflictError, retry_audit_job
from app.repositories.flow_instances import (
    RuntimeConflictError,
    RuntimeDeadlineError,
    enter_flow,
    get_instance,
    get_or_create_instance,
    list_student_flows,
    list_student_instances,
    save_node_draft,
    submit_node,
)
from app.repositories.flow_roster import RosterAccessError
from app.repositories.flow_templates import (
    TemplateDownloadError,
    get_student_template,
    record_template_download,
)
from app.services.object_storage import (
    ObjectStorageNotConfigured,
    get_object_storage,
    object_key,
    timestamped_object_name,
)
from app.services.security import get_current_student
from app.services.scan_materials import ScanMaterialError, inspect_scan_material

router = APIRouter()


class DraftRequest(BaseModel):
    payload: dict[str, Any]


class SubmitRequest(BaseModel):
    payload: dict[str, Any]
    idempotencyKey: str = Field(min_length=1, max_length=100)


class ScanOrderRequest(BaseModel):
    fileIds: list[str] = Field(min_length=1, max_length=10)


def runtime_error(exc: Exception) -> HTTPException:
    if isinstance(exc, FormAnswerValidationError):
        return HTTPException(
            status_code=422,
            detail={
                "message": "表单内容未通过校验",
                "fieldErrors": exc.field_errors,
            },
        )
    if isinstance(exc, RosterAccessError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, KeyError):
        return HTTPException(status_code=404, detail="流程实例或节点不存在")
    if isinstance(exc, RuntimeDeadlineError):
        return HTTPException(status_code=422, detail=str(exc))
    return HTTPException(status_code=409, detail=str(exc))


@router.post("/node-instances/{node_instance_id}/template/download")
def download_node_template(
    node_instance_id: str,
    student: dict[str, object] = Depends(get_current_student),
) -> dict[str, object]:
    try:
        record = get_student_template(node_instance_id, int(student["id"]))
        url = get_object_storage().signed_download_url(
            str(record["storage_key"]), str(record["original_name"])
        )
        record_template_download(node_instance_id, str(record["asset_id"]), int(student["id"]))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="当前节点未配置模板") from exc
    except (RosterAccessError, TemplateDownloadError) as exc:
        raise runtime_error(exc) from exc
    except ObjectStorageNotConfigured as exc:
        raise HTTPException(status_code=503, detail="模板存储服务未配置，请联系管理员") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="模板下载链接生成失败") from exc
    return {
        "url": url,
        "originalName": record["original_name"],
        "sizeBytes": record["size_bytes"],
    }


@router.post("/node-instances/{node_instance_id}/file")
def upload_node_file(
    node_instance_id: str,
    file: UploadFile = File(...),
    student: dict[str, object] = Depends(get_current_student),
) -> dict[str, object]:
    student_id = int(student["id"])
    try:
        context = get_upload_context(node_instance_id, student_id)
    except (KeyError, RosterAccessError, FileContextError) as exc:
        raise runtime_error(exc) from exc

    filename = PurePosixPath(str(file.filename or "").replace("\\", "/")).name
    if not filename:
        raise HTTPException(status_code=422, detail="请选择文件后再上传")
    authoritative_filename = filename
    if context.template_original_name:
        try:
            authoritative_filename = validate_template_filename(
                filename, context.template_original_name
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    digest = hashlib.sha256()
    size_bytes = 0
    file.file.seek(0)
    while chunk := file.file.read(1024 * 1024):
        size_bytes += len(chunk)
        digest.update(chunk)
    file.file.seek(0)
    try:
        validate_file_metadata(context.config_node, authoritative_filename, size_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    content_type = file.content_type or "application/octet-stream"
    sha256 = digest.hexdigest()
    storage_key = object_key(
        settings.oss_prefix,
        "submissions",
        context.flow_id,
        context.flow_instance_id,
        timestamped_object_name(authoritative_filename, sha256),
    )
    try:
        uploaded = get_object_storage().put_object(storage_key, file.file, content_type)
    except ObjectStorageNotConfigured as exc:
        raise HTTPException(status_code=503, detail="OSS 未配置，请联系管理员") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="OSS 上传失败，请稍后重试") from exc

    try:
        record, old_keys = replace_uploaded_file(
            node_instance_id=node_instance_id,
            student_id=student_id,
            storage_key=storage_key,
            original_name=authoritative_filename,
            content_type=content_type,
            size_bytes=size_bytes,
            sha256=sha256,
            etag=uploaded.etag,
        )
    except Exception as exc:
        try:
            get_object_storage().delete_object(storage_key)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="文件元数据保存失败") from exc

    for old_key in old_keys:
        try:
            get_object_storage().delete_object(old_key)
        except Exception:
            pass
    return record


@router.post("/node-instances/{node_instance_id}/scans")
def upload_node_scan(
    node_instance_id: str,
    file: UploadFile = File(...),
    student: dict[str, object] = Depends(get_current_student),
) -> dict[str, object]:
    student_id = int(student["id"])
    try:
        context = get_upload_context(node_instance_id, student_id)
        if context.upload_mode != "scan_set":
            raise FileContextError("当前节点不支持扫描件")
    except (KeyError, RosterAccessError, FileContextError) as exc:
        raise runtime_error(exc) from exc
    filename = PurePosixPath(str(file.filename or "").replace("\\", "/")).name
    if not filename:
        raise HTTPException(status_code=422, detail="请选择扫描件")
    digest = hashlib.sha256()
    size_bytes = 0
    file.file.seek(0)
    while chunk := file.file.read(1024 * 1024):
        size_bytes += len(chunk)
        digest.update(chunk)
    file.file.seek(0)
    try:
        inspection = inspect_scan_material(file.file, filename, size_bytes)
    except ScanMaterialError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    sha256 = digest.hexdigest()
    storage_key = object_key(
        settings.oss_prefix, "submissions", context.flow_id, context.flow_instance_id,
        timestamped_object_name(filename, sha256),
    )
    try:
        storage = get_object_storage()
        uploaded = storage.put_object(storage_key, file.file, inspection.content_type)
        return add_pending_scan(
            node_instance_id, student_id, storage_key, filename, inspection.content_type,
            size_bytes, sha256, uploaded.etag, inspection.page_count,
        )
    except FileContextError as exc:
        try:
            get_object_storage().delete_object(storage_key)
        except Exception:
            pass
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ObjectStorageNotConfigured as exc:
        raise HTTPException(status_code=503, detail="OSS 未配置，请联系管理员") from exc
    except Exception as exc:
        try:
            get_object_storage().delete_object(storage_key)
        except Exception:
            pass
        raise HTTPException(status_code=502, detail="扫描件上传失败，请稍后重试") from exc


@router.get("/node-instances/{node_instance_id}/scans")
def get_node_scans(
    node_instance_id: str,
    student: dict[str, object] = Depends(get_current_student),
) -> list[dict[str, object]]:
    try:
        get_upload_context(node_instance_id, int(student["id"]))
        return list_pending_scans(node_instance_id, int(student["id"]))
    except (KeyError, RosterAccessError, FileContextError) as exc:
        raise runtime_error(exc) from exc


@router.delete("/node-instances/{node_instance_id}/scans/{file_id}")
def remove_node_scan(
    node_instance_id: str,
    file_id: str,
    student: dict[str, object] = Depends(get_current_student),
) -> dict[str, bool]:
    try:
        get_upload_context(node_instance_id, int(student["id"]))
        storage_key = delete_pending_scan(node_instance_id, int(student["id"]), file_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="扫描件不存在") from exc
    except (RosterAccessError, FileContextError) as exc:
        raise runtime_error(exc) from exc
    try:
        get_object_storage().delete_object(storage_key)
    except Exception:
        pass
    return {"deleted": True}


@router.put("/node-instances/{node_instance_id}/scans/order")
def put_node_scan_order(
    node_instance_id: str,
    payload: ScanOrderRequest,
    student: dict[str, object] = Depends(get_current_student),
) -> list[dict[str, object]]:
    try:
        get_upload_context(node_instance_id, int(student["id"]))
        return reorder_pending_scans(node_instance_id, int(student["id"]), payload.fileIds)
    except (KeyError, RosterAccessError, FileContextError) as exc:
        raise runtime_error(exc) from exc


@router.get("/files/{file_id}/download")
def download_node_file(
    file_id: str,
    student: dict[str, object] = Depends(get_current_student),
) -> dict[str, object]:
    try:
        record = get_uploaded_file_for_download(file_id, int(student["id"]))
        url = get_object_storage().signed_download_url(
            str(record["storage_key"]), str(record["original_name"])
        )
    except (KeyError, RosterAccessError) as exc:
        raise runtime_error(exc) from exc
    except ObjectStorageNotConfigured as exc:
        raise HTTPException(status_code=503, detail="OSS 未配置，请联系管理员") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="OSS 下载链接生成失败") from exc
    return {
        "fileId": record["id"],
        "originalName": record["original_name"],
        "contentType": record["content_type"],
        "sizeBytes": record["size_bytes"],
        "url": url,
    }


@router.post("/shared/{token}/enter")
def enter_shared_flow(
    token: str, student: dict[str, object] = Depends(get_current_student)
) -> dict[str, object]:
    try:
        return get_or_create_instance(token, int(student["id"]))
    except RosterAccessError as exc:
        raise runtime_error(exc) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="分享链接无效或已停用") from exc


@router.get("/flows")
def student_flows(
    student: dict[str, object] = Depends(get_current_student),
) -> list[dict[str, object]]:
    return list_student_flows(int(student["id"]))


@router.post("/flows/{flow_id}/enter")
def enter_student_flow(
    flow_id: str,
    student: dict[str, object] = Depends(get_current_student),
) -> dict[str, object]:
    try:
        return enter_flow(flow_id, int(student["id"]))
    except RosterAccessError as exc:
        raise runtime_error(exc) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="流程不存在或尚未发布") from exc


@router.get("/flow-instances")
def flow_instances(
    student: dict[str, object] = Depends(get_current_student),
) -> list[dict[str, object]]:
    return list_student_instances(int(student["id"]))


@router.get("/flow-instances/{instance_id}")
def flow_instance(
    instance_id: str, student: dict[str, object] = Depends(get_current_student)
) -> dict[str, object]:
    try:
        return get_instance(instance_id, int(student["id"]))
    except (KeyError, RosterAccessError) as exc:
        raise runtime_error(exc) from exc


@router.put("/node-instances/{node_instance_id}/draft")
def put_draft(
    node_instance_id: str,
    payload: DraftRequest,
    student: dict[str, object] = Depends(get_current_student),
) -> dict[str, object]:
    try:
        return save_node_draft(node_instance_id, int(student["id"]), payload.payload)
    except (KeyError, RosterAccessError, RuntimeConflictError) as exc:
        raise runtime_error(exc) from exc


@router.post("/node-instances/{node_instance_id}/submit")
def post_submit(
    node_instance_id: str,
    payload: SubmitRequest,
    student: dict[str, object] = Depends(get_current_student),
) -> dict[str, object]:
    try:
        return submit_node(
            node_instance_id,
            int(student["id"]),
            payload.payload,
            payload.idempotencyKey,
        )
    except (
        KeyError,
        RosterAccessError,
        FormAnswerValidationError,
        RuntimeConflictError,
        RuntimeDeadlineError,
    ) as exc:
        raise runtime_error(exc) from exc


@router.post("/node-instances/{node_instance_id}/audit/retry")
def post_audit_retry(
    node_instance_id: str,
    student: dict[str, object] = Depends(get_current_student),
) -> dict[str, object]:
    student_id = int(student["id"])
    try:
        instance_id = retry_audit_job(node_instance_id, student_id)
        return get_instance(instance_id, student_id)
    except (KeyError, RosterAccessError, AuditJobConflictError) as exc:
        raise runtime_error(exc) from exc
