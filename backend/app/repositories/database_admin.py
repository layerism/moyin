import json
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.core.database import get_connection
from app.services.security import hash_password, utc_now_iso


@dataclass(frozen=True)
class TablePolicy:
    editable_columns: frozenset[str] = frozenset()
    deletable: bool = False


TABLE_POLICIES: dict[str, TablePolicy] = {
    "answer_sheet_drafts": TablePolicy(),
    "answer_sheet_grades": TablePolicy(),
    "audit_logs": TablePolicy(deletable=True),
    "flow_instances": TablePolicy(
        frozenset({"status", "completed_at", "last_active_at"}), deletable=True
    ),
    "flow_roster_entries": TablePolicy(
        frozenset({"student_no", "name", "status"}), deletable=True
    ),
    "flow_node_runtime_configs": TablePolicy(
        frozenset({"deadline_at"}), deletable=True
    ),
    "flow_content_assets": TablePolicy(),
    "flow_version_answer_keys": TablePolicy(),
    "flow_version_content_assets": TablePolicy(),
    "flow_versions": TablePolicy(deletable=True),
    "flows": TablePolicy(
        frozenset({"name", "description", "owner_id", "status", "draft_config"}),
        deletable=True,
    ),
    "node_drafts": TablePolicy(frozenset({"payload"}), deletable=True),
    "node_instances": TablePolicy(
        frozenset({"status", "opened_at", "submitted_at", "approved_at", "attempt_no"}),
        deletable=True,
    ),
    "share_tokens": TablePolicy(frozenset({"status", "expires_at"}), deletable=True),
    "student_accounts": TablePolicy(
        frozenset({"student_no", "name", "status"}), deletable=True
    ),
    "student_deadline_overrides": TablePolicy(
        frozenset({"deadline_at", "reason"}), deletable=True
    ),
    "student_sessions": TablePolicy(deletable=True),
    "submissions": TablePolicy(frozenset({"status"}), deletable=True),
    "teacher_accounts": TablePolicy(
        frozenset({"employee_no", "name", "status"}), deletable=True
    ),
    "teacher_sessions": TablePolicy(deletable=True),
}

SENSITIVE_COLUMNS = frozenset({
    "grading_config",
    "grading_snapshot",
    "password_hash",
    "token_hash",
    "token_value",
})
REDACTED_VALUE = "******"


class DatabaseAdminError(ValueError):
    pass


def list_admin_tables() -> list[dict[str, object]]:
    with get_connection() as connection:
        result = []
        for name in _table_names(connection):
            policy = TABLE_POLICIES.get(name, TablePolicy())
            row_count = connection.execute(
                f"SELECT COUNT(*) AS count FROM {_quoted_identifier(name)}"
            ).fetchone()["count"]
            result.append(
                {
                    "name": name,
                    "rowCount": row_count,
                    "editableColumns": sorted(policy.editable_columns),
                    "deletable": policy.deletable,
                }
            )
    return result


def get_admin_table_schema(table: str) -> dict[str, object]:
    with get_connection() as connection:
        policy = _policy(connection, table)
        columns = connection.execute(
            f"PRAGMA table_info({_quoted_identifier(table)})"
        ).fetchall()
    return {
        "name": table,
        "deletable": policy.deletable,
        "columns": [
            {
                "name": row["name"],
                "type": row["type"],
                "nullable": not bool(row["notnull"]),
                "primaryKey": bool(row["pk"]),
                "editable": row["name"] in policy.editable_columns,
                "sensitive": row["name"] in SENSITIVE_COLUMNS,
            }
            for row in columns
        ],
    }


