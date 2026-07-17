import hashlib
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


EMPTY_CONFIG = {"acceptedExtensions": [], "parameters": []}
PARAMETER_KEY_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,63}")
EXTENSION_PATTERN = re.compile(r"\.[a-z0-9]{1,15}")
PARAMETER_TYPES = {"integer", "number", "string", "boolean", "select"}
Scalar = str | int | float | bool


class AuditScriptParameterError(ValueError):
    pass


@dataclass(frozen=True)
class AuditScriptVersionConfig:
    accepted_extensions: tuple[str, ...]
    parameters: tuple[dict[str, object], ...]
    sha256: str


def load_audit_script_version_config(version_dir: Path) -> AuditScriptVersionConfig:
    version_dir = version_dir.resolve()
    config_path = version_dir / "config.json"
    if config_path.is_symlink():
        raise AuditScriptParameterError("审核脚本版本配置路径无效")
    if not config_path.exists():
        data: object = EMPTY_CONFIG
    else:
        resolved = config_path.resolve()
        if not resolved.is_relative_to(version_dir):
            raise AuditScriptParameterError("审核脚本版本配置路径无效")
        data = json.loads(resolved.read_text(encoding="utf-8"))
    normalized = _normalize_config(data)
    canonical = json.dumps(
        normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return AuditScriptVersionConfig(
        accepted_extensions=tuple(normalized["acceptedExtensions"]),
        parameters=tuple(normalized["parameters"]),
        sha256=hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
    )


def validate_script_params(
    config: AuditScriptVersionConfig, params: object
) -> dict[str, Scalar]:
    if not isinstance(params, dict):
        raise AuditScriptParameterError("审核脚本参数必须是对象")
    if len(json.dumps(params, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > 16384:
        raise AuditScriptParameterError("审核脚本参数超限")
    definitions = {str(item["key"]): item for item in config.parameters}
    extra = set(params) - set(definitions)
    if extra:
        raise AuditScriptParameterError("审核脚本包含未知参数")
    result: dict[str, Scalar] = {}
    for key, definition in definitions.items():
        if key not in params:
            if definition["required"]:
                raise AuditScriptParameterError(f"审核脚本参数 {key} 缺失")
            continue
        result[key] = _validate_value(params[key], definition)
    return result


def _normalize_config(data: object) -> dict[str, list[object]]:
    if not isinstance(data, dict) or set(data) - {"acceptedExtensions", "parameters"}:
        raise AuditScriptParameterError("审核脚本版本配置格式无效")
    extensions = data.get("acceptedExtensions", [])
    parameters = data.get("parameters", [])
    if not isinstance(extensions, list) or not isinstance(parameters, list):
        raise AuditScriptParameterError("审核脚本版本配置格式无效")
    normalized_extensions: list[str] = []
    for value in extensions:
        extension = value.strip().lower() if isinstance(value, str) else ""
        if not EXTENSION_PATTERN.fullmatch(extension) or extension in normalized_extensions:
            raise AuditScriptParameterError("审核脚本文件扩展名无效")
        normalized_extensions.append(extension)
    if len(parameters) > 20:
        raise AuditScriptParameterError("审核脚本参数数量超限")
    normalized_parameters: list[dict[str, object]] = []
    seen_keys: set[str] = set()
    for item in parameters:
        normalized = _normalize_parameter(item)
        key = str(normalized["key"])
        if key in seen_keys:
            raise AuditScriptParameterError("审核脚本参数键重复")
        seen_keys.add(key)
        normalized_parameters.append(normalized)
    return {
        "acceptedExtensions": normalized_extensions,
        "parameters": normalized_parameters,
    }


def _normalize_parameter(item: object) -> dict[str, object]:
    if not isinstance(item, dict):
        raise AuditScriptParameterError("审核脚本参数定义无效")
    parameter_type = item.get("type")
    allowed = {"key", "label", "type", "required", "default", "description"}
    if parameter_type in {"integer", "number"}:
        allowed |= {"minimum", "maximum"}
    elif parameter_type == "string":
        allowed |= {"minimumLength", "maximumLength"}
    elif parameter_type == "select":
        allowed.add("options")
    if parameter_type not in PARAMETER_TYPES or set(item) - allowed:
        raise AuditScriptParameterError("审核脚本参数定义无效")
    key = item.get("key")
    label = item.get("label")
    description = item.get("description", "")
    required = item.get("required", True)
    if not isinstance(key, str) or PARAMETER_KEY_PATTERN.fullmatch(key) is None:
        raise AuditScriptParameterError("审核脚本参数键无效")
    if not isinstance(label, str) or not label.strip() or len(label.strip()) > 80:
        raise AuditScriptParameterError("审核脚本参数标签无效")
    if not isinstance(description, str) or len(description.strip()) > 200:
        raise AuditScriptParameterError("审核脚本参数说明无效")
    if not isinstance(required, bool) or "default" not in item:
        raise AuditScriptParameterError("审核脚本参数默认值无效")
    normalized: dict[str, object] = {
        "key": key,
        "label": label.strip(),
        "type": parameter_type,
        "required": required,
        "default": item["default"],
    }
    if description.strip():
        normalized["description"] = description.strip()
    for field in ("minimum", "maximum", "minimumLength", "maximumLength", "options"):
        if field in item:
            normalized[field] = item[field]
    _validate_definition_constraints(normalized)
    normalized["default"] = _validate_value(normalized["default"], normalized)
    return normalized


def _validate_definition_constraints(definition: dict[str, object]) -> None:
    kind = definition["type"]
    if kind in {"integer", "number"}:
        minimum = definition.get("minimum")
        maximum = definition.get("maximum")
        for value in (minimum, maximum):
            if value is not None and not _is_number(value, integer=kind == "integer"):
                raise AuditScriptParameterError("审核脚本参数数值范围无效")
        if minimum is not None and maximum is not None and float(minimum) > float(maximum):
            raise AuditScriptParameterError("审核脚本参数数值范围无效")
    elif kind == "string":
        minimum = definition.get("minimumLength", 0)
        maximum = definition.get("maximumLength", 2000)
        if (
            not isinstance(minimum, int)
            or isinstance(minimum, bool)
            or not isinstance(maximum, int)
            or isinstance(maximum, bool)
            or minimum < 0
            or maximum < minimum
            or maximum > 2000
        ):
            raise AuditScriptParameterError("审核脚本字符串长度范围无效")
        definition["minimumLength"] = minimum
        definition["maximumLength"] = maximum
    elif kind == "select":
        options = definition.get("options")
        if not isinstance(options, list) or not 1 <= len(options) <= 100:
            raise AuditScriptParameterError("审核脚本下拉选项无效")
        values: set[str] = set()
        normalized_options: list[dict[str, str]] = []
        for option in options:
            if not isinstance(option, dict) or set(option) != {"label", "value"}:
                raise AuditScriptParameterError("审核脚本下拉选项无效")
            label, value = option["label"], option["value"]
            if (
                not isinstance(label, str)
                or not label.strip()
                or len(label.strip()) > 80
                or not isinstance(value, str)
                or not value
                or len(value) > 120
                or value in values
            ):
                raise AuditScriptParameterError("审核脚本下拉选项无效")
            values.add(value)
            normalized_options.append({"label": label.strip(), "value": value})
        definition["options"] = normalized_options


def _validate_value(value: object, definition: dict[str, object]) -> Scalar:
    kind = definition["type"]
    if kind == "integer":
        if not _is_number(value, integer=True):
            raise AuditScriptParameterError("审核脚本整数参数无效")
    elif kind == "number":
        if not _is_number(value, integer=False):
            raise AuditScriptParameterError("审核脚本数值参数无效")
    elif kind == "string":
        if not isinstance(value, str):
            raise AuditScriptParameterError("审核脚本文本参数无效")
        length = len(value)
        if length < int(definition["minimumLength"]) or length > int(definition["maximumLength"]):
            raise AuditScriptParameterError("审核脚本文本参数长度无效")
    elif kind == "boolean":
        if not isinstance(value, bool):
            raise AuditScriptParameterError("审核脚本布尔参数无效")
    elif kind == "select":
        choices = {str(option["value"]) for option in definition["options"]}  # type: ignore[index]
        if not isinstance(value, str) or value not in choices:
            raise AuditScriptParameterError("审核脚本下拉参数无效")
    if kind in {"integer", "number"}:
        minimum = definition.get("minimum")
        maximum = definition.get("maximum")
        if minimum is not None and float(value) < float(minimum):  # type: ignore[arg-type]
            raise AuditScriptParameterError("审核脚本参数低于最小值")
        if maximum is not None and float(value) > float(maximum):  # type: ignore[arg-type]
            raise AuditScriptParameterError("审核脚本参数超过最大值")
    return value  # type: ignore[return-value]


def _is_number(value: object, *, integer: bool) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    if not math.isfinite(float(value)):
        return False
    return not integer or isinstance(value, int)
