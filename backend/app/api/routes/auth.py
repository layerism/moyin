import sqlite3

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.database import get_connection
from app.repositories.teacher_invitations import (
    INVALID_INVITATION_MESSAGE,
    TeacherInvitationError,
    accept_teacher_invitation,
    get_teacher_invitation,
)
from app.services.security import (
    SESSION_COOKIE,
    SESSION_DAYS,
    TEACHER_SESSION_COOKIE,
    create_session,
    create_student_session,
    create_teacher_session,
    delete_session,
    delete_teacher_session,
    get_authenticated_student,
    get_current_teacher,
    hash_password,
    utc_now_iso,
    verify_password,
)

router = APIRouter()


class StudentRegistrationCredentials(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    studentNo: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=8, max_length=128)


class StudentLoginCredentials(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    studentNo: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=3, max_length=128)


class StudentPasswordChangeRequest(BaseModel):
    newPassword: str = Field(min_length=8, max_length=128)


class TeacherLoginCredentials(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    employeeNo: str = Field(pattern=r"^\d{5}$")
    password: str = Field(min_length=8, max_length=128)


class TeacherInvitationAcceptance(BaseModel):
    password: str = Field(min_length=8, max_length=128)


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        max_age=SESSION_DAYS * 24 * 60 * 60,
        samesite="lax",
        secure=settings.app_env == "production",
    )


def set_teacher_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        TEACHER_SESSION_COOKIE,
        token,
        httponly=True,
        max_age=SESSION_DAYS * 24 * 60 * 60,
        samesite="lax",
        secure=settings.app_env == "production",
    )


@router.post("/student/register", status_code=status.HTTP_201_CREATED)
@router.post("/register", status_code=status.HTTP_201_CREATED, include_in_schema=False)
def register(
    payload: StudentRegistrationCredentials,
    response: Response,
) -> dict[str, object]:
    now = utc_now_iso()
    student_no = payload.studentNo.strip()
    if student_no.startswith("preview-student-"):
        raise HTTPException(status_code=422, detail="该学号为系统保留学号")
    try:
        with get_connection() as connection:
            cursor = connection.execute(
                """
                INSERT INTO student_accounts
                    (student_no, name, password_hash, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    student_no,
                    payload.name.strip(),
                    hash_password(payload.password),
                    now,
                    now,
                ),
            )
            student_id = int(cursor.lastrowid)
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="该学号已注册") from exc

    token = create_session(student_id)
    set_session_cookie(response, token)
    return {
        "id": student_id,
        "studentNo": student_no,
        "name": payload.name.strip(),
        "mustChangePassword": False,
    }


@router.post("/student/login")
@router.post("/login", include_in_schema=False)
def login(payload: StudentLoginCredentials, response: Response) -> dict[str, object]:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT id, student_no, name, password_hash, must_change_password
            FROM student_accounts
            WHERE student_no = ? AND status = 'active' AND account_kind = 'normal'
            """,
            (payload.studentNo.strip(),),
        ).fetchone()
    if (
        row is None
        or row["name"] != payload.name.strip()
        or not verify_password(payload.password, row["password_hash"])
    ):
        raise HTTPException(status_code=401, detail="姓名、学号或密码不正确")
    token = create_session(int(row["id"]))
    set_session_cookie(response, token)
    return {
        "id": row["id"],
        "studentNo": row["student_no"],
        "name": row["name"],
        "mustChangePassword": bool(row["must_change_password"]),
    }


@router.get("/student/me")
@router.get("/me", include_in_schema=False)
def me(student: dict[str, object] = Depends(get_authenticated_student)) -> dict[str, object]:
    return student


@router.post("/student/change-password")
def change_student_password(
    payload: StudentPasswordChangeRequest,
    response: Response,
    student: dict[str, object] = Depends(get_authenticated_student),
) -> dict[str, object]:
    if payload.newPassword == "123":
        raise HTTPException(status_code=422, detail="新密码不能与初始密码相同")

    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            """
            SELECT id, student_no, name, status, account_kind, must_change_password
            FROM student_accounts
            WHERE id = ?
            """,
            (int(student["id"]),),
        ).fetchone()
        if row is None or row["status"] != "active" or row["account_kind"] != "normal":
            raise HTTPException(status_code=401, detail="登录状态已失效")
        if not bool(row["must_change_password"]):
            raise HTTPException(status_code=409, detail="当前账号不需要重置密码")
        connection.execute(
            """
            UPDATE student_accounts
            SET password_hash = ?, must_change_password = 0, updated_at = ?
            WHERE id = ?
            """,
            (hash_password(payload.newPassword), now, int(row["id"])),
        )
        connection.execute(
            "DELETE FROM student_sessions WHERE student_account_id = ?",
            (int(row["id"]),),
        )
        token = create_student_session(connection, int(row["id"]))

    set_session_cookie(response, token)
    return {
        "id": row["id"],
        "studentNo": row["student_no"],
        "name": row["name"],
        "mustChangePassword": False,
    }


@router.post("/student/logout", status_code=status.HTTP_204_NO_CONTENT)
@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, include_in_schema=False)
def logout(oa_session: str | None = Cookie(default=None)) -> Response:
    delete_session(oa_session)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(SESSION_COOKIE)
    return response


@router.get("/teacher-invitations/{token}")
def teacher_invitation(token: str) -> dict[str, object]:
    try:
        invitation = get_teacher_invitation(token)
    except TeacherInvitationError as exc:
        raise HTTPException(status_code=404, detail=INVALID_INVITATION_MESSAGE) from exc
    return {
        "employeeNo": invitation["employeeNo"],
        "name": invitation["name"],
        "expiresAt": invitation["expiresAt"],
    }


@router.post(
    "/teacher-invitations/{token}/accept",
    status_code=status.HTTP_201_CREATED,
)
def accept_invitation(
    token: str,
    payload: TeacherInvitationAcceptance,
    response: Response,
) -> dict[str, object]:
    try:
        identity = accept_teacher_invitation(token=token, password=payload.password)
    except TeacherInvitationError as exc:
        if str(exc) == INVALID_INVITATION_MESSAGE:
            raise HTTPException(status_code=404, detail=INVALID_INVITATION_MESSAGE) from exc
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    session_token = create_teacher_session(int(identity["id"]))
    set_teacher_session_cookie(response, session_token)
    return identity


@router.post("/teacher/login")
def login_teacher(payload: TeacherLoginCredentials, response: Response) -> dict[str, object]:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT id, employee_no, name, password_hash, role
            FROM teacher_accounts
            WHERE employee_no = ? AND status = 'active'
            """,
            (payload.employeeNo.strip(),),
        ).fetchone()
    if (
        row is None
        or row["name"] != payload.name.strip()
        or not verify_password(payload.password, row["password_hash"])
    ):
        raise HTTPException(status_code=401, detail="姓名、工号或密码不正确")
    token = create_teacher_session(int(row["id"]))
    set_teacher_session_cookie(response, token)
    return {
        "id": row["id"],
        "employeeNo": row["employee_no"],
        "name": row["name"],
        "role": row["role"],
    }


@router.get("/teacher/me")
def teacher_me(teacher: dict[str, object] = Depends(get_current_teacher)) -> dict[str, object]:
    return teacher


@router.post("/teacher/logout", status_code=status.HTTP_204_NO_CONTENT)
def teacher_logout(teacher_session: str | None = Cookie(default=None)) -> Response:
    delete_teacher_session(teacher_session)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(TEACHER_SESSION_COOKIE)
    return response
