import re
import unicodedata
from typing import Any


ANSWER_SHEET_GRADERS = {
    "1.0": "answer-sheet-v1",
    "2.0": "answer-sheet-v2",
}
QUESTION_TYPES = {"single_choice", "multiple_choice", "fill_blank"}
FEEDBACK_POLICIES = {"score_only", "question_result", "full_after_deadline"}
_ANSWER_SHEET_KEYS = {"schemaVersion", "questions", "gradingPolicy"}
_GRADING_POLICY_KEYS = {"passingScore", "maxAttempts", "feedback"}
_COMMON_QUESTION_KEYS = {"id", "type", "content", "required"}
_OPTION_KEYS = {"id", "content"}
_BLANK_KEYS = {"id", "points"}
_PRIVATE_KEY_KEYS = {"schemaVersion", "graderVersion", "answers"}
_BLANK_MARKER = re.compile(r"\[\[blank:([A-Za-z0-9_-]+)\]\]")
_MARKDOWN_IMAGE = re.compile(r"!\[[^\]]*\]\(\s*<?([^\s)>]+)>?[^)]*\)")
_CONTENT_ASSET_URL = re.compile(r"^asset://[A-Za-z0-9-]+$")
_LEGACY_BLANK_ANSWER_PLACEHOLDER = "请输入答案"


class AnswerSheetConfigError(ValueError):
    pass


class AnswerSheetSubmissionError(ValueError):
    def __init__(self, field_errors: dict[str, str]) -> None:
        super().__init__("答题内容未通过校验")
        self.field_errors = field_errors


def validate_public_answer_sheet(
    node: dict[str, Any], *, require_publishable: bool
) -> None:
    if node.get("kind") != "answer_sheet":
        return
    title = str(node.get("title") or "未命名答题卡")
    config = node.get("answerSheet")
    if not isinstance(config, dict) or set(config) != _ANSWER_SHEET_KEYS:
        raise AnswerSheetConfigError(f"答题卡“{title}”配置格式无效")
    schema_version = config.get("schemaVersion")
    if schema_version not in ANSWER_SHEET_GRADERS:
        raise AnswerSheetConfigError(f"答题卡“{title}”配置版本无效")

    questions = config.get("questions")
    if not isinstance(questions, list):
        raise AnswerSheetConfigError(f"答题卡“{title}”题目必须是数组")
    if require_publishable and not questions:
        raise AnswerSheetConfigError(f"答题卡“{title}”至少需要一道题")

    question_ids: set[str] = set()
    for index, question in enumerate(questions, start=1):
        _validate_public_question(
            title,
            index,
            question,
            question_ids,
            require_publishable,
            str(schema_version),
        )

    policy = config.get("gradingPolicy")
    if not isinstance(policy, dict) or set(policy) != _GRADING_POLICY_KEYS:
        raise AnswerSheetConfigError(f"答题卡“{title}”评分策略格式无效")
    passing_score = policy.get("passingScore")
    if type(passing_score) is not int or passing_score < 0:
        raise AnswerSheetConfigError(f"答题卡“{title}”及格分必须是非负整数")
    max_attempts = policy.get("maxAttempts")
    if max_attempts is not None and (
        type(max_attempts) is not int or not 1 <= max_attempts <= 99
    ):
        raise AnswerSheetConfigError(f"答题卡“{title}”作答次数必须为 1 到 99")
    if policy.get("feedback") not in FEEDBACK_POLICIES:
        raise AnswerSheetConfigError(f"答题卡“{title}”反馈策略无效")
    maximum = answer_sheet_max_score(node)
    if passing_score > maximum:
        raise AnswerSheetConfigError(f"答题卡“{title}”及格分不能超过总分")
    if policy.get("feedback") == "full_after_deadline" and require_publishable:
        if not node.get("deadlineAt"):
            raise AnswerSheetConfigError(
                f"答题卡“{title}”截止后展示答案时必须设置截止时间"
            )


