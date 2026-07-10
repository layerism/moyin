import base64
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import Cookie, HTTPException, status

from app.core.database import get_connection

SESSION_COOKIE = "oa_session"
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


def create_session(student_account_id: int) -> str:
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = utc_now()
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO student_sessions
                (student_account_id, token_hash, expires_at, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (student_account_id, token_hash, (now + timedelta(days=SESSION_DAYS)).isoformat(), now.isoformat()),
        )
    return token


def delete_session(token: str | None) -> None:
    if not token:
        return
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with get_connection() as connection:
        connection.execute("DELETE FROM student_sessions WHERE token_hash = ?", (token_hash,))


def get_current_student(oa_session: str | None = Cookie(default=None)) -> dict[str, object]:
    if not oa_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
    token_hash = hashlib.sha256(oa_session.encode("utf-8")).hexdigest()
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT a.id, a.student_no, a.name
            FROM student_sessions s
            JOIN student_accounts a ON a.id = s.student_account_id
            WHERE s.token_hash = ? AND s.expires_at > ? AND a.status = 'active'
            """,
            (token_hash, utc_now_iso()),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录状态已失效")
    return {"id": row["id"], "studentNo": row["student_no"], "name": row["name"]}
