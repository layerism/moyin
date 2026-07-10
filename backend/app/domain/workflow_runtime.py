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
