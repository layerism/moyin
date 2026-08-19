import hashlib
import json
import logging
import os
import re
import tempfile
import threading
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, cast

from app.core.config import settings
from app.core.database import get_connection
from app.services.audit_script_parameters import (
    AuditScriptConfig,
    AuditScriptParameterError,
    load_audit_script_config,
    normalize_script_config,
    validate_script_params,
    validate_script_settings,
)
from app.services.security import utc_now_iso


logger = logging.getLogger(__name__)
SCRIPT_ID_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
ENTRY_SUFFIXES: dict[str, str] = {"js": ".js", "py": ".py"}
CONFIRMATION_VISUAL_AUDIT_ID = "confirmation-visual-audit"
_SCRIPT_WRITE_LOCK = threading.Lock()


class AuditScriptCatalogError(ValueError):
    pass


class AuditScriptNotFoundError(AuditScriptCatalogError):
    pass


class AuditScriptWriteError(AuditScriptCatalogError):
    pass


class AuditScriptConfigConflictError(AuditScriptCatalogError):
    pass


@dataclass(frozen=True)
class AuditScriptRecord:
    id: str
    name: str
    description: str
    language: Literal["py", "js"]
    entry: str
    entry_path: Path
    source: str
    source_sha256: str
    config_sha256: str
    content_hash: str
    editor_hash: str
    accepted_extensions: tuple[str, ...]
    parameters: tuple[dict[str, object], ...]
    runtime_settings: tuple[dict[str, object], ...]
    config: AuditScriptConfig
    updated_at: str
    visibility: Literal["public", "internal"]
    manifest_path: Path
    manifest_data: dict[str, object]


@dataclass(frozen=True)
class _AuditScriptManifest:
    id: str
    name: str
    description: str
    language: Literal["py", "js"]
    entry: str
    data: dict[str, object]
    manifest_path: Path
    script_dir: Path
    visibility: Literal["public", "internal"]


def list_audit_scripts() -> list[dict[str, object]]:
    records = [record for record in _current_records() if record.visibility == "public"]
    records.sort(key=lambda record: (record.name.casefold(), record.id))
    return [_designer_response(record) for record in records]


def list_manageable_audit_scripts() -> list[dict[str, object]]:
    records = _current_records()
    records.sort(key=lambda record: (record.name.casefold(), record.id))
    return [_management_summary(record) for record in records]


def get_audit_script_config(script_id: str) -> dict[str, object]:
    record = find_audit_script(script_id)
    state = _ensure_runtime_state(record)
    return {
        **_designer_response(record),
        "editorHash": record.editor_hash,
        "generation": int(state["generation"]),
        "status": state["status"],
        "errorMessage": state["error_message"],
        **_job_counts(script_id),
    }


