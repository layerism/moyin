from typing import Any


FORM_FIELD_TYPES = {"text", "textarea", "radio", "checkbox"}
OTHER_OPTION_ID = "other"
_FIELD_KEYS = {
    "id",
    "label",
    "type",
    "required",
    "options",
    "allowOther",
    "minLength",
    "maxLength",
    "minSelections",
    "maxSelections",
}


class FormFieldConfigError(ValueError):
    pass


class FormAnswerValidationError(ValueError):
    def __init__(self, field_errors: dict[str, str]) -> None:
        super().__init__("表单内容未通过校验")
        self.field_errors = field_errors


def normalize_form_fields(raw_fields: object) -> list[dict[str, Any]]:
    if not isinstance(raw_fields, list):
        raise FormFieldConfigError("表单字段必须是数组")
    normalized: list[dict[str, Any]] = []
    for index, raw_field in enumerate(raw_fields):
        if isinstance(raw_field, str):
            normalized.append(
                {
                    "id": f"legacy-{index}",
                    "label": raw_field,
                    "type": "text",
                    "required": True,
                    "answerKey": raw_field,
                    "legacy": True,
                }
            )
            continue
        if not isinstance(raw_field, dict):
            raise FormFieldConfigError(f"第 {index + 1} 个表单字段格式错误")
        unknown_keys = set(raw_field) - _FIELD_KEYS
        if unknown_keys:
            raise FormFieldConfigError(f"第 {index + 1} 个表单字段包含未知配置")
        normalized.append(
            {
                **raw_field,
                "answerKey": str(raw_field.get("id") or ""),
                "legacy": False,
            }
        )
    return normalized


def validate_form_config(node: dict[str, Any]) -> None:
    if node.get("kind") != "form":
        return
    fields = normalize_form_fields(node.get("infoFields", []))
    _validate_normalized_fields(str(node.get("title") or "未命名表单"), fields)


def normalize_form_answers(
    node: dict[str, Any],
    payload: dict[str, Any],
    *,
    strict: bool,
) -> dict[str, Any]:
    fields = normalize_form_fields(node.get("infoFields", []))
    return _normalize_answers(fields, payload, strict=strict)


def _validate_normalized_fields(title: str, fields: list[dict[str, Any]]) -> None:
    ids: set[str] = set()
    labels: dict[str, bool] = {}
    for field in fields:
        label = str(field.get("label") or "").strip()
        prefix = f"表单“{title}”的字段“{label or '未命名字段'}”"
        if not label:
            raise FormFieldConfigError(f"{prefix}：字段标题不能为空")

        legacy = field.get("legacy") is True
        existing_label_is_legacy = labels.get(label)
        if existing_label_is_legacy is not None and (not legacy or not existing_label_is_legacy):
            raise FormFieldConfigError(f"{prefix}：字段标题不能重复")
        labels[label] = legacy if existing_label_is_legacy is None else existing_label_is_legacy and legacy

        field_id = str(field.get("id") or "")
        if field_id in ids:
            raise FormFieldConfigError(f"{prefix}：字段标识无效或重复")
        if not legacy:
            if not field_id:
                raise FormFieldConfigError(f"{prefix}：字段标识不能为空")
            if field_id == OTHER_OPTION_ID:
                raise FormFieldConfigError(f"{prefix}：字段标识无效或重复")
        ids.add(field_id)

        field_type = field.get("type")
        if field_type not in FORM_FIELD_TYPES:
            raise FormFieldConfigError(f"{prefix}：字段类型无效")
        if type(field.get("required")) is not bool:
            raise FormFieldConfigError(f"{prefix}：必填配置无效")

        if field_type == "text":
            _reject_settings(
                field,
                prefix,
                "单行文本不能配置选项或数量限制",
                "options",
                "allowOther",
                "minLength",
                "maxLength",
                "minSelections",
                "maxSelections",
            )
            continue

        if field_type == "textarea":
            _reject_settings(
                field,
                prefix,
                "多行文本不能配置选择项",
                "options",
                "allowOther",
                "minSelections",
                "maxSelections",
            )
            minimum = _optional_nonnegative_int(field, "minLength", prefix, "最少字符数")
            maximum = _optional_nonnegative_int(field, "maxLength", prefix, "最多字符数")
            if minimum is not None and maximum is not None and minimum > maximum:
                raise FormFieldConfigError(f"{prefix}：最少字符数不能大于最多字符数")
            continue

        _reject_settings(
            field,
            prefix,
            "选择字段不能配置字符数限制",
            "minLength",
            "maxLength",
        )
        option_count = _validate_options(field, prefix)
        allow_other = field.get("allowOther", False)
        if type(allow_other) is not bool:
            raise FormFieldConfigError(f"{prefix}：“其他”选项配置无效")

        if field_type == "radio":
            _reject_settings(
                field,
                prefix,
                "单项选择不能配置选择数量",
                "minSelections",
                "maxSelections",
            )
            continue

        minimum = _optional_nonnegative_int(field, "minSelections", prefix, "最少选择数")
        maximum = _optional_nonnegative_int(field, "maxSelections", prefix, "最多选择数")
        effective_minimum = max(minimum or 0, 1)
        if maximum is not None and effective_minimum > maximum:
            raise FormFieldConfigError(f"{prefix}：最少选择数不能大于最多选择数")
        available_count = option_count + int(allow_other)
        if effective_minimum > available_count:
            raise FormFieldConfigError(f"{prefix}：最少选择数不能超过可选项总数")
        if maximum is not None and maximum > available_count:
            raise FormFieldConfigError(f"{prefix}：最多选择数不能超过可选项总数")


