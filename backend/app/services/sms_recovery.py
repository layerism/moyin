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
        CREATE TABLE IF NOT EXISTS password_recoveries (
            token_hash TEXT PRIMARY KEY, role TEXT NOT NULL, account_id INTEGER,
            phone TEXT, password_version TEXT NOT NULL, ip TEXT NOT NULL,
            created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
            state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
            reset_token_hash TEXT UNIQUE
        );
        CREATE INDEX IF NOT EXISTS recovery_ip_time ON password_recoveries(ip, created_at);
        CREATE INDEX IF NOT EXISTS sms_phone_time ON sms_challenges(phone, created_at);
        CREATE INDEX IF NOT EXISTS sms_ip_time ON sms_challenges(ip, created_at);
    """)

    columns = {row["name"] for row in connection.execute("PRAGMA table_info(sms_challenges)")}
    if "recovery_hash" not in columns:
        connection.execute("ALTER TABLE sms_challenges ADD COLUMN recovery_hash TEXT")


def version(row: sqlite3.Row) -> str:
    return hashlib.sha256(row["password_hash"].encode()).hexdigest()


def active(row: sqlite3.Row | None, role: str) -> bool:
    return bool(row and row["status"] == "active"
                and (role != "student" or row["account_kind"] == "normal"))


def scheme(role: str, purpose: str) -> str:
    return f"moyin-{role}-{purpose}"


def send_code(role: str, purpose: str, phone: str, ip: str, recovery_token: str = "",
              account_id: int | None = None, password: str = "") -> dict:
    # Check configuration even for unknown identities, keeping public responses uniform.
    pnvs.client()
    now = int(time.time())
    challenge_id = secrets.token_urlsafe(32)
    table, _ = TABLES[role]
    recovery_hash = token_hash(recovery_token) if purpose == "reset" else None
    if recovery_hash:
        authorize_recovery_phone(role, recovery_hash, phone)
    authorization_error = None
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
                authorization_error = "当前密码不正确或账号已失效"
            elif role == "student" and row["must_change_password"]:
                authorization_error = "请先修改初始密码，再绑定手机号"
            elif row["phone"] == phone:
                authorization_error = "新手机号不能与当前绑定号码相同"
            elif connection.execute(f"SELECT id FROM {table} WHERE phone = ?", (phone,)).fetchone():
                authorization_error = "该手机号无法绑定，请联系管理员"
            if authorization_error:
                row = None
        elif purpose == "change":
            row = connection.execute(f"SELECT * FROM {table} WHERE id = ?", (account_id,)).fetchone()
            if not active(row, role):
                authorization_error = "账号已失效，请重新登录"
            elif role == "student" and row["must_change_password"]:
                authorization_error = "请先修改初始密码"
            elif not row["phone"] or not row["phone_verified_at"] or row["phone"] != phone:
                authorization_error = "请先绑定安全手机号"
            if authorization_error:
                row = None
        else:
            recovery, row = recovery_account(connection, role, recovery_hash, "identified")
        connection.execute("UPDATE sms_challenges SET state = 'expired' WHERE phone = ? AND role = ? AND purpose = ? AND state != 'consumed'",
                           (phone, role, purpose))
        connection.execute("""INSERT INTO sms_challenges
            (id,role,purpose,account_id,phone,ip,password_version,created_at,expires_at,state,recovery_hash)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (challenge_id, role, purpose, row["id"] if row else None, phone, ip,
             version(row) if row else "", now, now + 300, "pending", recovery_hash))
    if authorization_error:
        raise HTTPException(400, authorization_error, headers={"Retry-After": "60"})
    if row:
        try:
            pnvs.send(phone, scheme(role, purpose), challenge_id)
        except HTTPException:
            with get_connection() as connection:
                connection.execute("UPDATE sms_challenges SET state = 'failed' WHERE id = ?", (challenge_id,))
            raise HTTPException(503, "短信发送未成功，请稍后重试", headers={"Retry-After": "60"}) from None
    with get_connection() as connection:
        connection.execute("UPDATE sms_challenges SET state = 'ready' WHERE id = ? AND state = 'pending'", (challenge_id,))
    return {"challengeId": challenge_id, "retryAfter": 60}


