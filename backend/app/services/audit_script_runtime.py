import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from app.core.config import settings
from app.core.database import get_connection


class AuditScriptResolutionError(ValueError):
    pass


@dataclass(frozen=True)
class AuditScriptRuntimeDescriptor:
    script_id: str
    version: int
    language: Literal["py", "js"]
    entry_path: Path
    sha256: str


def resolve_audit_script_version(
    script_id: str, version: int, expected_sha256: str
) -> AuditScriptRuntimeDescriptor:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT s.language, v.entry_filename, v.directory_path, v.sha256
            FROM audit_script_versions v
            JOIN audit_scripts s ON s.id = v.script_id
            WHERE v.script_id = ? AND v.version_no = ?
            """,
            (script_id, version),
        ).fetchone()
    if row is None or str(row["sha256"]) != expected_sha256:
        raise AuditScriptResolutionError("无法解析审核脚本版本")

    root = Path(settings.audit_scripts_root).resolve()
    directory = Path(str(row["directory_path"])).resolve()
    entry_path = (directory / str(row["entry_filename"])).resolve()
    if not _within_root(directory, root) or not _within_root(entry_path, root):
        raise AuditScriptResolutionError("无法解析审核脚本版本")
    if not entry_path.is_file() or _sha256(entry_path) != str(row["sha256"]):
        raise AuditScriptResolutionError("无法解析审核脚本版本")

    return AuditScriptRuntimeDescriptor(
        script_id=script_id,
        version=version,
        language=str(row["language"]),
        entry_path=entry_path,
        sha256=str(row["sha256"]),
    )


def _within_root(path: Path, root: Path) -> bool:
    return path.is_relative_to(root)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(65_536), b""):
            digest.update(chunk)
    return digest.hexdigest()
