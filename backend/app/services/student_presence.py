"""Ephemeral presence for the single-worker deployment; never persisted."""
from threading import Lock
from time import monotonic

PRESENCE_TTL_SECONDS = 90
_seen: dict[int, float] = {}
_lock = Lock()


def _prune(now: float) -> None:
    for student_id in [key for key, seen in _seen.items() if now - seen >= PRESENCE_TTL_SECONDS]:
        del _seen[student_id]


def record_heartbeat(student_id: int) -> None:
    with _lock:
        now = monotonic()
        _prune(now)
        _seen[student_id] = now


def online_students() -> set[int]:
    with _lock:
        _prune(monotonic())
        return set(_seen)
