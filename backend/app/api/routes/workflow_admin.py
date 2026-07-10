from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.repositories.flow_instances import (
    get_version_progress,
    set_global_deadline,
    set_student_deadline,
)

router = APIRouter()


class DeadlineRequest(BaseModel):
    deadlineAt: str
    reason: str = Field(min_length=1, max_length=500)


@router.patch("/versions/{version_id}/nodes/{node_key}/deadline")
def patch_global_deadline(
    version_id: str, node_key: str, payload: DeadlineRequest
) -> dict[str, bool]:
    try:
        set_global_deadline(version_id, node_key, payload.deadlineAt, payload.reason)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="流程节点不存在") from exc
    return {"updated": True}


@router.put("/instances/{instance_id}/nodes/{node_key}/deadline")
def put_student_deadline(
    instance_id: str, node_key: str, payload: DeadlineRequest
) -> dict[str, object]:
    try:
        return set_student_deadline(instance_id, node_key, payload.deadlineAt, payload.reason)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="学生流程实例不存在") from exc


@router.get("/versions/{version_id}/progress")
def version_progress(version_id: str) -> dict[str, object]:
    try:
        return get_version_progress(version_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="流程版本不存在") from exc
