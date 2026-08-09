from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.repositories.flow_instances import (
    StudentDeadlineValidationError,
    get_teacher_submission_detail,
    get_version_progress,
    set_student_deadline,
)
from app.services.audit_script_catalog import (
    AuditScriptCatalogError,
    AuditScriptNameConflictError,
    AuditScriptNotFoundError,
    AuditScriptWriteError,
    list_audit_scripts,
    update_audit_script_metadata,
)
from app.services.security import get_current_super_admin, get_current_teacher
from app.services.object_storage import ObjectStorageNotConfigured, get_object_storage

router = APIRouter(dependencies=[Depends(get_current_teacher)])


class DeadlineRequest(BaseModel):
    deadlineAt: str
    reason: str = Field(min_length=1, max_length=500)


class AuditScriptMetadataRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=500)


@router.get("/audit-scripts")
def get_audit_scripts() -> list[dict[str, object]]:
    return list_audit_scripts()


@router.patch("/audit-scripts/{script_id}/metadata")
def patch_audit_script_metadata(
    script_id: str,
    payload: AuditScriptMetadataRequest,
    _teacher: dict[str, object] = Depends(get_current_super_admin),
) -> dict[str, object]:
    try:
        return update_audit_script_metadata(script_id, payload.name, payload.description)
    except AuditScriptNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AuditScriptNameConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except AuditScriptWriteError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except AuditScriptCatalogError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.put("/instances/{instance_id}/nodes/{node_key}/deadline")
def put_student_deadline(
    instance_id: str,
    node_key: str,
    payload: DeadlineRequest,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return set_student_deadline(
            instance_id,
            node_key,
            payload.deadlineAt,
            payload.reason,
            int(teacher["id"]),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="学生流程实例不存在") from exc
    except StudentDeadlineValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/versions/{version_id}/progress")
def version_progress(
    version_id: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return get_version_progress(version_id, int(teacher["id"]))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="流程版本不存在") from exc


@router.get("/node-instances/{node_instance_id}/submission-detail")
def submission_detail(
    node_instance_id: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        detail = get_teacher_submission_detail(node_instance_id, int(teacher["id"]))
        scans = detail.pop("scans")
        detail["scans"] = [
            {
                "fileId": scan["id"],
                "originalName": scan["original_name"],
                "contentType": scan["content_type"],
                "sizeBytes": scan["size_bytes"],
                "pageCount": scan["page_count"],
                "url": get_object_storage().signed_download_url(
                    str(scan["storage_key"]), str(scan["original_name"])
                ),
            }
            for scan in scans
        ]
        return detail
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="提交记录不存在") from exc
    except ObjectStorageNotConfigured as exc:
        raise HTTPException(status_code=503, detail="文件存储服务未配置") from exc