def _validate_public_question(
    title: str,
    index: int,
    question: object,
    question_ids: set[str],
    require_publishable: bool,
    schema_version: str,
) -> None:
    prefix = f"答题卡“{title}”第 {index} 题"
    if not isinstance(question, dict):
        raise AnswerSheetConfigError(f"{prefix}格式无效")
    question_type = question.get("type")
    if question_type not in QUESTION_TYPES:
        raise AnswerSheetConfigError(f"{prefix}题型无效")
    single_markdown_fill = _is_single_markdown_question(question)
    if single_markdown_fill and schema_version != "2.0":
        raise AnswerSheetConfigError(f"{prefix}填空格式与协议版本不一致")
    expected_keys = _COMMON_QUESTION_KEYS | (
        {"format", "points"}
        if single_markdown_fill
        else {"blanks"}
        if question_type == "fill_blank"
        else {"points", "options"}
    )
    if set(question) != expected_keys:
        raise AnswerSheetConfigError(f"{prefix}包含未知或缺失配置")
    question_id = question.get("id")
    if not isinstance(question_id, str) or not question_id or question_id in question_ids:
        raise AnswerSheetConfigError(f"{prefix}标识无效或重复")
    question_ids.add(question_id)
    content = question.get("content")
    if not isinstance(content, str):
        raise AnswerSheetConfigError(f"{prefix}题干格式无效")
    if require_publishable and not content.strip():
        raise AnswerSheetConfigError(f"{prefix}题干不能为空")
    if len(content) > 20_000:
        raise AnswerSheetConfigError(f"{prefix}题干不能超过 20000 字")
    _validate_markdown_images(prefix, content)
    if type(question.get("required")) is not bool:
        raise AnswerSheetConfigError(f"{prefix}必答配置无效")

    if question_type == "fill_blank":
        if single_markdown_fill:
            points = question.get("points")
            if type(points) is not int or points <= 0:
                raise AnswerSheetConfigError(f"{prefix}分值必须是正整数")
            return
        _validate_public_blanks(prefix, question, require_publishable)
        return

    points = question.get("points")
    if type(points) is not int or points <= 0:
        raise AnswerSheetConfigError(f"{prefix}分值必须是正整数")
    options = question.get("options")
    if not isinstance(options, list):
        raise AnswerSheetConfigError(f"{prefix}选项必须是数组")
    if require_publishable and len(options) < 2:
        raise AnswerSheetConfigError(f"{prefix}至少需要两个选项")
    option_ids: set[str] = set()
    for option in options:
        if not isinstance(option, dict) or set(option) != _OPTION_KEYS:
            raise AnswerSheetConfigError(f"{prefix}选项格式无效")
        option_id = option.get("id")
        option_content = option.get("content")
        if (
            not isinstance(option_id, str)
            or not option_id
            or option_id in option_ids
        ):
            raise AnswerSheetConfigError(f"{prefix}选项标识无效或重复")
        if not isinstance(option_content, str):
            raise AnswerSheetConfigError(f"{prefix}选项内容格式无效")
        if require_publishable and not option_content.strip():
            raise AnswerSheetConfigError(f"{prefix}选项内容不能为空")
        if len(option_content) > 5_000:
            raise AnswerSheetConfigError(f"{prefix}选项内容不能超过 5000 字")
        _validate_markdown_images(f"{prefix}选项", option_content)
        option_ids.add(option_id)


def _validate_markdown_images(prefix: str, content: str) -> None:
    if any(
        _CONTENT_ASSET_URL.fullmatch(target) is None
        for target in _MARKDOWN_IMAGE.findall(content)
    ):
        raise AnswerSheetConfigError(f"{prefix}图片必须使用教师上传的题图")


def _validate_public_blanks(
    prefix: str, question: dict[str, Any], require_publishable: bool
) -> None:
    blanks = question.get("blanks")
    if not isinstance(blanks, list):
        raise AnswerSheetConfigError(f"{prefix}填空配置必须是数组")
    if require_publishable and not blanks:
        raise AnswerSheetConfigError(f"{prefix}至少需要一个填空")
    blank_ids: set[str] = set()
    for blank in blanks:
        if not isinstance(blank, dict) or set(blank) != _BLANK_KEYS:
            raise AnswerSheetConfigError(f"{prefix}填空配置格式无效")
        blank_id = blank.get("id")
        points = blank.get("points")
        if not isinstance(blank_id, str) or not blank_id or blank_id in blank_ids:
            raise AnswerSheetConfigError(f"{prefix}填空标识无效或重复")
        if type(points) is not int or points <= 0:
            raise AnswerSheetConfigError(f"{prefix}填空分值必须是正整数")
        blank_ids.add(blank_id)
    if require_publishable:
        markers = _BLANK_MARKER.findall(str(question.get("content") or ""))
        if len(markers) != len(set(markers)) or set(markers) != blank_ids:
            raise AnswerSheetConfigError(f"{prefix}题干标记必须与填空配置一一对应")


