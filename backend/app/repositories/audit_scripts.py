import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
import uuid
from pathlib import Path

from app.core.config import settings
from app.core.database import get_connection
from app.services.security import utc_now_iso


class AuditScriptConflictError(ValueError):
    pass


class AuditScriptNotFoundError(KeyError):
    pass


class AuditScriptValidationError(ValueError):
    pass


def create_audit_script(
    name: str, filename: str, content: bytes, admin_id: int
) -> dict[str, object]:
    normalized_name = _normalize_name(name)
    language = _language_for_filename(filename)
    _validate_content(content)
    script_id = str(uuid.uuid4())
    version = 1
    now = utc_now_iso()
    directory, entry_filename, sha256 = _write_version_directory(
        script_id, version, normalized_name, language, content, admin_id, now
    )
    try:
        with get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """
                INSERT INTO audit_scripts
                    (id, name, language, current_version, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (script_id, normalized_name, language, version, admin_id, now),
            )
            connection.execute(
                """
                INSERT INTO audit_script_versions
                    (script_id, version_no, entry_filename, directory_path, sha256,
                     size_bytes, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    script_id,
                    version,
                    entry_filename,
                    str(directory),
                    sha256,
                    len(content),
                    admin_id,
                    now,
                ),
            )
    except sqlite3.IntegrityError as exc:
        _remove_directory(directory)
        raise AuditScriptConflictError("脚本名称已存在") from exc
    except Exception:
        _remove_directory(directory)
        raise
    return _summary(script_id, normalized_name, language, version, sha256)


def create_audit_script_version(
    script_id: str, filename: str, content: bytes, admin_id: int
) -> dict[str, object]:
    language = _language_for_filename(filename)
    _validate_content(content)
    now = utc_now_iso()
    directory: Path | None = None
    try:
        with get_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            script = connection.execute(
                """
                SELECT name, language, current_version
                FROM audit_scripts
                WHERE id = ? AND archived_at IS NULL
                """,
                (script_id,),
            ).fetchone()
            if script is None:
                raise AuditScriptNotFoundError(script_id)
            if script["language"] != language:
                raise AuditScriptValidationError("新版本必须保持原脚本语言")
            version = int(script["current_version"]) + 1
            directory, entry_filename, sha256 = _write_version_directory(
                script_id, version, script["name"], language, content, admin_id, now
            )
            connection.execute(
                """
                INSERT INTO audit_script_versions
                    (script_id, version_no, entry_filename, directory_path, sha256,
                     size_bytes, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    script_id,
                    version,
                    entry_filename,
                    str(directory),
                    sha256,
                    len(content),
                    admin_id,
                    now,
                ),
            )
            connection.execute(
                "UPDATE audit_scripts SET current_version = ? WHERE id = ?",
                (version, script_id),
            )
    except Exception:
        if directory is not None:
            _remove_directory(directory)
        raise
    return _summary(script_id, str(script["name"]), language, version, sha256)


def list_audit_scripts() -> list[dict[str, object]]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT s.id, s.name, s.language, v.version_no, v.sha256
            FROM audit_scripts s
            JOIN audit_script_versions v
              ON v.script_id = s.id AND v.version_no = s.current_version
            WHERE s.archived_at IS NULL
            ORDER BY s.name COLLATE NOCASE, s.created_at
            """
        ).fetchall()
    return [
        _summary(
            str(row["id"]),
            str(row["name"]),
            str(row["language"]),
            int(row["version_no"]),
            str(row["sha256"]),
        )
        for row in rows
    ]


def archive_audit_script(script_id: str, admin_id: int) -> None:
    now = utc_now_iso()
    with get_connection() as connection:
        result = connection.execute(
            """
            UPDATE audit_scripts
            SET archived_at = ?
            WHERE id = ? AND archived_at IS NULL
            """,
            (now, script_id),
        )
    if result.rowcount != 1:
        raise AuditScriptNotFoundError(script_id)


def _normalize_name(value: str) -> str:
    name = value.strip()
    if not name:
        raise AuditScriptValidationError("脚本名称不能为空")
    if len(name) > 120:
        raise AuditScriptValidationError("脚本名称不能超过 120 个字符")
    return name


def _language_for_filename(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix == ".py":
        return "py"
    if suffix == ".js":
        return "js"
    raise AuditScriptValidationError("仅支持上传 .py 或 .js 脚本")


def _validate_content(content: bytes) -> None:
    if not content:
        raise AuditScriptValidationError("脚本文件不能为空")
    if len(content) > settings.audit_script_max_bytes:
        raise AuditScriptValidationError("脚本文件不能超过 1 MiB")
    try:
        content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise AuditScriptValidationError("脚本文件必须使用 UTF-8 编码") from exc


def _write_version_directory(
    script_id: str,
    version: int,
    name: str,
    language: str,
    content: bytes,
    admin_id: int,
    created_at: str,
) -> tuple[Path, str, str]:
    root = Path(settings.audit_scripts_root) / "global" / script_id
    root.mkdir(parents=True, exist_ok=True)
    directory = root / str(version)
    if directory.exists():
        raise AuditScriptConflictError("脚本版本已存在")
    temporary = Path(tempfile.mkdtemp(prefix=f".{version}-", dir=root))
    entry_filename = f"handler.{language}"
    sha256 = hashlib.sha256(content).hexdigest()
    manifest = {
        "scriptId": script_id,
        "version": version,
        "name": name,
        "language": language,
        "entryFilename": entry_filename,
        "sha256": sha256,
        "sizeBytes": len(content),
        "createdBy": admin_id,
        "createdAt": created_at,
    }
    try:
        (temporary / entry_filename).write_bytes(content)
        (temporary / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        os.replace(temporary, directory)
    except Exception:
        _remove_directory(temporary)
        raise
    return directory, entry_filename, sha256


def _remove_directory(directory: Path) -> None:
    shutil.rmtree(directory, ignore_errors=True)


def _summary(
    script_id: str, name: str, language: str, version: int, sha256: str
) -> dict[str, object]:
    return {
        "id": script_id,
        "name": name,
        "language": language,
        "version": version,
        "sha256": sha256,
    }
