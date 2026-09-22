import json
from typing import Any


def _canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def insert_answer_sheet_grade(
    connection: Any,
    submission_id: str,
    grade: dict[str, Any],
    grading_hash: str,
    created_at: str,
) -> None:
    connection.execute(
        """
        INSERT INTO answer_sheet_grades
            (submission_id, score, max_score, passing_score, passed,
             grader_version, grading_hash, result_snapshot, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            submission_id,
            grade["score"],
            int(grade["maxScore"]),
            0,  # Compatibility with the legacy NOT NULL database column.
            int(bool(grade["passed"])),
            str(grade["graderVersion"]),
            grading_hash,
            _canonical_json(grade),
            created_at,
        ),
    )


def replace_answer_sheet_grade(
    connection: Any,
    submission_id: str,
    grade: dict[str, Any],
    grading_hash: str,
    teacher_id: int,
    replaced_at: str,
) -> None:
    current = connection.execute(
        "SELECT * FROM answer_sheet_grades WHERE submission_id = ?",
        (submission_id,),
    ).fetchone()
    if current is None:
        insert_answer_sheet_grade(
            connection, submission_id, grade, grading_hash, replaced_at
        )
        return
    connection.execute(
        """
        INSERT INTO answer_sheet_grade_history
            (submission_id, score, max_score, passing_score, passed,
             grader_version, grading_hash, result_snapshot, original_created_at,
             superseded_by, superseded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            submission_id,
            current["score"],
            current["max_score"],
            current["passing_score"],
            current["passed"],
            current["grader_version"],
            current["grading_hash"],
            current["result_snapshot"],
            current["created_at"],
            teacher_id,
            replaced_at,
        ),
    )
    connection.execute(
        """
        UPDATE answer_sheet_grades
        SET score = ?, max_score = ?, passing_score = 0, passed = ?,
            grader_version = ?, grading_hash = ?, result_snapshot = ?
        WHERE submission_id = ?
        """,
        (
            grade["score"],
            int(grade["maxScore"]),
            int(bool(grade["passed"])),
            str(grade["graderVersion"]),
            grading_hash,
            _canonical_json(grade),
            submission_id,
        ),
    )


def get_answer_sheet_grade(connection: Any, submission_id: str | None) -> dict[str, Any] | None:
    if not submission_id:
        return None
    row = connection.execute(
        """
        SELECT result_snapshot, grading_hash FROM answer_sheet_grades
        WHERE submission_id = ?
        """,
        (submission_id,),
    ).fetchone()
    if row is None:
        return None
    result = json.loads(row["result_snapshot"])
    result["gradingHash"] = str(row["grading_hash"])
    return result


def student_grade_view(
    grade: dict[str, Any] | None,
    feedback: str,
    *,
    answer_key: dict[str, Any] | None = None,
    after_deadline: bool = False,
) -> dict[str, Any] | None:
    if grade is None:
        return None
    visible = {
        "schemaVersion": grade.get("schemaVersion"),
        "graderVersion": grade.get("graderVersion"),
        "score": grade.get("score"),
        "maxScore": grade.get("maxScore"),
        "passed": grade.get("passed"),
    }
    if feedback != "score_only":
        visible["questionResults"] = grade.get("questionResults", [])
    if feedback == "full_after_deadline" and after_deadline and answer_key is not None:
        visible["standardAnswers"] = answer_key.get("answers", {})
    return visible
