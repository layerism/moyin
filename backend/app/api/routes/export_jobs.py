from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.repositories.export_jobs import create_export_job, list_export_jobs, mark_export_seen, owned_export_job
from app.services.export_job_worker import export_job_directory
from app.services.security import get_current_teacher

router = APIRouter()


@router.post("/versions/{version_id}/export-jobs")
def create_job(version_id: str, teacher=Depends(get_current_teacher)):
    try:
        return create_export_job(version_id, int(teacher["id"]))
    except KeyError as exc:
        raise HTTPException(404, "流程版本不存在或无权访问") from exc


@router.get("/export-jobs")
def list_jobs(teacher=Depends(get_current_teacher)):
    return list_export_jobs(int(teacher["id"]))


@router.post("/export-jobs/{job_id}/seen")
def mark_seen(job_id: str, teacher=Depends(get_current_teacher)):
    try:
        mark_export_seen(job_id, int(teacher["id"]))
        return {"ok": True}
    except KeyError as exc:
        raise HTTPException(404, "导出任务不存在") from exc


@router.get("/export-jobs/{job_id}/download")
def download_job(job_id: str, teacher=Depends(get_current_teacher)):
    try:
        job = owned_export_job(job_id, int(teacher["id"]))
    except KeyError as exc:
        raise HTTPException(404, "导出任务不存在") from exc
    if job["status"] == "expired" or (job["expires_at"] and datetime.fromisoformat(job["expires_at"]) <= datetime.now(UTC)):
        raise HTTPException(410, "资料包已过期，请重新打包")
    if job["status"] != "completed":
        raise HTTPException(409, "资料包尚未生成")
    path = export_job_directory(job["id"]) / "version-package.zip"
    if not path.is_file():
        raise HTTPException(410, "资料包已不可用，请重新打包")
    return FileResponse(path, filename=job["filename"], media_type="application/zip")
