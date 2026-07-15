from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field

from app.domain.workflow import FlowValidationError, validate_flow_config
from app.domain.workflow_revision import (
    PublishedEdgeDeletionError,
    PublishedNodeDeletionError,
    PublishedNodeMovementError,
)
from app.repositories.workflows import (
    ArchivedFlowError,
    DraftRevisionConflictError,
    DuplicateFlowNameError,
    create_flow,
    delete_flow,
    get_flow,
    get_revision_impact,
    list_flows,
    publish_flow,
    resolve_share_token,
    save_draft,
)
from app.services.security import get_current_teacher

router = APIRouter(dependencies=[Depends(get_current_teacher)])
shared_router = APIRouter()


class CreateFlowRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)


class FlowConfigRequest(BaseModel):
    config: dict[str, Any]


class PublishFlowRequest(BaseModel):
    config: dict[str, Any] | None = None
    expectedDraftConfigHash: str | None = None
    expectedCurrentVersionId: str | None = None


def not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="流程不存在")


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


@router.get("/{flow_id}")
def get_flow_route(
    flow_id: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return get_flow(flow_id, int(teacher["id"]))
    except KeyError as exc:
        raise not_found() from exc


@router.post("/validate")
def validate(payload: FlowConfigRequest) -> dict[str, bool]:
    try:
        validate_flow_config(payload.config)
    except FlowValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"valid": True}


@router.put("/{flow_id}/draft")
def put_draft(
    flow_id: str,
    payload: FlowConfigRequest,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return save_draft(flow_id, payload.config, int(teacher["id"]))
    except KeyError as exc:
        raise not_found() from exc
    except ArchivedFlowError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except PublishedNodeDeletionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except PublishedEdgeDeletionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except PublishedNodeMovementError as exc:
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
        )
    except KeyError as exc:
        raise not_found() from exc
    except FlowValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except PublishedNodeDeletionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except PublishedEdgeDeletionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except PublishedNodeMovementError as exc:
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
        )
    except KeyError as exc:
        raise not_found() from exc
    except FlowValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ArchivedFlowError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except PublishedNodeDeletionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except PublishedEdgeDeletionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except PublishedNodeMovementError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except DraftRevisionConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/{flow_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workflow(
    flow_id: str, teacher: dict[str, object] = Depends(get_current_teacher)
) -> Response:
    try:
        delete_flow(flow_id, int(teacher["id"]))
    except KeyError as exc:
        raise not_found() from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@shared_router.get("/{token}")
def get_shared_flow(token: str) -> dict[str, object]:
    try:
        shared = resolve_share_token(token)
        return {"name": shared["name"], "description": shared["description"]}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="分享链接无效或已停用") from exc
