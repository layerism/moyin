import json
from dataclasses import dataclass
from typing import Any

from app.core.database import get_connection
from app.domain.workflow_runtime import node_by_key
from app.repositories.answer_sheet_keys import get_version_answer_key

CURRENT_SUBMISSION_STATUSES = ("reviewing", "approved", "rejected", "audit_error")


class TeacherNodeExportError(ValueError):
    pass


class TeacherNodeExportConflictError(TeacherNodeExportError):
    pass


@dataclass(frozen=True)
class TeacherNodeExportFile:
    content_type: str
    original_name: str
    page_count: int
    size_bytes: int
    storage_key: str


@dataclass(frozen=True)
class TeacherNodeExportStudent:
    audit_job_status: str | None
    audit_params: dict[str, Any]
    audit_result: dict[str, Any]
    attempt_no: int | None
    files: tuple[TeacherNodeExportFile, ...]
    grade: dict[str, Any]
    name: str
    payload: dict[str, Any]
    roster_entry_id: int
    student_no: str
    submission_status: str | None
    submitted_at: str | None
    template_downloaded_at: str | None


@dataclass(frozen=True)
class TeacherNodeExportSelection:
    answer_key: dict[str, Any] | None
    flow_name: str
    node: dict[str, Any]
    students: tuple[TeacherNodeExportStudent, ...]


def _json_object(value: object) -> dict[str, Any]:
    if not isinstance(value, str) or not value:
        return {}
    parsed = json.loads(value)
    return parsed if isinstance(parsed, dict) else {}


def get_node_submission_export(
    version_id: str,
    node_key: str,
    teacher_id: int,
    roster_entry_ids: tuple[int, ...] | None = None,
) -> TeacherNodeExportSelection:
    with get_connection() as connection:
        version = connection.execute(
            """
            SELECT v.flow_id, v.config_snapshot, f.name
            FROM flow_versions v
            JOIN flows f ON f.id = v.flow_id
            WHERE v.id = ? AND v.status = 'published' AND f.owner_id = ?
            """,
            (version_id, str(teacher_id)),
        ).fetchone()
        if version is None:
            raise KeyError(version_id)

        config = json.loads(version["config_snapshot"])
        try:
            node = node_by_key(config, node_key)
        except KeyError as exc:
            raise TeacherNodeExportError("所选节点不属于当前发布版本") from exc

        roster_filter = ""
        roster_params: tuple[int, ...] = ()
        if roster_entry_ids is not None:
            if not roster_entry_ids:
                raise TeacherNodeExportError("请至少选择一名学生")
            placeholders = ", ".join("?" for _ in roster_entry_ids)
            roster_filter = f" AND r.id IN ({placeholders})"
            roster_params = roster_entry_ids

        rows = connection.execute(
            f"""
            SELECT r.id AS roster_entry_id, r.student_no, r.name,
                   s.id AS submission_id, s.status AS submission_status,
                   s.submitted_at, s.payload_snapshot,
                   n.attempt_no,
                   j.status AS audit_job_status, j.result_json,
                   j.effective_params_json,
                   g.result_snapshot AS answer_sheet_grade,
                   e.downloaded_at AS template_downloaded_at
            FROM flow_roster_entries r
            LEFT JOIN student_accounts a
              ON a.student_no = r.student_no AND a.name = r.name
             AND a.account_kind = 'normal'
            LEFT JOIN flow_instances i
              ON i.flow_version_id = ? AND i.student_account_id = a.id
            LEFT JOIN node_instances n
              ON n.flow_instance_id = i.id AND n.node_key = ?
            LEFT JOIN submissions s
              ON s.node_instance_id = n.id AND s.attempt_no = n.attempt_no
             AND s.status IN (?, ?, ?, ?)
            LEFT JOIN audit_jobs j ON j.submission_id = s.id
            LEFT JOIN answer_sheet_grades g ON g.submission_id = s.id
            LEFT JOIN flow_version_templates vt
              ON vt.flow_version_id = ? AND vt.node_key = ?
            LEFT JOIN template_download_events e
              ON e.node_instance_id = n.id
             AND e.template_asset_id = vt.template_asset_id
             AND e.student_account_id = a.id
            WHERE r.flow_id = ? AND r.status = 'active'{roster_filter}
            ORDER BY r.student_no
            """,
            (
                version_id,
                node_key,
                *CURRENT_SUBMISSION_STATUSES,
                version_id,
                node_key,
                version["flow_id"],
                *roster_params,
            ),
        ).fetchall()

        if roster_entry_ids is not None:
            requested_ids = set(roster_entry_ids)
            selected_ids = {int(row["roster_entry_id"]) for row in rows}
            if selected_ids != requested_ids:
                raise TeacherNodeExportConflictError("学生名单已发生变化，请刷新后重新选择")

        submission_ids = [str(row["submission_id"]) for row in rows if row["submission_id"]]
        files_by_submission: dict[str, list[TeacherNodeExportFile]] = {}
        if submission_ids:
            placeholders = ", ".join("?" for _ in submission_ids)
            file_rows = connection.execute(
                f"""
                SELECT submission_id, original_name, content_type, size_bytes,
                       page_count, storage_key
                FROM uploaded_files
                WHERE submission_id IN ({placeholders})
                ORDER BY submission_id, display_order, created_at, id
                """,
                tuple(submission_ids),
            ).fetchall()
            for file_row in file_rows:
                files_by_submission.setdefault(str(file_row["submission_id"]), []).append(
                    TeacherNodeExportFile(
                        content_type=str(file_row["content_type"]),
                        original_name=str(file_row["original_name"]),
                        page_count=int(file_row["page_count"]),
                        size_bytes=int(file_row["size_bytes"]),
                        storage_key=str(file_row["storage_key"]),
                    )
                )
        answer_key = (
            get_version_answer_key(connection, version_id, node_key)["gradingKey"]
            if node.get("kind") == "answer_sheet"
            else None
        )

    students = tuple(
        TeacherNodeExportStudent(
            audit_job_status=str(row["audit_job_status"]) if row["audit_job_status"] else None,
            audit_params=_json_object(row["effective_params_json"]),
            audit_result=_json_object(row["result_json"]),
            attempt_no=int(row["attempt_no"]) if row["submission_id"] else None,
            files=tuple(files_by_submission.get(str(row["submission_id"]), [])),
            grade=_json_object(row["answer_sheet_grade"]),
            name=str(row["name"]),
            payload=_json_object(row["payload_snapshot"]),
            roster_entry_id=int(row["roster_entry_id"]),
            student_no=str(row["student_no"]),
            submission_status=(
                str(row["submission_status"]) if row["submission_status"] else None
            ),
            submitted_at=str(row["submitted_at"]) if row["submitted_at"] else None,
            template_downloaded_at=(
                str(row["template_downloaded_at"])
                if row["template_downloaded_at"]
                else None
            ),
        )
        for row in rows
    )
    return TeacherNodeExportSelection(
        answer_key=answer_key,
        flow_name=str(version["name"]),
        node=dict(node),
        students=students,
    )