def validate_private_answer_key(
    node: dict[str, Any], key: object, *, require_publishable: bool
) -> None:
    if node.get("kind") != "answer_sheet":
        if key not in (None, {}):
            raise AnswerSheetConfigError("只有答题卡节点可以配置标准答案")
        return
    title = str(node.get("title") or "未命名答题卡")
    if not isinstance(key, dict) or set(key) != _PRIVATE_KEY_KEYS:
        raise AnswerSheetConfigError(f"答题卡“{title}”标准答案格式无效")
    schema_version = node.get("answerSheet", {}).get("schemaVersion")
    if key.get("schemaVersion") != schema_version or schema_version not in ANSWER_SHEET_GRADERS:
        raise AnswerSheetConfigError(f"答题卡“{title}”标准答案版本无效")
    if key.get("graderVersion") != ANSWER_SHEET_GRADERS[schema_version]:
        raise AnswerSheetConfigError(f"答题卡“{title}”评分器版本无效")
    answers = key.get("answers")
    if not isinstance(answers, dict):
        raise AnswerSheetConfigError(f"答题卡“{title}”标准答案必须是对象")

    questions = {
        str(question["id"]): question
        for question in node.get("answerSheet", {}).get("questions", [])
        if isinstance(question, dict) and question.get("id")
    }
    unknown = set(answers) - set(questions)
    if unknown:
        raise AnswerSheetConfigError(f"答题卡“{title}”包含未知题目的标准答案")
    if require_publishable and set(answers) != set(questions):
        raise AnswerSheetConfigError(f"答题卡“{title}”每道题都必须配置标准答案")
    for question_id, answer in answers.items():
        _validate_private_question_answer(title, questions[question_id], answer)


def _validate_private_question_answer(
    title: str, question: dict[str, Any], answer: object
) -> None:
    question_id = str(question["id"])
    prefix = f"答题卡“{title}”题目“{question_id}”"
    if not isinstance(answer, dict) or answer.get("type") != question.get("type"):
        raise AnswerSheetConfigError(f"{prefix}标准答案题型不一致")
    question_type = question["type"]
    if question_type == "single_choice":
        if set(answer) != {"type", "correctOptionId"}:
            raise AnswerSheetConfigError(f"{prefix}单选标准答案格式无效")
        option_ids = {option["id"] for option in question["options"]}
        if answer.get("correctOptionId") not in option_ids:
            raise AnswerSheetConfigError(f"{prefix}正确选项不存在")
        return
    if question_type == "multiple_choice":
        if set(answer) != {"type", "correctOptionIds", "mode"}:
            raise AnswerSheetConfigError(f"{prefix}多选标准答案格式无效")
        correct_ids = answer.get("correctOptionIds")
        option_ids = {option["id"] for option in question["options"]}
        if (
            answer.get("mode") != "exact_set"
            or not isinstance(correct_ids, list)
            or not correct_ids
            or any(not isinstance(value, str) or value not in option_ids for value in correct_ids)
            or len(correct_ids) != len(set(correct_ids))
        ):
            raise AnswerSheetConfigError(f"{prefix}多选标准答案无效")
        return

    if _is_single_markdown_question(question):
        if (
            set(answer) != {"type", "format", "answerMarkdown"}
            or answer.get("format") != "single_markdown_exact"
            or not isinstance(answer.get("answerMarkdown"), str)
            or not answer["answerMarkdown"].strip()
        ):
            raise AnswerSheetConfigError(f"{prefix}填空标准答案格式无效")
        return

    if set(answer) != {"type", "blanks"} or not isinstance(answer.get("blanks"), dict):
        raise AnswerSheetConfigError(f"{prefix}填空标准答案格式无效")
    blank_answers = answer["blanks"]
    blank_ids = {blank["id"] for blank in question["blanks"]}
    if set(blank_answers) != blank_ids:
        raise AnswerSheetConfigError(f"{prefix}每个填空都必须配置标准答案")
    for blank_id, blank_answer in blank_answers.items():
        if (
            not isinstance(blank_answer, dict)
            or set(blank_answer) != {"acceptedAnswers", "caseSensitive"}
            or type(blank_answer.get("caseSensitive")) is not bool
        ):
            raise AnswerSheetConfigError(f"{prefix}填空“{blank_id}”标准答案格式无效")
        accepted = blank_answer.get("acceptedAnswers")
        if (
            not isinstance(accepted, list)
            or not accepted
            or any(
                not isinstance(value, str)
                or not value.strip()
                or value.strip() == _LEGACY_BLANK_ANSWER_PLACEHOLDER
                for value in accepted
            )
        ):
            raise AnswerSheetConfigError(f"{prefix}填空“{blank_id}”至少需要一个答案")
        normalized = {
            _normalize_fill_text(value, bool(blank_answer["caseSensitive"]))
            for value in accepted
        }
        if len(normalized) != len(accepted):
            raise AnswerSheetConfigError(f"{prefix}填空“{blank_id}”等价答案不能重复")


