from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from app.services.audit_script_catalog import AuditScriptCatalogError, find_audit_script_version


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
    try:
        record = find_audit_script_version(script_id, version)
        if record.sha256 != expected_sha256:
            raise AuditScriptResolutionError("无法解析审核脚本版本")
        return AuditScriptRuntimeDescriptor(
            script_id=record.id,
            version=record.version,
            language=record.language,
            entry_path=record.entry_path,
            sha256=record.sha256,
        )
    except AuditScriptResolutionError:
        raise
    except (AuditScriptCatalogError, OSError, ValueError):
        raise AuditScriptResolutionError("无法解析审核脚本版本") from None