def _validate_options(field: dict[str, Any], prefix: str) -> int:
    options = field.get("options")
    if not isinstance(options, list) or len(options) < 2:
        raise FormFieldConfigError(f"{prefix}：至少需要两个普通选项")
    option_ids: set[str] = set()
    option_labels: set[str] = set()
    for option in options:
        if not isinstance(option, dict) or set(option) != {"id", "label"}:
            raise FormFieldConfigError(f"{prefix}：选项格式无效")
        option_id = option.get("id")
        option_label = option.get("label")
        if not isinstance(option_id, str) or not option_id or option_id == OTHER_OPTION_ID:
            raise FormFieldConfigError(f"{prefix}：选项标识无效")
        if option_id in option_ids:
            raise FormFieldConfigError(f"{prefix}：选项标识不能重复")
        if not isinstance(option_label, str) or not option_label.strip():
            raise FormFieldConfigError(f"{prefix}：选项标题不能为空")
        trimmed_label = option_label.strip()
        if trimmed_label in option_labels:
            raise FormFieldConfigError(f"{prefix}：选项标题不能重复")
        option_ids.add(option_id)
        option_labels.add(trimmed_label)
    return len(options)


def _optional_nonnegative_int(
    field: dict[str, Any], key: str, prefix: str, label: str
) -> int | None:
    value = field.get(key)
    if value is None:
        return None
    if type(value) is not int or value < 0:
        raise FormFieldConfigError(f"{prefix}：{label}必须是非负整数")
    return value


def _reject_settings(
    field: dict[str, Any], prefix: str, message: str, *keys: str
) -> None:
    if any(key in field and field[key] not in (None, False, [], "") for key in keys):
        raise FormFieldConfigError(f"{prefix}：{message}")


def _normalize_answers(
    fields: list[dict[str, Any]], payload: dict[str, Any], *, strict: bool
) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    field_errors: dict[str, str] = {}
    for field in fields:
        field_id = str(field["id"])
        answer_key = str(field["answerKey"])
        raw_value = payload.get(answer_key)
        field_type = field["type"]
        if field_type in {"text", "textarea"}:
            value = raw_value if isinstance(raw_value, str) else ""
            normalized[answer_key] = value
            if strict:
                _validate_text_answer(field, raw_value, value, field_errors)
            continue

        if field_type == "radio":
            answer, invalid = _normalize_radio_answer(field, raw_value)
            normalized[answer_key] = answer
            if strict:
                _validate_radio_answer(field, answer, invalid, field_errors)
            continue

        answer, invalid = _normalize_checkbox_answer(field, raw_value)
        normalized[answer_key] = answer
        if strict:
            _validate_checkbox_answer(field, answer, invalid, field_errors)

    if strict and field_errors:
        raise FormAnswerValidationError(field_errors)
    return normalized