def complete(role: str, purpose: str, challenge_id: str, code: str,
             account_id: int | None = None, new_password: str = "") -> dict:
    now = int(time.time())
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT * FROM sms_challenges WHERE id = ? AND role = ? AND purpose = ?",
                                 (challenge_id, role, purpose)).fetchone()
        if (not row or row["state"] != "ready" or row["expires_at"] <= now
                or row["attempts"] >= 5
                or (purpose in ("bind", "change") and row["account_id"] != account_id)):
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
    reset_token = secrets.token_urlsafe(32) if purpose == "reset" else None
    password_hash = hash_password(new_password) if purpose == "change" else None
    try:
        with get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            account = connection.execute(f"SELECT * FROM {table} WHERE id = ?", (row["account_id"],)).fetchone()
            if (not active(account, role) or version(account) != row["password_version"]
                    or (purpose in ("reset", "change")
                        and (account["phone"] != row["phone"] or not account["phone_verified_at"]))
                    or (purpose == "change" and role == "student" and account["must_change_password"])):
                raise HTTPException(400, INVALID)
            changed = connection.execute("UPDATE sms_challenges SET state = 'consumed' WHERE id = ? AND state = 'checking' AND expires_at > ?",
                                         (challenge_id, int(time.time()))).rowcount
            if not changed:
                raise HTTPException(400, INVALID)
            if purpose == "bind":
                connection.execute(f"UPDATE {table} SET phone = ?, phone_verified_at = ?, updated_at = ? WHERE id = ?",
                                   (row["phone"], utc_now_iso(), utc_now_iso(), account["id"]))
                connection.execute("UPDATE password_recoveries SET state = 'expired' WHERE role = ? AND account_id = ? AND state != 'consumed'",
                                   (role, account["id"]))
            elif purpose == "reset":
                recovery_account(connection, role, row["recovery_hash"], "identified")
                connection.execute("""UPDATE password_recoveries SET state = 'verified',
                    reset_token_hash = ?, expires_at = ? WHERE token_hash = ?""",
                    (token_hash(reset_token), int(time.time()) + 300, row["recovery_hash"]))
            else:
                if verify_password(new_password, account["password_hash"]):
                    raise HTTPException(422, "新密码不能与当前密码相同")
                connection.execute(f"UPDATE {table} SET password_hash = ?, updated_at = ? WHERE id = ?",
                                   (password_hash, utc_now_iso(), account["id"]))
                connection.execute(f"DELETE FROM {role}_sessions WHERE {role}_account_id = ?", (account["id"],))
                connection.execute("UPDATE password_recoveries SET state = 'expired' WHERE role = ? AND account_id = ? AND state != 'consumed'",
                                   (role, account["id"]))
            connection.execute("UPDATE sms_challenges SET state = 'expired' WHERE role = ? AND account_id = ? AND id != ? AND state != 'consumed'",
                               (role, account["id"], challenge_id))
    except sqlite3.IntegrityError:
        raise HTTPException(409, "该手机号无法绑定，请联系管理员") from None

    if reset_token:
        return {"resetToken": reset_token}
    return {"message": "密码已修改，请重新登录" if purpose == "change" else "手机号已绑定，可用于找回密码"}


