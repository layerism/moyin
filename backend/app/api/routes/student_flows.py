from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.repositories.flow_instances import (
    RuntimeConflictError,
    RuntimeDeadlineError,
    get_instance,
    get_or_create_instance,
    save_node_draft,
    submit_node,
)
from app.services.security import get_current_student

router = APIRouter()


class DraftRequest(BaseModel):
    payload: dict[str, Any]


class SubmitRequest(BaseModel):
    payload: dict[str, Any]
    idempotencyKey: str = Field(min_length=1, max_length=100)


def runtime_error(exc: Exception) -> HTTPException:
    if isinstance(exc, KeyError):
        return HTTPException(status_code=404, detail="流程实例或节点不存在")
    if isinstance(exc, RuntimeDeadlineError):
        return HTTPException(status_code=422, detail=str(exc))
    return HTTPException(status_code=409, detail=str(exc))


@router.post("/shared/{token}/enter")
def enter_shared_flow(
    token: str, student: dict[str, object] = Depends(get_current_student)
) -> dict[str, object]:
    try:
        return get_or_create_instance(token, int(student["id"]))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="分享链接无效或已停用") from exc


@router.get("/flow-instances/{instance_id}")
def flow_instance(
    instance_id: str, student: dict[str, object] = Depends(get_current_student)
) -> dict[str, object]:
    try:
        return get_instance(instance_id, int(student["id"]))
    except KeyError as exc:
        raise runtime_error(exc) from exc


@router.put("/node-instances/{node_instance_id}/draft")
def put_draft(
    node_instance_id: str,
    payload: DraftRequest,
    student: dict[str, object] = Depends(get_current_student),
) -> dict[str, object]:
    try:
        return save_node_draft(node_instance_id, int(student["id"]), payload.payload)
    except (KeyError, RuntimeConflictError) as exc:
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
    except (KeyError, RuntimeConflictError, RuntimeDeadlineError) as exc:
        raise runtime_error(exc) from exc
