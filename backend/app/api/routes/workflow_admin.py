from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.background import BackgroundTask

from app.domain.workflow import confirmation_requires_scans
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
    get_teacher_material_library_file,
    get_node_instance_materials,
    get_version_materials,
    list_teacher_material_library,
)
from app.repositories.teacher_node_exports import (
    TeacherNodeExportConflictError,
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


class NodePackageDownloadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    includeWorkbook: bool = True
    includeFiles: bool = True
    studentScope: Literal["all", "selected"] = "all"
    rosterEntryIds: list[int] = Field(default_factory=list)


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


@router.get("/material-library")
def material_library(
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    flows = list_teacher_material_library(int(teacher["id"]))
    return {
        "flows": [
            {
                "flowId": flow.flow_id,
                "versionId": flow.version_id,
                "name": flow.name,
                "nodes": [
                    {
                        "nodeKey": node.node_key,
                        "title": node.title,
                        "students": [
                            {
                                "rosterEntryId": student.roster_entry_id,
                                "studentNo": student.student_no,
                                "name": student.name,
                                "files": [
                                    {
                                        "fileId": file.file_id,
                                        "originalName": file.original_name,
                                        "contentType": file.content_type,
                                        "sizeBytes": file.size_bytes,
                                        "createdAt": file.created_at,
                                        "submittedAt": file.submitted_at,
                                        "submissionStatus": file.submission_status,
                                    }
                                    for file in student.files
                                ],
                            }
                            for student in node.students
                        ],
                    }
                    for node in flow.nodes
                ],
            }
            for flow in flows
        ]
    }


@router.get("/material-library/files/{file_id}/download")
def download_material_library_file(
    file_id: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        record = get_teacher_material_library_file(file_id, int(teacher["id"]))
        return {
            "fileId": record.file_id,
            "originalName": record.original_name,
            "url": get_object_storage().signed_download_url(
                record.storage_key,
                record.original_name,
            ),
        }
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="文件不存在或已失效") from exc
    except ObjectStorageNotConfigured as exc:
        raise HTTPException(status_code=503, detail="文件存储服务未配置") from exc
    except ObjectStorageError as exc:
        raise HTTPException(status_code=503, detail="文件下载链接生成失败") from exc


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


@router.get("/versions/{version_id}/nodes/{node_key}/package/options")
def get_node_submission_package_options(
    version_id: str,
    node_key: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        selection = get_node_submission_export(version_id, node_key, int(teacher["id"]))
        kind = selection.node.get("kind")
        supports_files = kind == "file" or (
            kind == "confirmation" and confirmation_requires_scans(selection.node)
        )
        return {
            "flowName": selection.flow_name,
            "nodeKey": node_key,
            "nodeTitle": str(selection.node.get("title") or node_key),
            "supportsFiles": supports_files,
            "students": [
                {
                    "rosterEntryId": student.roster_entry_id,
                    "studentNo": student.student_no,
                    "name": student.name,
                    "status": student.submission_status or "unsubmitted",
                    "submittedAt": student.submitted_at,
                    "fileCount": len(student.files),
                    "fileSizeBytes": sum(file.size_bytes for file in student.files),
                }
                for student in selection.students
            ],
        }
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="流程版本不存在") from exc
    except TeacherNodeExportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/versions/{version_id}/nodes/{node_key}/package/download")
def download_filtered_node_submission_package(
    version_id: str,
    node_key: str,
    payload: NodePackageDownloadRequest,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> Response:
    if not payload.includeWorkbook and not payload.includeFiles:
        raise HTTPException(status_code=422, detail="请至少选择一种下载内容")
    if payload.studentScope == "selected" and not payload.rosterEntryIds:
        raise HTTPException(status_code=422, detail="请至少选择一名学生")
    if payload.studentScope == "all" and payload.rosterEntryIds:
        raise HTTPException(status_code=422, detail="全部学生范围不能同时指定学生名单")

    roster_entry_ids = (
        tuple(dict.fromkeys(payload.rosterEntryIds))
        if payload.studentScope == "selected"
        else None
    )
    try:
        selection = get_node_submission_export(
            version_id,
            node_key,
            int(teacher["id"]),
            roster_entry_ids=roster_entry_ids,
        )
        if payload.includeWorkbook and not payload.includeFiles:
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

        archive = build_node_submission_archive(
            selection,
            include_workbook=payload.includeWorkbook,
        )
        return FileResponse(
            archive.path,
            filename=archive.filename,
            media_type="application/zip",
            background=BackgroundTask(cleanup_material_archive, archive),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="流程版本不存在") from exc
    except TeacherNodeExportConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (TeacherNodeExportError, MaterialArchiveEmptyError) as exc:
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
