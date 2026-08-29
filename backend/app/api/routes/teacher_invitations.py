from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.repositories.teacher_invitations import (
    TeacherInvitationError,
    create_teacher_invitation,
    list_teacher_invitations,
    revoke_teacher_invitation,
)
from app.services.security import get_current_super_admin


router = APIRouter(dependencies=[Depends(get_current_super_admin)])


class CreateTeacherInvitationRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    employeeNo: str = Field(pattern=r"^\d{5}$")
    expiresAt: datetime


@router.get("")
def invitations() -> list[dict[str, object]]:
    return list_teacher_invitations()


@router.post("", status_code=status.HTTP_201_CREATED)
def create_invitation(
    payload: CreateTeacherInvitationRequest,
    admin: dict[str, object] = Depends(get_current_super_admin),
) -> dict[str, object]:
    try:
        return create_teacher_invitation(
            name=payload.name,
            employee_no=payload.employeeNo,
            expires_at=payload.expiresAt.isoformat(),
            actor_id=int(admin["id"]),
        )
    except TeacherInvitationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/{invitation_id}/revoke")
def revoke_invitation(
    invitation_id: str,
    admin: dict[str, object] = Depends(get_current_super_admin),
) -> dict[str, object]:
    try:
        return revoke_teacher_invitation(
            invitation_id=invitation_id,
            actor_id=int(admin["id"]),
        )
    except TeacherInvitationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
