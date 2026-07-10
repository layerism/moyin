import sqlite3

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.database import get_connection
from app.services.security import (
    SESSION_COOKIE,
    SESSION_DAYS,
    create_session,
    delete_session,
    get_current_student,
    hash_password,
    utc_now_iso,
    verify_password,
)

router = APIRouter()


class Credentials(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    studentNo: str = Field(min_length=1, max_length=32)
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


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(payload: Credentials, response: Response) -> dict[str, object]:
    now = utc_now_iso()
    try:
        with get_connection() as connection:
            cursor = connection.execute(
                """
                INSERT INTO student_accounts
                    (student_no, name, password_hash, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    payload.studentNo.strip(),
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
    return {"id": student_id, "studentNo": payload.studentNo.strip(), "name": payload.name.strip()}


@router.post("/login")
def login(payload: Credentials, response: Response) -> dict[str, object]:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT id, student_no, name, password_hash
            FROM student_accounts
            WHERE student_no = ? AND status = 'active'
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
    return {"id": row["id"], "studentNo": row["student_no"], "name": row["name"]}


@router.get("/me")
def me(student: dict[str, object] = Depends(get_current_student)) -> dict[str, object]:
    return student


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(oa_session: str | None = Cookie(default=None)) -> Response:
    delete_session(oa_session)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(SESSION_COOKIE)
    return response
