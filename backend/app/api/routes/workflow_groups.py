from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, field_validator

from app.repositories.workflow_groups import (
    WorkflowGroupConflictError,
    create_workflow_group,
    delete_workflow_group,
    list_workflow_groups,
    rename_workflow_group,
)
from app.services.security import get_current_teacher


router = APIRouter(dependencies=[Depends(get_current_teacher)])


class WorkflowGroupNameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=60)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        name = value.strip()
        if not name:
            raise ValueError("分组名称不能为空")
        return name


@router.get("")
def get_workflow_groups(
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> list[dict[str, object]]:
    return list_workflow_groups(int(teacher["id"]))


@router.post("", status_code=status.HTTP_201_CREATED)
def post_workflow_group(
    payload: WorkflowGroupNameRequest,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return create_workflow_group(payload.name, int(teacher["id"]))
    except WorkflowGroupConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.patch("/{group_id}")
def patch_workflow_group(
    group_id: str,
    payload: WorkflowGroupNameRequest,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return rename_workflow_group(group_id, payload.name, int(teacher["id"]))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="流程分组不存在") from exc
    except WorkflowGroupConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workflow_group_route(
    group_id: str,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> Response:
    try:
        delete_workflow_group(group_id, int(teacher["id"]))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="流程分组不存在") from exc
    except WorkflowGroupConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