def list_admin_rows(table: str, limit: int, offset: int) -> dict[str, object]:
    with get_connection() as connection:
        _policy(connection, table)
        primary_keys = _primary_keys(connection, table)
        order_clause = (
            ", ".join(_quoted_identifier(column) for column in primary_keys) or "rowid"
        )
        rows = connection.execute(
            f"SELECT * FROM {_quoted_identifier(table)} "
            f"ORDER BY {order_clause} LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
        total = connection.execute(
            f"SELECT COUNT(*) AS count FROM {_quoted_identifier(table)}"
        ).fetchone()["count"]
    return {
        "rows": [_redact_row(dict(row)) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def update_admin_row(
    table: str,
    key: dict[str, Any],
    changes: dict[str, Any],
    reason: str,
    actor_id: int,
) -> dict[str, object]:
    with get_connection() as connection:
        policy = _policy(connection, table)
        requested_columns = set(changes)
        if not requested_columns:
            raise DatabaseAdminError("没有需要保存的字段")
        forbidden = requested_columns - policy.editable_columns
        if forbidden:
            raise DatabaseAdminError(f"字段不可编辑：{', '.join(sorted(forbidden))}")
        primary_keys = _primary_keys(connection, table)
    if not primary_keys or set(key) != set(primary_keys):
        raise DatabaseAdminError("必须提供完整的主键")

    _backup_database()
    where_clause = " AND ".join(
        f"{_quoted_identifier(column)} = ?" for column in primary_keys
    )
    set_clause = ", ".join(
        f"{_quoted_identifier(column)} = ?" for column in changes
    )
    key_values = [key[column] for column in primary_keys]
    with get_connection() as connection:
        _policy(connection, table)
        connection.execute("BEGIN IMMEDIATE")
        before = connection.execute(
            f"SELECT * FROM {_quoted_identifier(table)} WHERE {where_clause}", key_values
        ).fetchone()
        if before is None:
            raise KeyError(table)
        connection.execute(
            f"UPDATE {_quoted_identifier(table)} SET {set_clause} WHERE {where_clause}",
            [*changes.values(), *key_values],
        )
        after = connection.execute(
            f"SELECT * FROM {_quoted_identifier(table)} WHERE {where_clause}", key_values
        ).fetchone()
        redacted_before = _redact_row(dict(before))
        redacted_after = _redact_row(dict(after))
        connection.execute(
            """
            INSERT INTO audit_logs
                (actor_id, action, entity_type, entity_id, before_data, after_data, reason, created_at)
            VALUES (?, 'admin_update', ?, ?, ?, ?, ?, ?)
            """,
            (
                str(actor_id),
                f"database:{table}",
                json.dumps(key, ensure_ascii=False, sort_keys=True),
                json.dumps(redacted_before, ensure_ascii=False, sort_keys=True),
                json.dumps(redacted_after, ensure_ascii=False, sort_keys=True),
                reason.strip(),
                datetime.now(UTC).isoformat(),
            ),
        )
    return {"row": redacted_after, "backupCreated": True}


def delete_admin_row(
    table: str,
    key: dict[str, Any],
    reason: str,
    actor_id: int,
) -> dict[str, object]:
    with get_connection() as connection:
        policy = _policy(connection, table)
        if not policy.deletable:
            raise DatabaseAdminError("该数据表仅供查看，不能删除记录")
        primary_keys = _primary_keys(connection, table)
    if not primary_keys or set(key) != set(primary_keys):
        raise DatabaseAdminError("必须提供完整的主键")
    if not reason.strip():
        raise DatabaseAdminError("请填写删除原因")

    _backup_database()
    where_clause = " AND ".join(
        f"{_quoted_identifier(column)} = ?" for column in primary_keys
    )
    key_values = [key[column] for column in primary_keys]
    try:
        with get_connection() as connection:
            policy = _policy(connection, table)
            if not policy.deletable:
                raise DatabaseAdminError("该数据表仅供查看，不能删除记录")
            connection.execute("BEGIN IMMEDIATE")
            before = connection.execute(
                f"SELECT * FROM {_quoted_identifier(table)} WHERE {where_clause}", key_values
            ).fetchone()
            if before is None:
                raise KeyError(table)
            redacted_before = _redact_row(dict(before))
            connection.execute(
                f"DELETE FROM {_quoted_identifier(table)} WHERE {where_clause}", key_values
            )
            connection.execute(
                """
                INSERT INTO audit_logs
                    (actor_id, action, entity_type, entity_id, before_data, after_data, reason, created_at)
                VALUES (?, 'admin_delete', ?, ?, ?, NULL, ?, ?)
                """,
                (
                    str(actor_id),
                    f"database:{table}",
                    json.dumps(key, ensure_ascii=False, sort_keys=True),
                    json.dumps(redacted_before, ensure_ascii=False, sort_keys=True),
                    reason.strip(),
                    datetime.now(UTC).isoformat(),
                ),
            )
    except sqlite3.IntegrityError as exc:
        raise DatabaseAdminError("该记录存在受保护的关联数据，无法删除") from exc
    return {"deleted": True, "backupCreated": True}


def reset_student_password(
    student_id: int,
    reason: str,
    actor_id: int,
) -> dict[str, object]:
    if not reason.strip():
        raise DatabaseAdminError("请填写重置原因")

    _backup_database()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        account = connection.execute(
            """
            SELECT id, student_no, name, account_kind, must_change_password
            FROM student_accounts
            WHERE id = ?
            """,
            (student_id,),
        ).fetchone()
        if account is None:
            raise KeyError(student_id)
        if account["account_kind"] != "normal":
            raise DatabaseAdminError("预览学生账号不能重置密码")

        session_count = int(
            connection.execute(
                """
                SELECT COUNT(*) AS count
                FROM student_sessions
                WHERE student_account_id = ?
                """,
                (student_id,),
            ).fetchone()["count"]
        )
        now = utc_now_iso()
        connection.execute(
            """
            UPDATE student_accounts
            SET password_hash = ?, must_change_password = 1, updated_at = ?
            WHERE id = ?
            """,
            (hash_password("123"), now, student_id),
        )
        connection.execute(
            "DELETE FROM student_sessions WHERE student_account_id = ?",
            (student_id,),
        )
        before_data = {
            "studentNo": account["student_no"],
            "name": account["name"],
            "mustChangePassword": bool(account["must_change_password"]),
            "activeSessionCount": session_count,
        }
        after_data = {
            "studentNo": account["student_no"],
            "name": account["name"],
            "mustChangePassword": True,
            "sessionsInvalidated": session_count,
        }
        connection.execute(
            """
            INSERT INTO audit_logs
                (actor_id, action, entity_type, entity_id,
                 before_data, after_data, reason, created_at)
            VALUES (?, 'student_password_reset', 'student_account', ?, ?, ?, ?, ?)
            """,
            (
                str(actor_id),
                str(student_id),
                json.dumps(before_data, ensure_ascii=False, sort_keys=True),
                json.dumps(after_data, ensure_ascii=False, sort_keys=True),
                reason.strip(),
                now,
            ),
        )
    return {"reset": True, "backupCreated": True}


def _table_names(connection: sqlite3.Connection) -> list[str]:
    rows = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    ).fetchall()
    return [str(row["name"]) for row in rows]


def _policy(connection: sqlite3.Connection, table: str) -> TablePolicy:
    if table not in _table_names(connection):
        raise KeyError(table)
    return TABLE_POLICIES.get(table, TablePolicy())


def _quoted_identifier(value: str) -> str:
    escaped = value.replace('"', '""')
    return f'"{escaped}"'


def _primary_keys(connection: sqlite3.Connection, table: str) -> list[str]:
    rows = connection.execute(f"PRAGMA table_info({_quoted_identifier(table)})").fetchall()
    return [row["name"] for row in sorted(rows, key=lambda row: row["pk"]) if row["pk"]]


def _redact_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        key: REDACTED_VALUE if key in SENSITIVE_COLUMNS and value is not None else value
        for key, value in row.items()
    }


def _backup_database() -> None:
    source_path = Path(settings.database_path)
    backup_root = source_path.parent / "admin-backups"
    backup_root.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    destination_path = backup_root / f"app-{timestamp}-{uuid.uuid4().hex[:8]}.db"
    with get_connection() as source, sqlite3.connect(destination_path) as destination:
        source.backup(destination)