def send_change_code(role: str, account_id: int, ip: str) -> dict:
    table, _ = TABLES[role]
    with get_connection() as connection:
        account = connection.execute(f"SELECT * FROM {table} WHERE id = ?", (account_id,)).fetchone()
        if not active(account, role):
            raise HTTPException(400, "账号已失效，请重新登录")
        if not account["phone"] or not account["phone_verified_at"]:
            raise HTTPException(400, "请先绑定安全手机号")
        phone = account["phone"]
    return send_code(role, "change", phone, ip, account_id=account_id)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def identify_account(role: str, name: str, identifier: str, ip: str) -> dict:
    now = int(time.time())
    token = secrets.token_urlsafe(32)
    table, column = TABLES[role]
    error = None
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("DELETE FROM password_recoveries WHERE created_at < ?", (now - 86400,))
        count = connection.execute("SELECT COUNT(*) FROM password_recoveries WHERE ip = ? AND created_at > ?", (ip, now - 3600)).fetchone()[0]
        if count >= 30:
            raise HTTPException(429, "查询过于频繁，请稍后重试", headers={"Retry-After": "3600"})
        account = connection.execute(f"SELECT * FROM {table} WHERE {column} = ? AND name = ?",
                                     (identifier.strip(), name.strip())).fetchone()
        if not active(account, role):
            error = "未找到匹配的注册用户，请检查姓名和账号"
        elif not account["phone"] or not account["phone_verified_at"]:
            error = "该账号尚未绑定手机号，请联系管理员恢复密码"
        connection.execute("""INSERT INTO password_recoveries
            (token_hash,role,account_id,phone,password_version,ip,created_at,expires_at,state)
            VALUES (?,?,?,?,?,?,?,?,?)""", (token_hash(token), role,
            account["id"] if not error else None, account["phone"] if not error else None,
            version(account) if not error else "", ip, now, now + 900,
            "identified" if not error else "rejected"))
    if error:
        raise HTTPException(400, error)
    return {"recoveryToken": token}


def recovery_account(connection, role: str, recovery_hash: str, state: str):
    recovery = connection.execute("SELECT * FROM password_recoveries WHERE token_hash = ? AND role = ?",
                                  (recovery_hash, role)).fetchone()
    if not recovery or recovery["state"] != state or recovery["expires_at"] <= int(time.time()):
        raise HTTPException(400, "找回流程已失效，请重新确认身份")
    table, _ = TABLES[role]
    account = connection.execute(f"SELECT * FROM {table} WHERE id = ?", (recovery["account_id"],)).fetchone()
    if (not active(account, role) or version(account) != recovery["password_version"]
            or account["phone"] != recovery["phone"] or not account["phone_verified_at"]):
        raise HTTPException(400, "账号信息已变化，请重新确认身份")
    return recovery, account


def authorize_recovery_phone(role: str, recovery_hash: str, phone: str) -> None:
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        recovery, _ = recovery_account(connection, role, recovery_hash, "identified")
        if recovery["attempts"] >= 10:
            raise HTTPException(400, "尝试次数过多，请重新确认身份")
        connection.execute("UPDATE password_recoveries SET attempts = attempts + 1 WHERE token_hash = ?", (recovery_hash,))
        matches = secrets.compare_digest(recovery["phone"], phone)
    if not matches:
        raise HTTPException(400, "请输入该账号已绑定的手机号")


def reset_password(role: str, reset_token: str, new_password: str) -> None:
    password_hash = hash_password(new_password)
    table, _ = TABLES[role]
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        recovery = connection.execute("SELECT token_hash FROM password_recoveries WHERE reset_token_hash = ? AND role = ?",
                                      (token_hash(reset_token), role)).fetchone()
        if not recovery:
            raise HTTPException(400, "重置凭证无效，请重新验证手机号")
        recovery, account = recovery_account(connection, role, recovery["token_hash"], "verified")
        connection.execute("UPDATE password_recoveries SET state = 'consumed' WHERE token_hash = ?", (recovery["token_hash"],))
        extra = ", must_change_password = 0"
        connection.execute(f"UPDATE {table} SET password_hash = ?, updated_at = ?{extra} WHERE id = ?",
                           (password_hash, utc_now_iso(), account["id"]))
        connection.execute(f"DELETE FROM {role}_sessions WHERE {role}_account_id = ?", (account["id"],))
        connection.execute("UPDATE password_recoveries SET state = 'expired' WHERE role = ? AND account_id = ? AND state != 'consumed'", (role, account["id"]))
        connection.execute("UPDATE sms_challenges SET state = 'expired' WHERE role = ? AND account_id = ? AND state != 'consumed'", (role, account["id"]))