def update_audit_script_config(
    script_id: str,
    *,
    expected_editor_hash: str,
    parameter_defaults: dict[str, object],
    runtime_settings: dict[str, object],
    max_concurrency: int,
    actor_id: int,
) -> dict[str, object]:
    with _SCRIPT_WRITE_LOCK:
        record = find_audit_script(script_id)
        if record.editor_hash != expected_editor_hash:
            raise AuditScriptConfigConflictError("审核脚本已被其他管理员修改，请重新加载")
        parameter_keys = {str(item["key"]) for item in record.parameters}
        setting_keys = {str(item["key"]) for item in record.runtime_settings}
        if set(parameter_defaults) != parameter_keys or set(runtime_settings) != setting_keys:
            raise AuditScriptParameterError("审核脚本配置项不完整")
        validate_script_params(record.config, parameter_defaults)
        validate_script_settings(record.config, runtime_settings)
        if not isinstance(max_concurrency, int) or isinstance(max_concurrency, bool) or not 1 <= max_concurrency <= 32:
            raise AuditScriptParameterError("审核脚本最大并发数无效")

        config_path = record.entry_path.parent / "config.json"
        try:
            config_payload = json.loads(config_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError, UnicodeError) as exc:
            raise AuditScriptWriteError("审核脚本配置读取失败") from exc
        if not isinstance(config_payload, dict):
            raise AuditScriptParameterError("审核脚本配置格式无效")
        next_config = dict(config_payload)
        next_config["parameters"] = [
            {**item, "default": parameter_defaults[str(item["key"])]}
            for item in config_payload.get("parameters", [])
        ]
        next_config["runtimeSettings"] = [
            {**item, "value": runtime_settings[str(item["key"])]}
            for item in config_payload.get("runtimeSettings", [])
        ]
        next_config["execution"] = {"maxConcurrency": max_concurrency}
        normalize_script_config(next_config)
        if _canonical_json(next_config) == _canonical_json(config_payload):
            return get_audit_script_config(script_id)

        now = utc_now_iso()
        with get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            state = _runtime_state(connection, script_id)
            generation = int(state["generation"]) if state is not None else 1
            connection.execute(
                """
                INSERT INTO audit_script_runtime_states
                    (script_id, generation, content_hash, source_hash, config_hash,
                     max_concurrency, status, error_message, updated_by, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 'updating', NULL, ?, ?)
                ON CONFLICT(script_id) DO UPDATE SET
                    status = 'updating', error_message = NULL,
                    updated_by = excluded.updated_by, updated_at = excluded.updated_at
                """,
                (script_id, generation, record.content_hash, record.source_sha256,
                 record.config_sha256, record.config.max_concurrency, actor_id, now),
            )
        from app.repositories.audit_jobs import cancel_audit_jobs_for_script
        from app.services.audit_job_worker import signal_audit_job_cancellations

        signal_audit_job_cancellations(cancel_audit_jobs_for_script(script_id, "script_updated"))
        try:
            _atomic_write_json(config_path, next_config)
            activated = find_audit_script(script_id)
            with get_connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                connection.execute(
                    """
                    UPDATE audit_script_runtime_states
                    SET generation = generation + 1, content_hash = ?, source_hash = ?,
                        config_hash = ?, max_concurrency = ?, status = 'ready', error_message = NULL,
                        updated_by = ?, updated_at = ? WHERE script_id = ?
                    """,
                    (activated.content_hash, activated.source_sha256,
                     activated.config_sha256, activated.config.max_concurrency,
                     actor_id, utc_now_iso(), script_id),
                )
        except Exception as exc:
            with get_connection() as connection:
                connection.execute(
                    """
                    UPDATE audit_script_runtime_states
                    SET status = 'error', error_message = ?, updated_by = ?, updated_at = ?
                    WHERE script_id = ?
                    """,
                    ("审核脚本配置激活失败", actor_id, utc_now_iso(), script_id),
                )
            if isinstance(exc, (AuditScriptCatalogError, AuditScriptParameterError)):
                raise
            raise AuditScriptWriteError("审核脚本配置激活失败") from exc
        return get_audit_script_config(script_id)


def synchronize_audit_script_states() -> None:
    records = _current_records()
    valid_ids = {record.id for record in records}
    for record in records:
        with get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            state = _runtime_state(connection, record.id)
            if state is None:
                connection.execute(
                    """
                    INSERT INTO audit_script_runtime_states
                        (script_id, generation, content_hash, source_hash, config_hash,
                         max_concurrency, status, error_message, updated_at)
                    VALUES (?, 1, ?, ?, ?, ?, 'ready', NULL, ?)
                    """,
                    (record.id, record.content_hash, record.source_sha256,
                     record.config_sha256, record.config.max_concurrency, utc_now_iso()),
                )
                continue
            if state["content_hash"] == record.content_hash:
                connection.execute(
                    """
                    UPDATE audit_script_runtime_states
                    SET status = 'ready', error_message = NULL, updated_at = ?
                    WHERE script_id = ?
                    """,
                    (utc_now_iso(), record.id),
                )
                continue
        from app.repositories.audit_jobs import cancel_audit_jobs_for_script
        cancel_audit_jobs_for_script(record.id, "script_updated")
        with get_connection() as connection:
            connection.execute(
                """
                UPDATE audit_script_runtime_states
                SET generation = generation + 1, content_hash = ?, source_hash = ?,
                    config_hash = ?, max_concurrency = ?, status = 'ready', error_message = NULL, updated_at = ?
                WHERE script_id = ?
                """,
                (record.content_hash, record.source_sha256, record.config_sha256,
                 record.config.max_concurrency, utc_now_iso(), record.id),
            )
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT script_id FROM audit_script_runtime_states"
        ).fetchall()
    for row in rows:
        script_id = str(row["script_id"])
        if script_id in valid_ids:
            continue
        from app.repositories.audit_jobs import cancel_audit_jobs_for_script

        cancel_audit_jobs_for_script(script_id, "script_updated")
        with get_connection() as connection:
            connection.execute(
                """
                UPDATE audit_script_runtime_states
                SET status = 'error', error_message = ?, updated_at = ?
                WHERE script_id = ?
                """,
                ("审核脚本文件无效或不存在", utc_now_iso(), script_id),
            )


