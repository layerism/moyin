from collections import defaultdict
from datetime import UTC, datetime
from typing import Any


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
        missing = [
            str(field)
            for field in node.get("infoFields", [])
            if not _has_value(payload.get(str(field)))
        ]
        if missing:
            raise ValueError(f"请填写：{', '.join(missing)}")
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


def _has_value(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True
