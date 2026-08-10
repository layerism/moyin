import json
import sqlite3
from typing import Any

from app.core.database import get_connection
from app.services.security import utc_now_iso


class RosterValidationError(ValueError):
    pass


class RosterAccessError(PermissionError):
    pass


def assert_student_roster_access(
    connection: sqlite3.Connection, flow_id: str, student_id: int
) -> None:
    preview = connection.execute(
        """
        SELECT 1
        FROM student_accounts a
        JOIN flow_preview_sessions p ON p.preview_student_account_id = a.id
        JOIN flows f ON f.id = p.flow_id
        WHERE a.id = ? AND p.flow_id = ? AND a.account_kind = 'preview'
          AND a.preview_owner_teacher_id = p.teacher_account_id
          AND f.owner_id = CAST(p.teacher_account_id AS TEXT)
          AND p.status = 'active' AND p.expires_at > ?
        LIMIT 1
        """,
        (student_id, flow_id, utc_now_iso()),
    ).fetchone()
    if preview is not None:
        return
    row = connection.execute(
        """
        SELECT 1
        FROM student_accounts a
        JOIN flow_roster_entries r
          ON r.student_no = a.student_no AND r.name = a.name
        WHERE a.id = ? AND r.flow_id = ? AND r.status = 'active'
        LIMIT 1
        """,
        (student_id, flow_id),
    ).fetchone()
    if row is None:
        raise RosterAccessError("你不在该流程的有效学生名单中")


def _ensure_owned_flow(
    connection: sqlite3.Connection, flow_id: str, teacher_id: int
) -> None:
    row = connection.execute(
        "SELECT 1 FROM flows WHERE id = ? AND owner_id = ?",
        (flow_id, str(teacher_id)),
    ).fetchone()
    if row is None:
        raise KeyError(flow_id)


def _roster_payload(connection: sqlite3.Connection, flow_id: str) -> dict[str, object]:
    rows = connection.execute(
        """
        SELECT id, student_no, name, status, created_at, updated_at
        FROM flow_roster_entries
        WHERE flow_id = ?
        ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, student_no
        """,
        (flow_id,),
    ).fetchall()
    entries = [
        {
            "id": row["id"],
            "studentNo": row["student_no"],
            "name": row["name"],
            "status": row["status"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ]
    return {
        "entries": entries,
        "activeCount": sum(entry["status"] == "active" for entry in entries),
        "revokedCount": sum(entry["status"] == "revoked" for entry in entries),
    }


def list_roster(flow_id: str, teacher_id: int) -> dict[str, object]:
    with get_connection() as connection:
        _ensure_owned_flow(connection, flow_id, teacher_id)
        return _roster_payload(connection, flow_id)


def _normalize_entries(entries: list[dict[str, Any]]) -> list[dict[str, str]]:
    by_student_no: dict[str, str] = {}
    for entry in entries:
        student_no = str(entry.get("studentNo", "")).strip()
        name = str(entry.get("name", "")).strip()
        if not student_no or not name:
            raise RosterValidationError("姓名和学号不能为空")
        existing_name = by_student_no.get(student_no)
        if existing_name is not None and existing_name != name:
            raise RosterValidationError(f"学号 {student_no} 在导入名单中对应多个姓名")
        by_student_no[student_no] = name
    return [
        {"studentNo": student_no, "name": name}
        for student_no, name in by_student_no.items()
    ]


def import_roster(
    flow_id: str,
    teacher_id: int,
    entries: list[dict[str, Any]],
    source_file_name: str,
) -> dict[str, object]:
    normalized = _normalize_entries(entries)
    now = utc_now_iso()
    summary = {"added": 0, "restored": 0, "updated": 0}
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        _ensure_owned_flow(connection, flow_id, teacher_id)
        for entry in normalized:
            existing = connection.execute(
                """
                SELECT id, name, status FROM flow_roster_entries
                WHERE flow_id = ? AND student_no = ?
                """,
                (flow_id, entry["studentNo"]),
            ).fetchone()
            if existing is None:
                connection.execute(
                    """
                    INSERT INTO flow_roster_entries
                        (flow_id, student_no, name, status, created_at, updated_at, updated_by)
                    VALUES (?, ?, ?, 'active', ?, ?, ?)
                    """,
                    (
                        flow_id,
                        entry["studentNo"],
                        entry["name"],
                        now,
                        now,
                        str(teacher_id),
                    ),
                )
                summary["added"] += 1
                continue
            if existing["status"] == "revoked":
                summary["restored"] += 1
            elif existing["name"] != entry["name"]:
                summary["updated"] += 1
            connection.execute(
                """
                UPDATE flow_roster_entries
                SET name = ?, status = 'active', updated_at = ?, updated_by = ?
                WHERE id = ?
                """,
                (entry["name"], now, str(teacher_id), existing["id"]),
            )
        connection.execute(
            """
            INSERT INTO audit_logs
                (actor_id, action, entity_type, entity_id, after_data, created_at)
            VALUES (?, 'roster_import', 'flow_roster', ?, ?, ?)
            """,
            (
                str(teacher_id),
                flow_id,
                json.dumps(
                    {**summary, "sourceFileName": source_file_name.strip()},
                    ensure_ascii=False,
                    sort_keys=True,
                ),
                now,
            ),
        )
        result = _roster_payload(connection, flow_id)
    return {**result, "summary": summary}


def revoke_roster_entry(
    flow_id: str, entry_id: int, teacher_id: int
) -> dict[str, object]:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        _ensure_owned_flow(connection, flow_id, teacher_id)
        existing = connection.execute(
            """
            SELECT student_no, name, status FROM flow_roster_entries
            WHERE id = ? AND flow_id = ?
            """,
            (entry_id, flow_id),
        ).fetchone()
        if existing is None:
            raise KeyError(entry_id)
        if existing["status"] != "revoked":
            connection.execute(
                """
                UPDATE flow_roster_entries
                SET status = 'revoked', updated_at = ?, updated_by = ?
                WHERE id = ?
                """,
                (now, str(teacher_id), entry_id),
            )
            connection.execute(
                """
                INSERT INTO audit_logs
                    (actor_id, action, entity_type, entity_id, before_data, after_data, created_at)
                VALUES (?, 'roster_revoke', 'flow_roster', ?, ?, ?, ?)
                """,
                (
                    str(teacher_id),
                    f"{flow_id}:{entry_id}",
                    json.dumps(dict(existing), ensure_ascii=False, sort_keys=True),
                    json.dumps(
                        {
                            "name": existing["name"],
                            "status": "revoked",
                            "student_no": existing["student_no"],
                        },
                        ensure_ascii=False,
                        sort_keys=True,
                    ),
                    now,
                ),
            )
        return _roster_payload(connection, flow_id)