def _validate_text_answer(
    field: dict[str, Any], raw_value: object, value: str, errors: dict[str, str]
) -> None:
    field_id = str(field["id"])
    trimmed = value.strip()
    if raw_value is not None and not isinstance(raw_value, str):
        errors[field_id] = "填写内容格式无效"
        return
    if not trimmed:
        errors[field_id] = "此项为必填项"
        return
    if field["type"] != "textarea" or not trimmed:
        return
    length = len(trimmed)
    minimum = field.get("minLength")
    maximum = field.get("maxLength")
    if isinstance(minimum, int) and length < minimum:
        errors[field_id] = f"至少填写 {minimum} 个字符"
    elif isinstance(maximum, int) and length > maximum:
        errors[field_id] = f"最多填写 {maximum} 个字符"


def _valid_option_ids(field: dict[str, Any]) -> list[str]:
    return [str(option["id"]) for option in field.get("options", [])]


def _normalize_radio_answer(
    field: dict[str, Any], raw_value: object
) -> tuple[dict[str, str | None], bool]:
    raw_answer = raw_value if isinstance(raw_value, dict) else {}
    raw_selected = raw_answer.get("selectedOptionId")
    valid_ids = set(_valid_option_ids(field))
    other_allowed = field.get("allowOther") is True
    selected = (
        raw_selected
        if isinstance(raw_selected, str)
        and (raw_selected in valid_ids or (other_allowed and raw_selected == OTHER_OPTION_ID))
        else None
    )
    invalid = raw_value is not None and (
        not isinstance(raw_value, dict)
        or (raw_selected is not None and selected is None)
    )
    other_text = raw_answer.get("otherText")
    return {
        "selectedOptionId": selected,
        "otherText": other_text if selected == OTHER_OPTION_ID and isinstance(other_text, str) else None,
    }, invalid


def _validate_radio_answer(
    field: dict[str, Any], answer: dict[str, str | None], invalid: bool, errors: dict[str, str]
) -> None:
    field_id = str(field["id"])
    if invalid:
        errors[field_id] = "选择内容无效"
    elif answer["selectedOptionId"] is None:
        errors[field_id] = "请选择一项"
    elif answer["selectedOptionId"] == OTHER_OPTION_ID and not str(answer["otherText"] or "").strip():
        errors[field_id] = "请填写“其他”内容"


def _normalize_checkbox_answer(
    field: dict[str, Any], raw_value: object
) -> tuple[dict[str, Any], bool]:
    raw_answer = raw_value if isinstance(raw_value, dict) else {}
    raw_selected = raw_answer.get("selectedOptionIds")
    selected_values = raw_selected if isinstance(raw_selected, list) else []
    valid_ids = _valid_option_ids(field)
    valid_set = set(valid_ids)
    other_allowed = field.get("allowOther") is True
    selected_set = {value for value in selected_values if isinstance(value, str)}
    ordered = [option_id for option_id in valid_ids if option_id in selected_set]
    if other_allowed and OTHER_OPTION_ID in selected_set:
        ordered.append(OTHER_OPTION_ID)
    invalid = raw_value is not None and (
        not isinstance(raw_value, dict)
        or not isinstance(raw_selected, list)
        or len(selected_values) != len(selected_set)
        or any(
            not isinstance(value, str)
            or (value not in valid_set and not (other_allowed and value == OTHER_OPTION_ID))
            for value in selected_values
        )
    )
    other_text = raw_answer.get("otherText")
    return {
        "selectedOptionIds": ordered,
        "otherText": other_text if OTHER_OPTION_ID in ordered and isinstance(other_text, str) else None,
    }, invalid


def _validate_checkbox_answer(
    field: dict[str, Any], answer: dict[str, Any], invalid: bool, errors: dict[str, str]
) -> None:
    field_id = str(field["id"])
    selected = answer["selectedOptionIds"]
    if invalid:
        errors[field_id] = "选择内容无效"
        return
    if not selected:
        errors[field_id] = "请至少选择一项"
        return
    minimum = max(field.get("minSelections") or 0, 1)
    maximum = field.get("maxSelections")
    if len(selected) < minimum:
        errors[field_id] = f"请至少选择 {minimum} 项"
    elif isinstance(maximum, int) and len(selected) > maximum:
        errors[field_id] = f"最多选择 {maximum} 项"
    elif OTHER_OPTION_ID in selected and not str(answer.get("otherText") or "").strip():
        errors[field_id] = "请填写“其他”内容"
