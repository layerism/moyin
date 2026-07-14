import json
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.core.database import get_connection


@dataclass(frozen=True)
class TablePolicy:
    editable_columns: frozenset[str] = frozenset()


TABLE_POLICIES: dict[str, TablePolicy] = {
    "audit_logs": TablePolicy(),
    "flow_instances": TablePolicy(frozenset({"status", "completed_at", "last_active_at"})),
    "flow_node_runtime_configs": TablePolicy(frozenset({"deadline_at"})),
    "flow_versions": TablePolicy(),
    "flows": TablePolicy(
        frozenset({"name", "description", "owner_id", "status", "draft_config"})
    ),
    "node_drafts": TablePolicy(frozenset({"payload"})),
    "node_instances": TablePolicy(
        frozenset({"status", "opened_at", "submitted_at", "approved_at", "attempt_no"})
    ),
    "share_tokens": TablePolicy(frozenset({"status", "expires_at"})),
    "student_accounts": TablePolicy(frozenset({"student_no", "name", "status"})),
    "student_deadline_overrides": TablePolicy(frozenset({"deadline_at", "reason"})),
    "student_sessions": TablePolicy(),
    "submissions": TablePolicy(frozenset({"status"})),
    "teacher_accounts": TablePolicy(frozenset({"employee_no", "name", "status"})),
    "teacher_sessions": TablePolicy(),
}

SENSITIVE_COLUMNS = frozenset({"password_hash", "token_hash"})
REDACTED_VALUE = "******"


class DatabaseAdminError(ValueError):
    pass


def list_admin_tables() -> list[dict[str, object]]:
    with get_connection() as connection:
        result = []
        for name, policy in TABLE_POLICIES.items():
            row_count = connection.execute(f'SELECT COUNT(*) AS count FROM "{name}"').fetchone()[
                "count"
            ]
            result.append(
                {
                    "name": name,
                    "rowCount": row_count,
                    "editableColumns": sorted(policy.editable_columns),
                }
            )
    return result


def get_admin_table_schema(table: str) -> dict[str, object]:
    policy = _policy(table)
    with get_connection() as connection:
        columns = connection.execute(f'PRAGMA table_info("{table}")').fetchall()
    return {
        "name": table,
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
    _policy(table)
    with get_connection() as connection:
        primary_keys = _primary_keys(connection, table)
        order_clause = ", ".join(f'"{column}"' for column in primary_keys) or "rowid"
        rows = connection.execute(
            f'SELECT * FROM "{table}" ORDER BY {order_clause} LIMIT ? OFFSET ?',
            (limit, offset),
        ).fetchall()
        total = connection.execute(f'SELECT COUNT(*) AS count FROM "{table}"').fetchone()["count"]
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
    policy = _policy(table)
    requested_columns = set(changes)
    if not requested_columns:
        raise DatabaseAdminError("没有需要保存的字段")
    forbidden = requested_columns - policy.editable_columns
    if forbidden:
        raise DatabaseAdminError(f"字段不可编辑：{', '.join(sorted(forbidden))}")

    with get_connection() as connection:
        primary_keys = _primary_keys(connection, table)
    if not primary_keys or set(key) != set(primary_keys):
        raise DatabaseAdminError("必须提供完整的主键")

    _backup_database()
    where_clause = " AND ".join(f'"{column}" = ?' for column in primary_keys)
    set_clause = ", ".join(f'"{column}" = ?' for column in changes)
    key_values = [key[column] for column in primary_keys]
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        before = connection.execute(
            f'SELECT * FROM "{table}" WHERE {where_clause}', key_values
        ).fetchone()
        if before is None:
            raise KeyError(table)
        connection.execute(
            f'UPDATE "{table}" SET {set_clause} WHERE {where_clause}',
            [*changes.values(), *key_values],
        )
        after = connection.execute(
            f'SELECT * FROM "{table}" WHERE {where_clause}', key_values
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


def _policy(table: str) -> TablePolicy:
    policy = TABLE_POLICIES.get(table)
    if policy is None:
        raise KeyError(table)
    return policy


def _primary_keys(connection: sqlite3.Connection, table: str) -> list[str]:
    rows = connection.execute(f'PRAGMA table_info("{table}")').fetchall()
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
