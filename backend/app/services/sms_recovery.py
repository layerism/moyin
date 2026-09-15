"""Persistent, purpose-bound SMS challenges and atomic account updates."""
import hashlib
import secrets
import sqlite3
import time

from fastapi import HTTPException

from app.core.database import get_connection
from app.services import pnvs
from app.services.security import hash_password, verify_password, utc_now_iso

TABLES = {"student": ("student_accounts", "student_no"),
          "teacher": ("teacher_accounts", "employee_no")}
INVALID = "验证码无效或已过期，请重新获取；未绑定手机号请联系管理员"


def initialize_sms_schema(connection: sqlite3.Connection) -> None:
    for table, _ in TABLES.values():
        columns = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}
        if "phone" not in columns:
            connection.execute(f"ALTER TABLE {table} ADD COLUMN phone TEXT")
            connection.execute(f"ALTER TABLE {table} ADD COLUMN phone_verified_at TEXT")
        connection.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS {table}_phone ON {table}(phone)")
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS sms_challenges (
            id TEXT PRIMARY KEY, role TEXT NOT NULL, purpose TEXT NOT NULL,
            account_id INTEGER, phone TEXT NOT NULL, ip TEXT NOT NULL,
            password_version TEXT NOT NULL, created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
            state TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sms_phone_time ON sms_challenges(phone, created_at);
        CREATE INDEX IF NOT EXISTS sms_ip_time ON sms_challenges(ip, created_at);
    """)


def version(row: sqlite3.Row) -> str:
    return hashlib.sha256(row["password_hash"].encode()).hexdigest()


def active(row: sqlite3.Row | None, role: str) -> bool:
    return bool(row and row["status"] == "active"
                and (role != "student" or row["account_kind"] == "normal"))


def scheme(role: str, purpose: str) -> str:
    return f"moyin-{role}-{purpose}"


def send_code(role: str, purpose: str, phone: str, ip: str, identifier: str = "",
              account_id: int | None = None, password: str = "") -> dict:
    # Check configuration even for unknown identities, keeping public responses uniform.
    pnvs.client()
    now = int(time.time())
    challenge_id = secrets.token_urlsafe(32)
    table, identifier_column = TABLES[role]
    binding_error = None
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("DELETE FROM sms_challenges WHERE created_at < ?", (now - 86400,))
        last = connection.execute("SELECT MAX(created_at) FROM sms_challenges WHERE phone = ?", (phone,)).fetchone()[0]
        if last is not None and now < last + 60:
            raise HTTPException(429, "请等待后再获取验证码", headers={"Retry-After": str(last + 60 - now)})
        for column, value, window, limit in (("phone", phone, 86400, 10), ("ip", ip, 3600, 30), ("ip", ip, 60, 5)):
            count = connection.execute(f"SELECT COUNT(*) FROM sms_challenges WHERE {column} = ? AND created_at > ?",
                                       (value, now - window)).fetchone()[0]
            if count >= limit:
                raise HTTPException(429, "请求过于频繁，请稍后重试", headers={"Retry-After": str(window)})
        if purpose == "bind":
            row = connection.execute(f"SELECT * FROM {table} WHERE id = ?", (account_id,)).fetchone()
            if not active(row, role) or not verify_password(password, row["password_hash"]):
                binding_error = "当前密码不正确或账号已失效"
            elif role == "student" and row["must_change_password"]:
                binding_error = "请先修改初始密码，再绑定手机号"
            elif row["phone"]:
                binding_error = "已绑定手机号；更换号码请联系管理员核实身份"
            elif connection.execute(f"SELECT id FROM {table} WHERE phone = ?", (phone,)).fetchone():
                binding_error = "该手机号无法绑定，请联系管理员"
            if binding_error:
                row = None
        else:
            row = connection.execute(f"SELECT * FROM {table} WHERE {identifier_column} = ? AND phone = ? AND phone_verified_at IS NOT NULL",
                                     (identifier.strip(), phone)).fetchone()
            if not active(row, role):
                row = None
        connection.execute("UPDATE sms_challenges SET state = 'expired' WHERE phone = ? AND role = ? AND purpose = ? AND state != 'consumed'",
                           (phone, role, purpose))
        connection.execute("""INSERT INTO sms_challenges
            (id,role,purpose,account_id,phone,ip,password_version,created_at,expires_at,state)
            VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (challenge_id, role, purpose, row["id"] if row else None, phone, ip,
             version(row) if row else "", now, now + 300, "pending"))
    if binding_error:
        raise HTTPException(400, binding_error, headers={"Retry-After": "60"})
    if row:
        try:
            pnvs.send(phone, scheme(role, purpose), challenge_id)
        except HTTPException:
            with get_connection() as connection:
                connection.execute("UPDATE sms_challenges SET state = 'failed' WHERE id = ?", (challenge_id,))
            # Public recovery must not disclose whether an account matched, including vendor failure.
            if purpose == "bind":
                raise HTTPException(503, "短信发送未成功，请稍后重试", headers={"Retry-After": "60"}) from None
            return {"challengeId": challenge_id, "retryAfter": 60}
    with get_connection() as connection:
        connection.execute("UPDATE sms_challenges SET state = 'ready' WHERE id = ? AND state = 'pending'", (challenge_id,))
    return {"challengeId": challenge_id, "retryAfter": 60}


