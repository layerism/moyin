from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.background import BackgroundTask

from app.repositories.audit_jobs import (
    AuditJobConflictError,
    ManualApprovalValidationError,
    manual_approve_audit_job,
)
from app.repositories.flow_instances import (
    StudentDeadlineValidationError,
    get_teacher_submission_detail,
    get_version_progress,
    set_student_deadline,
)
from app.repositories.teacher_materials import (
    TeacherMaterialSelectionError,
    get_node_instance_materials,
    get_version_materials,
)
from app.repositories.teacher_node_exports import (
    TeacherNodeExportError,
    get_node_submission_export,
)
from app.services.audit_job_worker import signal_audit_job_cancellations
from app.services.audit_script_catalog import (
    AuditScriptCatalogError,
    AuditScriptConfigConflictError,
    AuditScriptWriteError,
    get_audit_script_config,
    list_audit_scripts,
    list_manageable_audit_scripts,
    update_audit_script_config,
)
from app.services.audit_script_parameters import AuditScriptParameterError
from app.services.material_archive import (
    MaterialArchiveEmptyError,
    build_material_archive,
    build_node_submission_archive,
    cleanup_material_archive,
)
from app.services.node_submission_workbook import build_node_submission_workbook
from app.services.object_storage import (
    ObjectStorageError,
    ObjectStorageNotConfigured,
    get_object_storage,
)
from app.services.security import get_current_super_admin, get_current_teacher

router = APIRouter(dependencies=[Depends(get_current_teacher)])


class DeadlineRequest(BaseModel):
    deadlineAt: str
    reason: str = Field(min_length=1, max_length=500)


class ManualApprovalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    submissionId: str = Field(min_length=1)
    reason: str = Field(min_length=1, max_length=500)


class AuditScriptConfigRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expectedEditorHash: str = Field(min_length=64, max_length=64)
    parameterDefaults: dict[str, str | int | float | bool]
    runtimeSettings: dict[str, str | int | float | bool]
    maxConcurrency: int = Field(ge=1, le=32)


@router.get("/audit-scripts")
def get_audit_scripts() -> list[dict[str, object]]:
    return list_audit_scripts()


@router.get("/audit-scripts/manage")
def get_manageable_audit_scripts(
    _teacher: dict[str, object] = Depends(get_current_super_admin),
) -> list[dict[str, object]]:
    return list_manageable_audit_scripts()


@router.get("/audit-scripts/{script_id}")
def get_managed_audit_script_config(
    script_id: str,
    _teacher: dict[str, object] = Depends(get_current_super_admin),
) -> dict[str, object]:
    try:
        return get_audit_script_config(script_id)
    except AuditScriptCatalogError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/audit-scripts/{script_id}")
def put_managed_audit_script_config(
    script_id: str,
    payload: AuditScriptConfigRequest,
    teacher: dict[str, object] = Depends(get_current_super_admin),
) -> dict[str, object]:
    try:
        return update_audit_script_config(
            script_id,
            expected_editor_hash=payload.expectedEditorHash,
            parameter_defaults=dict(payload.parameterDefaults),
            runtime_settings=dict(payload.runtimeSettings),
            max_concurrency=payload.maxConcurrency,
            actor_id=int(teacher["id"]),
        )
    except AuditScriptConfigConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except AuditScriptParameterError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except AuditScriptWriteError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except AuditScriptCatalogError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


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
    except ObjectStorageError as exc:
        raise HTTPException(status_code=503, detail="材料下载链接生成失败") from exc


@router.get("/versions/{version_id}/materials/download")
def download_version_materials(
    version_id: str,
    node_key: str | None = Query(default=None, alias="nodeKey"),
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> FileResponse:
    try:
        selection = get_version_materials(version_id, int(teacher["id"]), node_key)
        archive = build_material_archive(selection)
        return FileResponse(
            archive.path,
            filename=archive.filename,
            media_type="application/zip",
            background=BackgroundTask(cleanup_material_archive, archive),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="流程版本不存在") from exc
    except (TeacherMaterialSelectionError, MaterialArchiveEmptyError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ObjectStorageNotConfigured as exc:
        raise HTTPException(status_code=503, detail="文件存储服务未配置") from exc
    except ObjectStorageError as exc:
        raise HTTPException(status_code=503, detail="材料下载失败") from exc


@router.get("/versions/{version_id}/nodes/{node_key}/submissions/export")
def export_node_submissions(
    version_id: str,
    node_key: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> Response:
    try:
        selection = get_node_submission_export(
            version_id,
            node_key,
            int(teacher["id"]),
        )
        content, filename = build_node_submission_workbook(selection)
        encoded_filename = quote(filename, safe="")
        return Response(
            content=content,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": (
                    "attachment; filename=\"node-submissions.xlsx\"; "
                    f"filename*=UTF-8''{encoded_filename}"
                )
            },
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="流程版本不存在") from exc
    except TeacherNodeExportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/versions/{version_id}/nodes/{node_key}/package/download")
def download_node_submission_package(
    version_id: str,
    node_key: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> FileResponse:
    try:
        teacher_id = int(teacher["id"])
        selection = get_node_submission_export(version_id, node_key, teacher_id)
        archive = build_node_submission_archive(selection)
        return FileResponse(
            archive.path,
            filename=archive.filename,
            media_type="application/zip",
            background=BackgroundTask(cleanup_material_archive, archive),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="流程版本不存在") from exc
    except TeacherNodeExportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ObjectStorageNotConfigured as exc:
        raise HTTPException(status_code=503, detail="文件存储服务未配置") from exc
    except ObjectStorageError as exc:
        raise HTTPException(status_code=503, detail="节点资料包生成失败") from exc


@router.get("/node-instances/{node_instance_id}/materials/download")
def download_node_instance_materials(
    node_instance_id: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> FileResponse:
    try:
        selection = get_node_instance_materials(node_instance_id, int(teacher["id"]))
        archive = build_material_archive(selection)
        return FileResponse(
            archive.path,
            filename=archive.filename,
            media_type="application/zip",
            background=BackgroundTask(cleanup_material_archive, archive),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="学生节点不存在") from exc
    except (TeacherMaterialSelectionError, MaterialArchiveEmptyError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ObjectStorageNotConfigured as exc:
        raise HTTPException(status_code=503, detail="文件存储服务未配置") from exc
    except ObjectStorageError as exc:
        raise HTTPException(status_code=503, detail="材料下载失败") from exc


@router.post("/node-instances/{node_instance_id}/manual-approve")
def manual_approve_submission(
    node_instance_id: str,
    payload: ManualApprovalRequest,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, str]:
    try:
        running_job_ids = manual_approve_audit_job(
            node_instance_id,
            payload.submissionId,
            int(teacher["id"]),
            payload.reason,
        )
        signal_audit_job_cancellations(running_job_ids)
        return {"status": "approved"}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="学生节点不存在") from exc
    except AuditJobConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ManualApprovalValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
