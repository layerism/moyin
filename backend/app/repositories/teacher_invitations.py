import hashlib
import json
import re
import secrets
import sqlite3
import uuid
from datetime import UTC, datetime

from app.core.database import get_connection
from app.services.security import hash_password, utc_now, utc_now_iso


INVALID_INVITATION_MESSAGE = "邀请链接无效或已失效"


class TeacherInvitationError(ValueError):
    pass


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _expire_active_invitations(
    connection: sqlite3.Connection,
    now: str,
) -> None:
    connection.execute(
        """
        UPDATE teacher_invitations
        SET status = 'expired'
        WHERE status = 'active' AND expires_at <= ?
        """,
        (now,),
    )


def _record(row: sqlite3.Row) -> dict[str, object]:
    return {
        "id": row["id"],
        "employeeNo": row["employee_no"],
        "name": row["name"],
        "status": row["status"],
        "expiresAt": row["expires_at"],
        "createdAt": row["created_at"],
        "usedAt": row["used_at"],
        "revokedAt": row["revoked_at"],
    }


def _parse_expiry(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise TeacherInvitationError("邀请有效期格式不正确") from exc
    if parsed.tzinfo is None:
        raise TeacherInvitationError("邀请有效期必须包含时区")
    normalized = parsed.astimezone(UTC)
    if normalized <= utc_now():
        raise TeacherInvitationError("邀请有效期必须晚于当前时间")
    return normalized.isoformat()


def _write_audit(
    connection: sqlite3.Connection,
    *,
    actor_id: str,
    action: str,
    invitation_id: str,
    before_data: dict[str, object] | None,
    after_data: dict[str, object] | None,
) -> None:
    connection.execute(
        """
        INSERT INTO audit_logs
            (actor_id, action, entity_type, entity_id,
             before_data, after_data, reason, created_at)
        VALUES (?, ?, 'teacher_invitation', ?, ?, ?, ?, ?)
        """,
        (
            actor_id,
            action,
            invitation_id,
            None if before_data is None else json.dumps(before_data, ensure_ascii=False),
            None if after_data is None else json.dumps(after_data, ensure_ascii=False),
            "教师邀请账号管理",
            utc_now_iso(),
        ),
    )


def create_teacher_invitation(
    *,
    name: str,
    employee_no: str,
    expires_at: str,
    actor_id: int,
) -> dict[str, object]:
    normalized_name = name.strip()
    normalized_employee_no = employee_no.strip()
    if not normalized_name:
        raise TeacherInvitationError("请填写教师姓名")
    if re.fullmatch(r"\d{5}", normalized_employee_no) is None:
        raise TeacherInvitationError("教师工号必须为 5 位数字")
    normalized_expiry = _parse_expiry(expires_at)
    now = utc_now_iso()
    invitation_id = str(uuid.uuid4())
    token = secrets.token_urlsafe(32)

    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        _expire_active_invitations(connection, now)
        account = connection.execute(
            "SELECT 1 FROM teacher_accounts WHERE employee_no = ?",
            (normalized_employee_no,),
        ).fetchone()
        if account is not None:
            raise TeacherInvitationError("该工号已存在教师账号")
        active = connection.execute(
            """
            SELECT 1 FROM teacher_invitations
            WHERE employee_no = ? AND status = 'active'
            """,
            (normalized_employee_no,),
        ).fetchone()
        if active is not None:
            raise TeacherInvitationError("该工号已有待注册邀请")
        connection.execute(
            """
            INSERT INTO teacher_invitations
                (id, employee_no, name, token_hash, status,
                 expires_at, created_by, created_at)
            VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
            """,
            (
                invitation_id,
                normalized_employee_no,
                normalized_name,
                _hash_token(token),
                normalized_expiry,
                actor_id,
                now,
            ),
        )
        _write_audit(
            connection,
            actor_id=str(actor_id),
            action="teacher_invitation_created",
            invitation_id=invitation_id,
            before_data=None,
            after_data={
                "employeeNo": normalized_employee_no,
                "name": normalized_name,
                "expiresAt": normalized_expiry,
                "status": "active",
            },
        )

    return {
        "id": invitation_id,
        "employeeNo": normalized_employee_no,
        "name": normalized_name,
        "status": "active",
        "expiresAt": normalized_expiry,
        "createdAt": now,
        "usedAt": None,
        "revokedAt": None,
        "token": token,
    }


def list_teacher_invitations() -> list[dict[str, object]]:
    with get_connection() as connection:
        _expire_active_invitations(connection, utc_now_iso())
        rows = connection.execute(
            """
            SELECT id, employee_no, name, status, expires_at,
                   created_at, used_at, revoked_at
            FROM teacher_invitations
            ORDER BY created_at DESC
            """
        ).fetchall()
    return [_record(row) for row in rows]


def get_teacher_invitation(token: str) -> dict[str, object]:
    if not token:
        raise TeacherInvitationError(INVALID_INVITATION_MESSAGE)
    with get_connection() as connection:
        now = utc_now_iso()
        _expire_active_invitations(connection, now)
        row = connection.execute(
            """
            SELECT id, employee_no, name, status, expires_at,
                   created_at, used_at, revoked_at
            FROM teacher_invitations
            WHERE token_hash = ? AND status = 'active' AND expires_at > ?
            """,
            (_hash_token(token), now),
        ).fetchone()
    if row is None:
        raise TeacherInvitationError(INVALID_INVITATION_MESSAGE)
    return _record(row)


def accept_teacher_invitation(*, token: str, password: str) -> dict[str, object]:
    now = utc_now_iso()
    try:
        with get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            _expire_active_invitations(connection, now)
            invitation = connection.execute(
                """
                SELECT id, employee_no, name, status, expires_at,
                       created_at, used_at, revoked_at
                FROM teacher_invitations
                WHERE token_hash = ? AND status = 'active' AND expires_at > ?
                """,
                (_hash_token(token), now),
            ).fetchone()
            if invitation is None:
                raise TeacherInvitationError(INVALID_INVITATION_MESSAGE)
            existing = connection.execute(
                "SELECT 1 FROM teacher_accounts WHERE employee_no = ?",
                (invitation["employee_no"],),
            ).fetchone()
            if existing is not None:
                raise TeacherInvitationError("该工号已注册，请联系管理员")
            cursor = connection.execute(
                """
                INSERT INTO teacher_accounts
                    (employee_no, name, password_hash, status, role, created_at, updated_at)
                VALUES (?, ?, ?, 'active', 'teacher', ?, ?)
                """,
                (
                    invitation["employee_no"],
                    invitation["name"],
                    hash_password(password),
                    now,
                    now,
                ),
            )
            teacher_id = int(cursor.lastrowid)
            connection.execute(
                """
                UPDATE teacher_invitations
                SET status = 'used', used_by_teacher_id = ?, used_at = ?
                WHERE id = ? AND status = 'active'
                """,
                (teacher_id, now, invitation["id"]),
            )
            _write_audit(
                connection,
                actor_id=str(teacher_id),
                action="teacher_invitation_used",
                invitation_id=str(invitation["id"]),
                before_data={
                    "employeeNo": invitation["employee_no"],
                    "name": invitation["name"],
                    "status": "active",
                },
                after_data={
                    "employeeNo": invitation["employee_no"],
                    "name": invitation["name"],
                    "status": "used",
                    "teacherId": teacher_id,
                },
            )
    except sqlite3.IntegrityError as exc:
        raise TeacherInvitationError("该工号已注册，请联系管理员") from exc

    return {
        "id": teacher_id,
        "employeeNo": invitation["employee_no"],
        "name": invitation["name"],
        "role": "teacher",
    }


def revoke_teacher_invitation(
    *,
    invitation_id: str,
    actor_id: int,
) -> dict[str, object]:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        _expire_active_invitations(connection, now)
        row = connection.execute(
            """
            SELECT id, employee_no, name, status, expires_at,
                   created_at, used_at, revoked_at
            FROM teacher_invitations
            WHERE id = ?
            """,
            (invitation_id,),
        ).fetchone()
        if row is None or row["status"] != "active":
            raise TeacherInvitationError("该邀请已失效，不能撤销")
        connection.execute(
            """
            UPDATE teacher_invitations
            SET status = 'revoked', revoked_at = ?
            WHERE id = ? AND status = 'active'
            """,
            (now, invitation_id),
        )
        _write_audit(
            connection,
            actor_id=str(actor_id),
            action="teacher_invitation_revoked",
            invitation_id=invitation_id,
            before_data={
                "employeeNo": row["employee_no"],
                "name": row["name"],
                "status": "active",
            },
            after_data={
                "employeeNo": row["employee_no"],
                "name": row["name"],
                "status": "revoked",
                "revokedAt": now,
            },
        )
        updated = connection.execute(
            """
            SELECT id, employee_no, name, status, expires_at,
                   created_at, used_at, revoked_at
            FROM teacher_invitations
            WHERE id = ?
            """,
            (invitation_id,),
        ).fetchone()
    return _record(updated)
