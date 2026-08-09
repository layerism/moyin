import pytest

from app.domain.form_fields import (
    FormAnswerValidationError,
    FormFieldConfigError,
    normalize_form_answers,
    validate_form_config,
)


def form_node(*fields: dict[str, object]) -> dict[str, object]:
    return {"kind": "form", "title": "信息表", "infoFields": list(fields)}


def test_historical_optional_fields_are_effectively_required() -> None:
    node = form_node(
        {"id": "text", "label": "姓名", "type": "text", "required": False},
        {
            "id": "radio",
            "label": "方向",
            "type": "radio",
            "required": False,
            "options": [{"id": "a", "label": "学术"}, {"id": "b", "label": "实践"}],
        },
        {
            "id": "checkbox",
            "label": "材料",
            "type": "checkbox",
            "required": False,
            "options": [{"id": "a", "label": "论文"}, {"id": "b", "label": "附件"}],
        },
    )
    validate_form_config(node)

    with pytest.raises(FormAnswerValidationError) as exc_info:
        normalize_form_answers(node, {}, strict=True)

    assert exc_info.value.field_errors == {
        "text": "此项为必填项",
        "radio": "请选择一项",
        "checkbox": "请至少选择一项",
    }


def test_required_must_remain_boolean() -> None:
    node = form_node(
        {"id": "text", "label": "姓名", "type": "text", "required": "yes"}
    )
    with pytest.raises(FormFieldConfigError, match="必填配置无效"):
        validate_form_config(node)


def test_checkbox_maximum_cannot_be_zero() -> None:
    node = form_node(
        {
            "id": "checkbox",
            "label": "材料",
            "type": "checkbox",
            "required": False,
            "maxSelections": 0,
            "options": [{"id": "a", "label": "论文"}, {"id": "b", "label": "附件"}],
        }
    )
    with pytest.raises(FormFieldConfigError, match="最少选择数不能大于最多选择数"):
        validate_form_config(node)