def find_audit_script(script_id: str) -> AuditScriptRecord:
    matches = [record for record in _current_records() if record.id == script_id]
    if len(matches) != 1:
        raise AuditScriptNotFoundError("审核脚本不存在")
    return matches[0]


def get_audit_script_runtime(script_id: str) -> tuple[AuditScriptRecord, dict[str, object]]:
    record = find_audit_script(script_id)
    return record, dict(_ensure_runtime_state(record))


def _designer_response(record: AuditScriptRecord) -> dict[str, object]:
    return {
        "id": record.id, "name": record.name, "description": record.description,
        "language": record.language, "contentHash": record.content_hash,
        "configHash": record.config_sha256,
        "acceptedExtensions": list(record.accepted_extensions),
        "parameters": list(record.parameters),
        "runtimeSettings": list(record.runtime_settings),
        "maxConcurrency": record.config.max_concurrency,
        "updatedAt": record.updated_at,
    }


def _management_summary(record: AuditScriptRecord) -> dict[str, object]:
    state = _ensure_runtime_state(record)
    return {
        "id": record.id, "name": record.name, "description": record.description,
        "language": record.language, "parameterCount": len(record.parameters),
        "runtimeSettingCount": len(record.runtime_settings), "updatedAt": record.updated_at,
        "generation": int(state["generation"]), "status": state["status"],
        "maxConcurrency": record.config.max_concurrency, **_job_counts(record.id),
    }


def _current_records() -> list[AuditScriptRecord]:
    manifests = _valid_manifests()
    duplicate_ids = {script_id for script_id, count in Counter(m.id for m in manifests).items() if count > 1}
    records: list[AuditScriptRecord] = []
    for manifest in manifests:
        if manifest.id in duplicate_ids:
            logger.warning("跳过重复审核脚本 ID %r", manifest.id)
            continue
        try:
            records.append(_record_for_manifest(manifest))
        except (AuditScriptCatalogError, OSError) as exc:
            logger.warning("跳过无效审核脚本目录 %r：%s", manifest.id, type(exc).__name__)
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
            logger.warning("跳过无效审核脚本目录 %r：%s", manifest_path.parent.name, type(exc).__name__)
    return manifests


