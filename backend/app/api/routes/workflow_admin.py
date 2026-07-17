from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.repositories.flow_instances import (
    get_version_progress,
    set_global_deadline,
    set_student_deadline,
)
from app.services.security import get_current_teacher
from app.services.security import get_current_super_admin
from app.repositories.audit_scripts import (
    AuditScriptConflictError,
    AuditScriptNotFoundError,
    AuditScriptValidationError,
    archive_audit_script,
    create_audit_script,
    create_audit_script_version,
    list_audit_scripts,
)
from app.services.audit_script_templates import get_template_archive

router = APIRouter(dependencies=[Depends(get_current_teacher)])


class DeadlineRequest(BaseModel):
    deadlineAt: str
    reason: str = Field(min_length=1, max_length=500)


@router.get("/audit-scripts")
def get_audit_scripts() -> list[dict[str, object]]:
    return list_audit_scripts()


@router.get("/audit-scripts/templates/{language}")
def download_audit_script_template(
    language: Literal["python", "javascript"],
    _: dict[str, object] = Depends(get_current_super_admin),
) -> Response:
    content, filename = get_template_archive(language)
    return Response(
        content=content,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/audit-scripts", status_code=status.HTTP_201_CREATED)
async def post_audit_script(
    name: Annotated[str, Form(min_length=1, max_length=120)],
    description: Annotated[str, Form(min_length=1, max_length=500)],
    file: Annotated[UploadFile, File()],
    admin: dict[str, object] = Depends(get_current_super_admin),
) -> dict[str, object]:
    content = await _read_audit_script_content(file)
    return _create_script_response(
        lambda: create_audit_script(
            name, description, file.filename or "", content, int(admin["id"])
        )
    )


@router.put("/audit-scripts/{script_id}")
async def put_audit_script(
    script_id: str,
    description: Annotated[str, Form(min_length=1, max_length=500)],
    file: Annotated[UploadFile, File()],
    admin: dict[str, object] = Depends(get_current_super_admin),
) -> dict[str, object]:
    content = await _read_audit_script_content(file)
    return _create_script_response(
        lambda: create_audit_script_version(
            script_id, description, file.filename or "", content, int(admin["id"])
        )
    )


@router.delete("/audit-scripts/{script_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_audit_script(
    script_id: str,
    admin: dict[str, object] = Depends(get_current_super_admin),
) -> Response:
    try:
        archive_audit_script(script_id, int(admin["id"]))
    except AuditScriptNotFoundError as exc:
        raise HTTPException(status_code=404, detail="审核脚本不存在") from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _create_script_response(operation) -> dict[str, object]:
    try:
        return operation()
    except AuditScriptNotFoundError as exc:
        raise HTTPException(status_code=404, detail="审核脚本不存在") from exc
    except AuditScriptConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except AuditScriptValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


async def _read_audit_script_content(file: UploadFile) -> bytes:
    return await file.read(settings.audit_script_max_bytes + 1)


@router.patch("/versions/{version_id}/nodes/{node_key}/deadline")
def patch_global_deadline(
    version_id: str,
    node_key: str,
    payload: DeadlineRequest,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, bool]:
    try:
        set_global_deadline(
            version_id,
            node_key,
            payload.deadlineAt,
            payload.reason,
            int(teacher["id"]),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="流程节点不存在") from exc
    return {"updated": True}


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


@router.get("/versions/{version_id}/progress")
def version_progress(
    version_id: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return get_version_progress(version_id, int(teacher["id"]))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="流程版本不存在") from exc
