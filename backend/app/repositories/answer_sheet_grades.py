"""Compute current grades without writing scores or changing submission state."""
from typing import Any

from app.domain.answer_sheet import grade_answer_sheet


def calculate_answer_sheet_grade(node: dict[str, Any], answer_key: dict[str, Any] | None,
                                 payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if node.get("kind") != "answer_sheet" or payload is None or answer_key is None:
        return None
    return grade_answer_sheet(node, answer_key, payload)


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