def normalize_answer_sheet_submission(
    node: dict[str, Any], payload: dict[str, Any], *, strict: bool
) -> dict[str, Any]:
    errors: dict[str, str] = {}
    if not payload:
        payload = {"answers": {}}
    if set(payload) != {"answers"}:
        errors["_payload"] = "答题数据包含未知字段"
        raise AnswerSheetSubmissionError(errors)
    raw_answers = payload.get("answers")
    if not isinstance(raw_answers, dict):
        raise AnswerSheetSubmissionError({"_payload": "答题数据格式无效"})
    questions = {
        str(question["id"]): question
        for question in node.get("answerSheet", {}).get("questions", [])
    }
    for question_id in raw_answers:
        if question_id not in questions:
            errors[str(question_id)] = "题目标识无效"
    normalized_answers: dict[str, Any] = {}
    for question_id, question in questions.items():
        raw_answer = raw_answers.get(question_id)
        if raw_answer is None:
            if strict and question.get("required") is True:
                errors[question_id] = _required_answer_message(question)
            continue
        normalized = _normalize_question_submission(question, raw_answer, errors, strict)
        if normalized is not None:
            normalized_answers[question_id] = normalized
    if errors:
        raise AnswerSheetSubmissionError(errors)
    return {"answers": normalized_answers}


def _normalize_question_submission(
    question: dict[str, Any],
    raw_answer: object,
    errors: dict[str, str],
    strict: bool,
) -> dict[str, Any] | None:
    question_id = str(question["id"])
    if not isinstance(raw_answer, dict):
        errors[question_id] = "作答格式无效"
        return None
    question_type = question["type"]
    if question_type == "single_choice":
        selected = raw_answer.get("selectedOptionId")
        option_ids = {option["id"] for option in question["options"]}
        if (
            set(raw_answer) == {"selectedOptionId"}
            and selected in (None, "")
            and (not strict or question.get("required") is False)
        ):
            return None
        if set(raw_answer) != {"selectedOptionId"} or selected not in option_ids:
            errors[question_id] = "请选择一项"
            return None
        return {"selectedOptionId": selected}
    if question_type == "multiple_choice":
        selected = raw_answer.get("selectedOptionIds")
        option_order = [option["id"] for option in question["options"]]
        option_ids = set(option_order)
        if (
            set(raw_answer) == {"selectedOptionIds"}
            and selected == []
            and (not strict or question.get("required") is False)
        ):
            return None
        if (
            set(raw_answer) != {"selectedOptionIds"}
            or not isinstance(selected, list)
            or (strict and not selected)
            or any(not isinstance(value, str) or value not in option_ids for value in selected)
            or len(selected) != len(set(selected))
        ):
            errors[question_id] = "请至少选择一项"
            return None
        selected_set = set(selected)
        return {"selectedOptionIds": [value for value in option_order if value in selected_set]}

    if _is_single_markdown_question(question):
        answer_markdown = raw_answer.get("answerMarkdown")
        if set(raw_answer) != {"answerMarkdown"} or not isinstance(answer_markdown, str):
            errors[question_id] = "填空内容格式无效"
            return None
        if not answer_markdown.strip():
            if strict and question.get("required") is True:
                errors[question_id] = "请输入答案"
            return None
        return {"answerMarkdown": answer_markdown}

    blank_values = raw_answer.get("blankValues")
    blank_ids = [blank["id"] for blank in question["blanks"]]
    if set(raw_answer) != {"blankValues"} or not isinstance(blank_values, dict):
        errors[question_id] = "填空内容格式无效"
        return None
    if set(blank_values) - set(blank_ids):
        errors[question_id] = "填空标识无效"
        return None
    if question.get("required") is False and all(
        isinstance(blank_values.get(blank_id, ""), str)
        and not str(blank_values.get(blank_id, "")).strip()
        for blank_id in blank_ids
    ):
        return None
    normalized_values: dict[str, str] = {}
    for blank_id in blank_ids:
        value = blank_values.get(blank_id, "")
        if not isinstance(value, str) or (strict and not value.strip()):
            errors[f"{question_id}:{blank_id}"] = "请填写此空"
            continue
        normalized_values[blank_id] = value
    return {"blankValues": normalized_values}


