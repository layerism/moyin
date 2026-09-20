from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.domain.workflow import FlowValidationError
from app.domain.answer_sheet import AnswerSheetConfigError
from app.repositories.flow_content_assets import ContentAssetError
from app.repositories.workflow_blueprints import (
    BlueprintConflictError, list_blueprints, publish_blueprint, set_blueprint_active, use_blueprint,
    open_blueprint_draft, discard_blueprint_draft, delete_blueprint,
)
from app.services.object_storage import ObjectStorageError
from app.services.security import get_current_teacher

router = APIRouter()


def template_admin(teacher: dict = Depends(get_current_teacher)) -> dict:
    if teacher.get("role") != "super_admin":
        raise HTTPException(403, "仅超级管理员可以管理流程模板")
    return teacher


class PublishBlueprint(BaseModel):
    sourceFlowId: str
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)


class BlueprintAvailability(BaseModel):
    active: bool


def perform(operation):
    try:
        return operation()
    except KeyError as exc:
        raise HTTPException(404, "模板或源流程不存在，或无权访问") from exc
    except BlueprintConflictError as exc:
        raise HTTPException(409, str(exc)) from exc
    except (FlowValidationError, AnswerSheetConfigError, ContentAssetError) as exc:
        raise HTTPException(422, str(exc)) from exc
    except ObjectStorageError as exc:
        raise HTTPException(502, "复制模板附件失败，请稍后重试") from exc


@router.get("")
def get_templates(teacher: dict = Depends(get_current_teacher)):
    return list_blueprints(teacher.get("role") == "super_admin")


@router.post("", status_code=201)
def publish(payload: PublishBlueprint, teacher: dict = Depends(template_admin)):
    template_id = perform(lambda: publish_blueprint(
        payload.sourceFlowId, payload.name, payload.description, int(teacher["id"]),
    ))
    return {"id": template_id}


@router.put("/{template_id}")
def update(template_id: str, payload: PublishBlueprint, teacher: dict = Depends(template_admin)):
    perform(lambda: publish_blueprint(
        payload.sourceFlowId, payload.name, payload.description, int(teacher["id"]), template_id,
    ))
    return {"id": template_id}


@router.patch("/{template_id}")
def availability(template_id: str, payload: BlueprintAvailability, teacher: dict = Depends(template_admin)):
    perform(lambda: set_blueprint_active(template_id, payload.active, int(teacher["id"])))
    return {"id": template_id, "active": payload.active}


@router.post("/{template_id}/use", status_code=201)
def use(template_id: str, teacher: dict = Depends(get_current_teacher)):
    return perform(lambda: use_blueprint(template_id, int(teacher["id"])))


@router.post("/{template_id}/edit")
def edit(template_id: str, teacher: dict = Depends(template_admin)):
    return perform(lambda: open_blueprint_draft(template_id, int(teacher['id'])))


@router.put("/{template_id}/edit")
def commit_edit(template_id: str, payload: PublishBlueprint, teacher: dict = Depends(template_admin)):
    perform(lambda: publish_blueprint(payload.sourceFlowId, payload.name, payload.description,
                                     int(teacher['id']), template_id, editing=True))
    return {"id": template_id}


@router.delete("/{template_id}/edit", status_code=204)
def discard_edit(template_id: str, teacher: dict = Depends(template_admin)):
    perform(lambda: discard_blueprint_draft(template_id, int(teacher['id'])))


@router.delete("/{template_id}", status_code=204)
def delete(template_id: str, teacher: dict = Depends(template_admin)):
    perform(lambda: delete_blueprint(template_id, int(teacher['id'])))
