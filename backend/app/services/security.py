import base64
import hashlib
import hmac
import secrets
import sqlite3
from datetime import UTC, datetime, timedelta

from fastapi import Cookie, Depends, Header, HTTPException, status

from app.core.database import get_connection

SESSION_COOKIE = "oa_session"
TEACHER_SESSION_COOKIE = "teacher_session"
SESSION_DAYS = 14
PASSWORD_ITERATIONS = 240_000


def utc_now() -> datetime:
    return datetime.now(UTC)


def utc_now_iso() -> str:
    return utc_now().isoformat()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS
    )
    return "pbkdf2_sha256${}${}${}".format(
        PASSWORD_ITERATIONS,
        base64.urlsafe_b64encode(salt).decode("ascii"),
        base64.urlsafe_b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_text, digest_text = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_text)
        expected = base64.urlsafe_b64decode(digest_text)
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, int(iterations)
        )
        return hmac.compare_digest(actual, expected)
    except (TypeError, ValueError):
        return False


def create_student_session(
    connection: sqlite3.Connection,
    student_account_id: int,
) -> str:
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = utc_now()
    connection.execute(
        """
        INSERT INTO student_sessions
            (student_account_id, token_hash, expires_at, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (
            student_account_id,
            token_hash,
            (now + timedelta(days=SESSION_DAYS)).isoformat(),
            now.isoformat(),
        ),
    )
    return token


def create_session(student_account_id: int) -> str:
    with get_connection() as connection:
        return create_student_session(connection, student_account_id)


def create_teacher_session(teacher_account_id: int) -> str:
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = utc_now()
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO teacher_sessions
                (teacher_account_id, token_hash, expires_at, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (teacher_account_id, token_hash, (now + timedelta(days=SESSION_DAYS)).isoformat(), now.isoformat()),
        )
    return token


def delete_session(token: str | None) -> None:
    if not token:
        return
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with get_connection() as connection:
        connection.execute("DELETE FROM student_sessions WHERE token_hash = ?", (token_hash,))


def delete_teacher_session(token: str | None) -> None:
    if not token:
        return
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with get_connection() as connection:
        connection.execute("DELETE FROM teacher_sessions WHERE token_hash = ?", (token_hash,))


def get_authenticated_student(
    oa_session: str | None = Cookie(default=None),
) -> dict[str, object]:
    if not oa_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
    token_hash = hashlib.sha256(oa_session.encode("utf-8")).hexdigest()
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT a.id, a.student_no, a.name, a.must_change_password
            FROM student_sessions s
            JOIN student_accounts a ON a.id = s.student_account_id
            WHERE s.token_hash = ? AND s.expires_at > ? AND a.status = 'active'
              AND a.account_kind = 'normal'
            """,
            (token_hash, utc_now_iso()),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录状态已失效")
    return {
        "id": row["id"],
        "studentNo": row["student_no"],
        "name": row["name"],
        "mustChangePassword": bool(row["must_change_password"]),
    }


def get_current_student(
    oa_session: str | None = Cookie(default=None),
) -> dict[str, object]:
    student = get_authenticated_student(oa_session)
    if student["mustChangePassword"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="请先修改初始密码",
        )
    return student


def _teacher_from_session(teacher_session: str | None) -> dict[str, object] | None:
    if not teacher_session:
        return None
    token_hash = hashlib.sha256(teacher_session.encode("utf-8")).hexdigest()
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT a.id, a.employee_no, a.name, a.role
            FROM teacher_sessions s
            JOIN teacher_accounts a ON a.id = s.teacher_account_id
            WHERE s.token_hash = ? AND s.expires_at > ? AND a.status = 'active'
            """,
            (token_hash, utc_now_iso()),
        ).fetchone()
    return None if row is None else {
        "id": row["id"],
        "employeeNo": row["employee_no"],
        "name": row["name"],
        "role": row["role"],
    }


def get_current_teacher(
    teacher_session: str | None = Cookie(default=None),
) -> dict[str, object]:
    teacher = _teacher_from_session(teacher_session)
    if teacher is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先以教师身份登录")
    return teacher


def get_current_runtime_student(
    preview_token: str | None = Header(default=None, alias="X-Flow-Preview-Token"),
    oa_session: str | None = Cookie(default=None),
    teacher_session: str | None = Cookie(default=None),
) -> dict[str, object]:
    if not preview_token:
        return get_current_student(oa_session)
    teacher = _teacher_from_session(teacher_session)
    if teacher is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="预览会话已失效，请返回教师页面重新预览",
        )
    from app.repositories.flow_previews import PreviewSessionError, resolve_preview_actor

    try:
        return resolve_preview_actor(preview_token, int(teacher["id"]))
    except PreviewSessionError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


def get_current_super_admin(
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    if teacher.get("role") != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅超级管理员可以访问数据库管理功能",
        )
    return teacher