def _read_manifest(manifest_path: Path) -> _AuditScriptManifest:
    root = Path(settings.audit_scripts_root).resolve()
    script_dir = manifest_path.parent.resolve()
    resolved = manifest_path.resolve()
    if manifest_path.is_symlink() or not script_dir.is_relative_to(root) or not resolved.is_relative_to(script_dir):
        raise AuditScriptCatalogError("审核脚本目录越界")
    manifest = json.loads(resolved.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or "version" in manifest:
        raise AuditScriptCatalogError("审核脚本清单格式无效")
    script_id = _bounded_text(manifest.get("id"), "id", 120)
    if SCRIPT_ID_PATTERN.fullmatch(script_id) is None:
        raise AuditScriptCatalogError("审核脚本 ID 无效")
    name = _bounded_text(manifest.get("name"), "name", 120)
    description = _bounded_text(manifest.get("description"), "description", 500)
    language_value = manifest.get("language")
    if not isinstance(language_value, str) or language_value not in ENTRY_SUFFIXES:
        raise AuditScriptCatalogError("审核脚本语言无效")
    language = cast(Literal["py", "js"], language_value)
    entry = _bounded_text(manifest.get("entry"), "entry", 255)
    visibility_value = manifest.get("visibility", "public")
    if visibility_value not in {"public", "internal"}:
        raise AuditScriptCatalogError("审核脚本可见性无效")
    visibility = cast(Literal["public", "internal"], visibility_value)
    if Path(entry).is_absolute() or Path(entry).name != entry or "/" in entry or "\\" in entry or Path(entry).suffix != ENTRY_SUFFIXES[language]:
        raise AuditScriptCatalogError("审核脚本入口无效")
    return _AuditScriptManifest(script_id, name, description, language, entry,
        dict(manifest), resolved, script_dir, visibility)


def _record_for_manifest(manifest: _AuditScriptManifest) -> AuditScriptRecord:
    root = Path(settings.audit_scripts_root).resolve()
    entry_path = (manifest.script_dir / manifest.entry).resolve()
    if not entry_path.is_relative_to(manifest.script_dir) or not entry_path.is_relative_to(root):
        raise AuditScriptCatalogError("审核脚本入口越界")
    if not entry_path.is_file() or entry_path.is_symlink():
        raise AuditScriptCatalogError("审核脚本入口不存在")
    stat = entry_path.stat()
    if stat.st_size > settings.audit_script_max_bytes:
        raise AuditScriptCatalogError("审核脚本入口超限")
    try:
        source = entry_path.read_text(encoding="utf-8")
        config = load_audit_script_config(manifest.script_dir)
    except (AuditScriptParameterError, json.JSONDecodeError, OSError, UnicodeError) as exc:
        raise AuditScriptCatalogError("审核脚本配置无效") from exc
    source_hash = hashlib.sha256(source.encode("utf-8")).hexdigest()
    content_hash = _hash_json({"language": manifest.language, "entry": manifest.entry,
        "sourceHash": source_hash, "configHash": config.sha256})
    editor_hash = _hash_json({"name": manifest.name, "description": manifest.description,
        "contentHash": content_hash})
    config_path = manifest.script_dir / "config.json"
    return AuditScriptRecord(
        manifest.id, manifest.name, manifest.description, manifest.language, manifest.entry,
        entry_path, source, source_hash, config.sha256, content_hash, editor_hash,
        config.accepted_extensions, config.parameters, config.runtime_settings, config,
        datetime.fromtimestamp(max(stat.st_mtime, manifest.manifest_path.stat().st_mtime,
            config_path.stat().st_mtime if config_path.is_file() else 0), timezone.utc).isoformat(),
        manifest.visibility, manifest.manifest_path, manifest.data,
    )


def _ensure_runtime_state(record: AuditScriptRecord):
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        state = _runtime_state(connection, record.id)
        if state is None:
            connection.execute(
                """INSERT INTO audit_script_runtime_states
                (script_id, generation, content_hash, source_hash, config_hash,
                 max_concurrency, status, updated_at)
                VALUES (?, 1, ?, ?, ?, ?, 'ready', ?)""",
                (record.id, record.content_hash, record.source_sha256,
                 record.config_sha256, record.config.max_concurrency, utc_now_iso()),
            )
            state = _runtime_state(connection, record.id)
        return state


def _runtime_state(connection, script_id: str):
    return connection.execute("SELECT * FROM audit_script_runtime_states WHERE script_id = ?", (script_id,)).fetchone()


def _job_counts(script_id: str) -> dict[str, int]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT status, COUNT(*) AS count FROM audit_jobs WHERE script_id = ? AND status IN ('pending', 'running') GROUP BY status",
            (script_id,),
        ).fetchall()
    counts = {row["status"]: int(row["count"]) for row in rows}
    return {"pendingJobCount": counts.get("pending", 0), "runningJobCount": counts.get("running", 0)}


def _bounded_text(value: object, field: str, maximum: int) -> str:
    if not isinstance(value, str):
        raise AuditScriptCatalogError(f"审核脚本清单字段 {field} 无效")
    value = value.strip()
    if not value or len(value) > maximum:
        raise AuditScriptCatalogError(f"审核脚本清单字段 {field} 无效")
    return value


def _canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _hash_json(value: object) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _atomic_write_json(path: Path, payload: dict[str, object]) -> None:
    _atomic_write_text(path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def _atomic_write_text(path: Path, content: str) -> None:
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", dir=path.parent, encoding="utf-8",
            prefix=f".{path.stem}-", suffix=".tmp", delete=False) as target:
            temporary_path = Path(target.name)
            os.fchmod(target.fileno(), path.stat().st_mode & 0o777)
            target.write(content)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary_path, path)
        temporary_path = None
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
