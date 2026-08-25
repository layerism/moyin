import pytest

from app.domain.answer_sheet import (
    AnswerSheetConfigError,
    AnswerSheetSubmissionError,
    grade_answer_sheet,
    normalize_answer_sheet_submission,
    validate_private_answer_key,
    validate_public_answer_sheet,
)
from app.repositories.answer_sheet_grades import student_grade_view


def answer_sheet_node() -> dict[str, object]:
    return {
        "id": "quiz",
        "kind": "answer_sheet",
        "title": "函数测试",
        "answerSheet": {
            "schemaVersion": "1.0",
            "questions": [
                {
                    "id": "q1",
                    "type": "single_choice",
                    "content": "$$f(2)$$ 等于：",
                    "points": 2,
                    "required": True,
                    "options": [
                        {"id": "o1", "content": "2"},
                        {"id": "o2", "content": "4"},
                    ],
                },
                {
                    "id": "q2",
                    "type": "multiple_choice",
                    "content": "选择偶函数：",
                    "points": 3,
                    "required": True,
                    "options": [
                        {"id": "o1", "content": "$$x^2$$"},
                        {"id": "o2", "content": "$$x^3$$"},
                        {"id": "o3", "content": "$$|x|$$"},
                    ],
                },
                {
                    "id": "q3",
                    "type": "fill_blank",
                    "content": "英文 four 写作 [[blank:b1]]。",
                    "required": True,
                    "blanks": [{"id": "b1", "points": 3}],
                },
            ],
            "gradingPolicy": {
                "passingScore": 6,
                "maxAttempts": None,
                "feedback": "question_result",
            },
        },
    }


def answer_key() -> dict[str, object]:
    return {
        "schemaVersion": "1.0",
        "graderVersion": "answer-sheet-v1",
        "answers": {
            "q1": {"type": "single_choice", "correctOptionId": "o2"},
            "q2": {
                "type": "multiple_choice",
                "correctOptionIds": ["o1", "o3"],
                "mode": "exact_set",
            },
            "q3": {
                "type": "fill_blank",
                "blanks": {
                    "b1": {
                        "acceptedAnswers": ["four", "四"],
                        "caseSensitive": False,
                    }
                },
            },
        },
    }


def test_validates_matching_public_and_private_configs() -> None:
    node = answer_sheet_node()
    validate_public_answer_sheet(node, require_publishable=True)
    validate_private_answer_key(node, answer_key(), require_publishable=True)


def test_rejects_private_answer_for_unknown_option() -> None:
    key = answer_key()
    key["answers"]["q1"]["correctOptionId"] = "missing"

    with pytest.raises(AnswerSheetConfigError, match="正确选项不存在"):
        validate_private_answer_key(
            answer_sheet_node(), key, require_publishable=True
        )


def test_multiple_choice_requires_exact_set_but_ignores_order() -> None:
    payload = {
        "answers": {
            "q1": {"selectedOptionId": "o2"},
            "q2": {"selectedOptionIds": ["o3", "o1"]},
            "q3": {"blankValues": {"b1": "wrong"}},
        }
    }

    grade = grade_answer_sheet(answer_sheet_node(), answer_key(), payload)

    assert grade["score"] == 5
    assert grade["passed"] is False
    assert grade["questionResults"][1] == {
        "questionId": "q2",
        "awardedPoints": 3,
        "maxPoints": 3,
        "correct": True,
    }


def test_fill_blank_normalizes_nfc_trim_and_casefold() -> None:
    payload = {
        "answers": {
            "q1": {"selectedOptionId": "o1"},
            "q2": {"selectedOptionIds": ["o1"]},
            "q3": {"blankValues": {"b1": " Four \r\n"}},
        }
    }

    grade = grade_answer_sheet(answer_sheet_node(), answer_key(), payload)

    assert grade["questionResults"][2] == {
        "questionId": "q3",
        "awardedPoints": 3,
        "maxPoints": 3,
        "correct": True,
        "blankResults": [
            {
                "blankId": "b1",
                "awardedPoints": 3,
                "maxPoints": 3,
                "correct": True,
            }
        ],
    }


def test_rejects_client_supplied_score_fields() -> None:
    with pytest.raises(AnswerSheetSubmissionError) as exc_info:
        normalize_answer_sheet_submission(
            answer_sheet_node(), {"answers": {}, "score": 100}, strict=True
        )

    assert exc_info.value.field_errors == {"_payload": "答题数据包含未知字段"}


def test_draft_allows_missing_answers_but_rejects_unknown_question() -> None:
    assert normalize_answer_sheet_submission(
        answer_sheet_node(), {"answers": {}}, strict=False
    ) == {"answers": {}}

    with pytest.raises(AnswerSheetSubmissionError) as exc_info:
        normalize_answer_sheet_submission(
            answer_sheet_node(), {"answers": {"missing": {}}}, strict=False
        )

    assert exc_info.value.field_errors == {"missing": "题目标识无效"}


def test_optional_question_can_be_cleared_before_submit() -> None:
    node = answer_sheet_node()
    node["answerSheet"]["questions"][0]["required"] = False

    assert normalize_answer_sheet_submission(
        node,
        {"answers": {"q1": {"selectedOptionId": ""}}},
        strict=True,
    ) == {"answers": {}}


def test_student_feedback_never_exposes_key_before_deadline() -> None:
    payload = {
        "answers": {
            "q1": {"selectedOptionId": "o2"},
            "q2": {"selectedOptionIds": ["o1", "o3"]},
            "q3": {"blankValues": {"b1": "four"}},
        }
    }
    grade = grade_answer_sheet(answer_sheet_node(), answer_key(), payload)

    before_deadline = student_grade_view(
        grade,
        "full_after_deadline",
        answer_key=answer_key(),
        after_deadline=False,
    )
    after_deadline = student_grade_view(
        grade,
        "full_after_deadline",
        answer_key=answer_key(),
        after_deadline=True,
    )

    assert "standardAnswers" not in before_deadline
    assert after_deadline["standardAnswers"] == answer_key()["answers"]
