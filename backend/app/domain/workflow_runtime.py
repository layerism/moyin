import unicodedata
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import Any

from app.domain.form_fields import normalize_form_answers


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def deadline_has_passed(value: str | None, now: datetime | None = None) -> bool:
    deadline = parse_datetime(value)
    return bool(deadline and deadline <= (now or datetime.now(UTC)))


def start_is_in_future(value: str | None, now: datetime | None = None) -> bool:
    start = parse_datetime(value)
    return bool(start and start > (now or datetime.now(UTC)))


def pending_node_status(
    predecessors_approved: bool,
    start_at: str | None,
    deadline_at: str | None,
    now: datetime | None = None,
) -> str:
    if not predecessors_approved:
        return "locked"
    if deadline_has_passed(deadline_at, now):
        return "expired"
    if start_is_in_future(start_at, now):
        return "scheduled"
    return "available"


def incoming_nodes(config: dict[str, Any]) -> dict[str, set[str]]:
    incoming: dict[str, set[str]] = defaultdict(set)
    for node in config["nodes"]:
        incoming[node["id"]]
    for edge in config["edges"]:
        incoming[edge["target"]].add(edge["source"])
    return incoming


def node_by_key(config: dict[str, Any], node_key: str) -> dict[str, Any]:
    for node in config["nodes"]:
        if node["id"] == node_key:
            return node
    raise KeyError(node_key)


def validate_submission(node: dict[str, Any], payload: dict[str, Any]) -> None:
    kind = node.get("kind")
    if kind == "form":
        normalize_form_answers(node, payload, strict=True)
        return

    if kind in {"announcement", "confirmation"}:
        if payload.get("confirmed") is not True:
            raise ValueError("请完成确认后再提交")
        return

    if kind != "file":
        return

    file_value = payload.get("file")
    if not isinstance(file_value, dict) or not file_value.get("name"):
        raise ValueError("请选择文件后再提交")

    file_name = str(file_value["name"])
    validate_file_metadata(node, file_name, file_value.get("size", 0))


def validate_file_metadata(node: dict[str, Any], file_name: str, file_size: object) -> None:
    if not str(file_name).strip():
        raise ValueError("请选择文件后再提交")
    extensions = [
        value.strip().lower().removeprefix(".")
        for value in str(node.get("fileExtensions") or "").split(",")
        if value.strip()
    ]
    actual_extension = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    if extensions and actual_extension not in extensions:
        raise ValueError(f"仅允许上传：{', '.join(extensions)}")

    raw_limit = str(node.get("fileLimitMb") or "").strip()
    if raw_limit:
        try:
            limit_mb = float(raw_limit)
            file_size_value = float(file_size)
        except (TypeError, ValueError) as exc:
            raise ValueError("文件大小信息无效") from exc
        if limit_mb > 0 and file_size_value > limit_mb * 1024 * 1024:
            raise ValueError(f"文件大小不能超过 {raw_limit} MB")


def validate_template_filename(uploaded_filename: str, template_filename: str) -> str:
    uploaded_stem, uploaded_suffix = _filename_identity(uploaded_filename)
    template_stem, template_suffix = _filename_identity(template_filename)
    if not template_stem or template_suffix != ".docx":
        raise ValueError("当前节点模板配置异常，请联系教师")
    if uploaded_suffix != ".docx" or not uploaded_stem.startswith(template_stem):
        raise ValueError(
            f"文件名必须以“{template_stem}”开头，并使用 .docx 格式。"
        )
    return _normalized_filename(uploaded_filename)


def _normalized_filename(value: str) -> str:
    filename = PurePosixPath(str(value).replace("\\", "/")).name.strip()
    return unicodedata.normalize("NFC", filename)


def _filename_identity(value: str) -> tuple[str, str]:
    path = PurePosixPath(_normalized_filename(value))
    return path.stem, path.suffix.lower()
