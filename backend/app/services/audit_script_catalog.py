import hashlib
import json
import logging
import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, cast

from app.core.config import settings


logger = logging.getLogger(__name__)
SCRIPT_ID_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
ENTRY_SUFFIXES: dict[str, str] = {"js": ".js", "py": ".py"}


class AuditScriptCatalogError(ValueError):
    pass


@dataclass(frozen=True)
class AuditScriptRecord:
    id: str
    name: str
    description: str
    language: Literal["py", "js"]
    version: int
    entry_path: Path
    sha256: str
    updated_at: str


@dataclass(frozen=True)
class _AuditScriptManifest:
    id: str
    name: str
    description: str
    language: Literal["py", "js"]
    version: int
    entry: str
    script_dir: Path


def list_audit_scripts() -> list[dict[str, object]]:
    records = _current_records()
    records.sort(key=lambda record: (record.name.casefold(), record.id))
    return [
        {
            "id": record.id,
            "name": record.name,
            "description": record.description,
            "language": record.language,
            "version": record.version,
            "sha256": record.sha256,
            "updatedAt": record.updated_at,
        }
        for record in records
    ]


def find_audit_script_version(script_id: str, version: int) -> AuditScriptRecord:
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        raise AuditScriptCatalogError("审核脚本版本无效")

    matches = [manifest for manifest in _valid_manifests() if manifest.id == script_id]
    if len(matches) != 1:
        if len(matches) > 1:
            logger.warning("拒绝解析重复审核脚本 ID %r", script_id)
        raise AuditScriptCatalogError("审核脚本版本不存在")
    manifest = matches[0]
    if version > manifest.version:
        raise AuditScriptCatalogError("审核脚本版本不存在")
    try:
        return _record_for_version(manifest, version)
    except OSError as exc:
        raise AuditScriptCatalogError("审核脚本版本无效") from exc


def _current_records() -> list[AuditScriptRecord]:
    manifests = _valid_manifests()
    duplicate_ids = {
        script_id
        for script_id, count in Counter(manifest.id for manifest in manifests).items()
        if count > 1
    }
    for script_id in sorted(duplicate_ids):
        logger.warning("跳过重复审核脚本 ID %r", script_id)

    records: list[AuditScriptRecord] = []
    for manifest in manifests:
        if manifest.id in duplicate_ids:
            continue
        try:
            records.append(_record_for_version(manifest, manifest.version))
        except (AuditScriptCatalogError, OSError) as exc:
            logger.warning(
                "跳过无效审核脚本目录 %r：%s",
                manifest.script_dir.name,
                type(exc).__name__,
            )
    return records


def _valid_manifests() -> list[_AuditScriptManifest]:
    root = Path(settings.audit_scripts_root).resolve()
    if not root.is_dir():
        return []

    manifests: list[_AuditScriptManifest] = []
    for manifest_path in sorted(root.glob("*/manifest.json")):
        try:
            manifests.append(_read_manifest(manifest_path))
        except (AuditScriptCatalogError, json.JSONDecodeError, OSError, UnicodeError) as exc:
            logger.warning(
                "跳过无效审核脚本目录 %r：%s",
                manifest_path.parent.name,
                type(exc).__name__,
            )
    return manifests


def _read_manifest(manifest_path: Path) -> _AuditScriptManifest:
    root = Path(settings.audit_scripts_root).resolve()
    script_dir = manifest_path.parent.resolve()
    if not script_dir.is_relative_to(root):
        raise AuditScriptCatalogError("审核脚本目录越界")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise AuditScriptCatalogError("审核脚本清单必须是对象")

    script_id = _bounded_text(manifest.get("id"), "id", 120)
    if SCRIPT_ID_PATTERN.fullmatch(script_id) is None:
        raise AuditScriptCatalogError("审核脚本 ID 无效")
    name = _bounded_text(manifest.get("name"), "name", 120)
    description = _bounded_text(manifest.get("description"), "description", 500)

    language_value = manifest.get("language")
    if not isinstance(language_value, str) or language_value not in ENTRY_SUFFIXES:
        raise AuditScriptCatalogError("审核脚本语言无效")
    language = cast(Literal["py", "js"], language_value)

    current_version = manifest.get("version")
    if (
        not isinstance(current_version, int)
        or isinstance(current_version, bool)
        or current_version < 1
    ):
        raise AuditScriptCatalogError("审核脚本版本无效")
    entry = _bounded_text(manifest.get("entry"), "entry", 255)
    if (
        Path(entry).is_absolute()
        or Path(entry).name != entry
        or "/" in entry
        or "\\" in entry
        or Path(entry).suffix != ENTRY_SUFFIXES[language]
    ):
        raise AuditScriptCatalogError("审核脚本入口无效")

    return _AuditScriptManifest(
        id=script_id,
        name=name,
        description=description,
        language=language,
        version=current_version,
        entry=entry,
        script_dir=script_dir,
    )


def _record_for_version(
    manifest: _AuditScriptManifest, version: int
) -> AuditScriptRecord:
    root = Path(settings.audit_scripts_root).resolve()
    if version < 1 or version > manifest.version:
        raise AuditScriptCatalogError("审核脚本版本不存在")

    entry_path = (manifest.script_dir / "versions" / str(version) / manifest.entry).resolve()
    if not entry_path.is_relative_to(manifest.script_dir) or not entry_path.is_relative_to(root):
        raise AuditScriptCatalogError("审核脚本入口越界")
    if not entry_path.is_file():
        raise AuditScriptCatalogError("审核脚本入口不存在")

    stat = entry_path.stat()
    if stat.st_size > settings.audit_script_max_bytes:
        raise AuditScriptCatalogError("审核脚本入口超限")

    return AuditScriptRecord(
        id=manifest.id,
        name=manifest.name,
        description=manifest.description,
        language=manifest.language,
        version=version,
        entry_path=entry_path,
        sha256=_sha256(entry_path),
        updated_at=datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
    )


def _bounded_text(value: object, field: str, maximum: int) -> str:
    if not isinstance(value, str):
        raise AuditScriptCatalogError(f"审核脚本清单字段 {field} 无效")
    value = value.strip()
    if not value or len(value) > maximum:
        raise AuditScriptCatalogError(f"审核脚本清单字段 {field} 无效")
    return value


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(65_536), b""):
            digest.update(chunk)
    return digest.hexdigest()
