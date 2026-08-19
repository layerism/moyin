from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from app.services.audit_script_catalog import AuditScriptCatalogError, get_audit_script_runtime
from app.services.audit_script_parameters import AuditScriptConfig


class AuditScriptResolutionError(ValueError):
    pass


@dataclass(frozen=True)
class AuditScriptRuntimeDescriptor:
    script_id: str
    generation: int
    content_hash: str
    language: Literal["py", "js"]
    entry_path: Path
    config: AuditScriptConfig


def resolve_audit_script(
    script_id: str,
    expected_generation: int | None = None,
    expected_content_hash: str | None = None,
) -> AuditScriptRuntimeDescriptor:
    try:
        record, state = get_audit_script_runtime(script_id)
        generation = int(state["generation"])
        content_hash = str(state["content_hash"])
        if state["status"] != "ready" or record.content_hash != content_hash:
            raise AuditScriptResolutionError("审核脚本当前不可用")
        if expected_generation is not None and generation != expected_generation:
            raise AuditScriptResolutionError("审核脚本已更新")
        if expected_content_hash is not None and content_hash != expected_content_hash:
            raise AuditScriptResolutionError("审核脚本已更新")
        return AuditScriptRuntimeDescriptor(
            record.id, generation, content_hash, record.language, record.entry_path, record.config
        )
    except AuditScriptResolutionError:
        raise
    except (AuditScriptCatalogError, OSError, ValueError):
        raise AuditScriptResolutionError("审核脚本当前不可用") from None
