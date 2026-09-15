from typing import Literal

from fastapi import APIRouter, Cookie, Depends, Request
from pydantic import BaseModel, Field

from app.core.database import get_connection
from app.services.security import get_authenticated_student, get_current_teacher
from app.services import sms_recovery

router = APIRouter()
Role = Literal["student", "teacher"]


class Identify(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    identifier: str = Field(min_length=1, max_length=32)


class SendReset(BaseModel):
    recoveryToken: str = Field(min_length=32, max_length=64)
    phone: str = Field(pattern=r"^1[3-9][0-9]{9}$")


class SendBinding(BaseModel):
    phone: str = Field(pattern=r"^1[3-9][0-9]{9}$")
    password: str = Field(min_length=3, max_length=128)


class Verify(BaseModel):
    challengeId: str = Field(min_length=32, max_length=64)
    code: str = Field(pattern=r"^[0-9]{6}$")


class Reset(BaseModel):
    resetToken: str = Field(min_length=32, max_length=64)
    newPassword: str = Field(min_length=8, max_length=128)


def identity(role: Role, oa_session: str | None = Cookie(default=None),
             teacher_session: str | None = Cookie(default=None)) -> dict:
    return get_authenticated_student(oa_session) if role == "student" else get_current_teacher(teacher_session)


@router.get("/{role}/phone")
def phone_status(role: Role, user: dict = Depends(identity)) -> dict:
    table, _ = sms_recovery.TABLES[role]
    with get_connection() as connection:
        row = connection.execute(f"SELECT phone FROM {table} WHERE id = ?", (user["id"],)).fetchone()
    phone = row["phone"] if row else None
    return {"phone": phone[:3] + "****" + phone[-4:] if phone else None}


@router.post("/{role}/phone/code")
def binding_code(role: Role, payload: SendBinding, request: Request, user: dict = Depends(identity)) -> dict:
    return sms_recovery.send_code(role, "bind", payload.phone,
        request.client.host if request.client else "unknown", account_id=int(user["id"]), password=payload.password)


@router.post("/{role}/phone/verify")
def bind_phone(role: Role, payload: Verify, user: dict = Depends(identity)) -> dict:
    sms_recovery.complete(role, "bind", payload.challengeId, payload.code, account_id=int(user["id"]))
    return {"message": "手机号已绑定，可用于找回密码"}


@router.post("/{role}/password-reset/identify")
def identify_account(role: Role, payload: Identify, request: Request) -> dict:
    return sms_recovery.identify_account(role, payload.name, payload.identifier,
        request.client.host if request.client else "unknown")


@router.post("/{role}/password-reset/verify")
def verify_reset_code(role: Role, payload: Verify) -> dict:
    return sms_recovery.complete(role, "reset", payload.challengeId, payload.code)


@router.post("/{role}/password-reset/code")
def reset_code(role: Role, payload: SendReset, request: Request) -> dict:
    return sms_recovery.send_code(role, "reset", payload.phone,
        request.client.host if request.client else "unknown", recovery_token=payload.recoveryToken)


@router.post("/{role}/password-reset/confirm")
def reset_password(role: Role, payload: Reset) -> dict:
    sms_recovery.reset_password(role, payload.resetToken, payload.newPassword)
    return {"message": "密码已重置，请使用新密码登录"}