def grade_answer_sheet(
    node: dict[str, Any], key: dict[str, Any], payload: dict[str, Any]
) -> dict[str, Any]:
    validate_public_answer_sheet(node, require_publishable=True)
    validate_private_answer_key(node, key, require_publishable=True)
    normalized = normalize_answer_sheet_submission(node, payload, strict=True)
    answers = normalized["answers"]
    private_answers = key["answers"]
    results = [
        _grade_question(
            question,
            private_answers[question["id"]],
            answers.get(question["id"]),
        )
        for question in node["answerSheet"]["questions"]
    ]
    score = sum(result["awardedPoints"] for result in results)
    maximum = answer_sheet_max_score(node)
    passing_score = node["answerSheet"]["gradingPolicy"]["passingScore"]
    schema_version = node["answerSheet"]["schemaVersion"]
    return {
        "schemaVersion": schema_version,
        "graderVersion": ANSWER_SHEET_GRADERS[schema_version],
        "score": score,
        "maxScore": maximum,
        "passingScore": passing_score,
        "passed": score >= passing_score,
        "questionResults": results,
    }


def _grade_question(
    question: dict[str, Any], private: dict[str, Any], answer: dict[str, Any] | None
) -> dict[str, Any]:
    question_type = question["type"]
    if question_type == "single_choice":
        correct = bool(answer) and answer["selectedOptionId"] == private["correctOptionId"]
        points = int(question["points"])
        return _selection_result(question["id"], points, correct)
    if question_type == "multiple_choice":
        correct = bool(answer) and set(answer["selectedOptionIds"]) == set(private["correctOptionIds"])
        points = int(question["points"])
        return _selection_result(question["id"], points, correct)

    if _is_single_markdown_question(question):
        actual = str((answer or {}).get("answerMarkdown", "")).strip()
        expected = str(private["answerMarkdown"]).strip()
        return _selection_result(
            question["id"], int(question["points"]), actual == expected
        )

    blank_results: list[dict[str, Any]] = []
    for blank in question["blanks"]:
        blank_id = blank["id"]
        private_blank = private["blanks"][blank_id]
        case_sensitive = bool(private_blank["caseSensitive"])
        actual = _normalize_fill_text(
            str((answer or {}).get("blankValues", {}).get(blank_id, "")), case_sensitive
        )
        accepted = {
            _normalize_fill_text(value, case_sensitive)
            for value in private_blank["acceptedAnswers"]
        }
        correct = actual in accepted
        points = int(blank["points"])
        blank_results.append(
            {
                "blankId": blank_id,
                "awardedPoints": points if correct else 0,
                "maxPoints": points,
                "correct": correct,
            }
        )
    awarded = sum(result["awardedPoints"] for result in blank_results)
    maximum = sum(result["maxPoints"] for result in blank_results)
    return {
        "questionId": question["id"],
        "awardedPoints": awarded,
        "maxPoints": maximum,
        "correct": awarded == maximum,
        "blankResults": blank_results,
    }


def _selection_result(question_id: str, points: int, correct: bool) -> dict[str, Any]:
    return {
        "questionId": question_id,
        "awardedPoints": points if correct else 0,
        "maxPoints": points,
        "correct": correct,
    }


def answer_sheet_max_score(node: dict[str, Any]) -> int:
    total = 0
    config = node.get("answerSheet")
    if not isinstance(config, dict) or not isinstance(config.get("questions"), list):
        return total
    for question in config["questions"]:
        if not isinstance(question, dict):
            continue
        if _is_single_markdown_question(question) and type(question.get("points")) is int:
            total += question["points"]
        elif question.get("type") == "fill_blank" and isinstance(question.get("blanks"), list):
            total += sum(
                blank.get("points", 0)
                for blank in question["blanks"]
                if isinstance(blank, dict) and type(blank.get("points")) is int
            )
        elif type(question.get("points")) is int:
            total += question["points"]
    return total


def _normalize_fill_text(value: str, case_sensitive: bool) -> str:
    normalized = unicodedata.normalize("NFC", value.replace("\r\n", "\n").replace("\r", "\n")).strip()
    return normalized if case_sensitive else normalized.casefold()


def _is_single_markdown_question(question: object) -> bool:
    return (
        isinstance(question, dict)
        and question.get("type") == "fill_blank"
        and question.get("format") == "single_markdown_exact"
    )


def _required_answer_message(question: dict[str, Any]) -> str:
    question_type = question["type"]
    if question_type == "single_choice":
        return "请选择一项"
    if question_type == "multiple_choice":
        return "请至少选择一项"
    return "请输入答案" if _is_single_markdown_question(question) else "请完成所有填空"