def complete(role: str, purpose: str, challenge_id: str, code: str,
             account_id: int | None = None, new_password: str = "") -> None:
    now = int(time.time())
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT * FROM sms_challenges WHERE id = ? AND role = ? AND purpose = ?",
                                 (challenge_id, role, purpose)).fetchone()
        if (not row or row["state"] != "ready" or row["expires_at"] <= now
                or row["attempts"] >= 5 or (purpose == "bind" and row["account_id"] != account_id)):
            raise HTTPException(400, INVALID)
        connection.execute("UPDATE sms_challenges SET state = 'checking', attempts = attempts + 1 WHERE id = ?", (challenge_id,))
    try:
        passed = bool(row["account_id"]) and pnvs.check(row["phone"], scheme(role, purpose), challenge_id, code)
    except HTTPException:
        with get_connection() as connection:
            connection.execute("UPDATE sms_challenges SET state = 'ready' WHERE id = ? AND state = 'checking'", (challenge_id,))
        raise
    if not passed:
        with get_connection() as connection:
            connection.execute("UPDATE sms_challenges SET state = 'ready' WHERE id = ? AND state = 'checking'", (challenge_id,))
        raise HTTPException(400, INVALID)
    table, _ = TABLES[role]
    password_hash = hash_password(new_password) if purpose == "reset" else None
    try:
        with get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            account = connection.execute(f"SELECT * FROM {table} WHERE id = ?", (row["account_id"],)).fetchone()
            if (not active(account, role) or version(account) != row["password_version"]
                    or (purpose == "reset" and account["phone"] != row["phone"])
                    or (purpose == "bind" and account["phone"])):
                raise HTTPException(400, INVALID)
            changed = connection.execute("UPDATE sms_challenges SET state = 'consumed' WHERE id = ? AND state = 'checking' AND expires_at > ?",
                                         (challenge_id, int(time.time()))).rowcount
            if not changed:
                raise HTTPException(400, INVALID)
            if purpose == "bind":
                connection.execute(f"UPDATE {table} SET phone = ?, phone_verified_at = ?, updated_at = ? WHERE id = ?",
                                   (row["phone"], utc_now_iso(), utc_now_iso(), account["id"]))
            else:
                extra = ", must_change_password = 0" if role == "student" else ""
                connection.execute(f"UPDATE {table} SET password_hash = ?, updated_at = ?{extra} WHERE id = ?",
                                   (password_hash, utc_now_iso(), account["id"]))
                connection.execute(f"DELETE FROM {role}_sessions WHERE {role}_account_id = ?", (account["id"],))
            connection.execute("UPDATE sms_challenges SET state = 'expired' WHERE role = ? AND account_id = ? AND id != ? AND state != 'consumed'",
                               (role, account["id"], challenge_id))
    except sqlite3.IntegrityError:
        raise HTTPException(409, "该手机号无法绑定，请联系管理员") from None
