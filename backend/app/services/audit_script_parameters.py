import hashlib
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


EMPTY_CONFIG = {
    "acceptedExtensions": [],
    "parameters": [],
    "runtimeSettings": [],
    "execution": {"maxConcurrency": 4},
}
PARAMETER_KEY_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,63}")
EXTENSION_PATTERN = re.compile(r"\.[a-z0-9]{1,15}")
PARAMETER_TYPES = {"integer", "number", "string", "boolean", "select"}
Scalar = str | int | float | bool


class AuditScriptParameterError(ValueError):
    pass


@dataclass(frozen=True)
class AuditScriptConfig:
    accepted_extensions: tuple[str, ...]
    parameters: tuple[dict[str, object], ...]
    runtime_settings: tuple[dict[str, object], ...]
    max_concurrency: int
    sha256: str


def load_audit_script_config(script_dir: Path) -> AuditScriptConfig:
    script_dir = script_dir.resolve()
    config_path = script_dir / "config.json"
    if config_path.is_symlink():
        raise AuditScriptParameterError("审核脚本配置路径无效")
    if not config_path.exists():
        data: object = EMPTY_CONFIG
    else:
        resolved = config_path.resolve()
        if not resolved.is_relative_to(script_dir):
            raise AuditScriptParameterError("审核脚本配置路径无效")
        data = json.loads(resolved.read_text(encoding="utf-8"))
    normalized = normalize_script_config(data)
    canonical = json.dumps(
        normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return AuditScriptConfig(
        accepted_extensions=tuple(normalized["acceptedExtensions"]),
        parameters=tuple(normalized["parameters"]),
        runtime_settings=tuple(normalized["runtimeSettings"]),
        max_concurrency=int(normalized["execution"]["maxConcurrency"]),
        sha256=hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
    )


def normalize_script_config(data: object) -> dict[str, Any]:
    return _normalize_config(data)


def validate_script_params(
    config: AuditScriptConfig, params: object
) -> dict[str, Scalar]:
    return _validate_values(config.parameters, params, "参数")


def validate_script_settings(
    config: AuditScriptConfig, settings: object
) -> dict[str, Scalar]:
    return _validate_values(config.runtime_settings, settings, "运行配置")


def default_script_settings(config: AuditScriptConfig) -> dict[str, Scalar]:
    return {
        str(definition["key"]): definition["value"]  # type: ignore[misc]
        for definition in config.runtime_settings
    }


def _validate_values(
    definitions_value: tuple[dict[str, object], ...], values: object, label: str
) -> dict[str, Scalar]:
    if not isinstance(values, dict):
        raise AuditScriptParameterError(f"审核脚本{label}必须是对象")
    if len(json.dumps(values, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > 16384:
        raise AuditScriptParameterError(f"审核脚本{label}超限")
    definitions = {str(item["key"]): item for item in definitions_value}
    extra = set(values) - set(definitions)
    if extra:
        raise AuditScriptParameterError(f"审核脚本包含未知{label}")
    result: dict[str, Scalar] = {}
    for key, definition in definitions.items():
        if key not in values:
            if definition["required"]:
                raise AuditScriptParameterError(f"审核脚本{label} {key} 缺失")
            continue
        result[key] = _validate_value(values[key], definition)
    return result


def _normalize_config(data: object) -> dict[str, Any]:
    if not isinstance(data, dict) or set(data) - {
        "acceptedExtensions", "parameters", "runtimeSettings", "execution"
    }:
        raise AuditScriptParameterError("审核脚本配置格式无效")
    extensions = data.get("acceptedExtensions", [])
    parameters = data.get("parameters", [])
    runtime_settings = data.get("runtimeSettings", [])
    execution = data.get("execution", {"maxConcurrency": 4})
    if (
        not isinstance(extensions, list)
        or not isinstance(parameters, list)
        or not isinstance(runtime_settings, list)
        or not isinstance(execution, dict)
        or set(execution) != {"maxConcurrency"}
    ):
        raise AuditScriptParameterError("审核脚本配置格式无效")
    max_concurrency = execution.get("maxConcurrency")
    if (
        not isinstance(max_concurrency, int)
        or isinstance(max_concurrency, bool)
        or not 1 <= max_concurrency <= 32
    ):
        raise AuditScriptParameterError("审核脚本最大并发数无效")
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
    if len(runtime_settings) > 20:
        raise AuditScriptParameterError("审核脚本运行配置数量超限")
    normalized_runtime_settings: list[dict[str, object]] = []
    seen_setting_keys: set[str] = set()
    for item in runtime_settings:
        normalized = _normalize_runtime_setting(item)
        key = str(normalized["key"])
        if key in seen_setting_keys:
            raise AuditScriptParameterError("审核脚本运行配置键重复")
        seen_setting_keys.add(key)
        normalized_runtime_settings.append(normalized)
    return {
        "acceptedExtensions": normalized_extensions,
        "parameters": normalized_parameters,
        "runtimeSettings": normalized_runtime_settings,
        "execution": {"maxConcurrency": max_concurrency},
    }


def _normalize_runtime_setting(item: object) -> dict[str, object]:
    if not isinstance(item, dict) or "value" not in item:
        raise AuditScriptParameterError("审核脚本运行配置定义无效")
    multiline = item.get("multiline", False)
    if not isinstance(multiline, bool) or (multiline and item.get("type") != "string"):
        raise AuditScriptParameterError("审核脚本运行配置定义无效")
    parameter = {key: value for key, value in item.items() if key not in {"value", "multiline"}}
    parameter["default"] = item["value"]
    parameter["required"] = True
    normalized = _normalize_parameter(parameter)
    normalized["value"] = normalized.pop("default")
    if multiline:
        normalized["multiline"] = True
    return normalized


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
            or maximum > 4000
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
        if (
            len(value.strip()) < int(definition["minimumLength"])
            or length > int(definition["maximumLength"])
        ):
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
