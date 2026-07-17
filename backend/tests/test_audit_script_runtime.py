import hashlib
import sqlite3
from contextlib import contextmanager
from pathlib import Path

import pytest

from app.core.config import settings
from app.core.database import get_connection, initialize_database
from app.repositories.audit_scripts import create_audit_script, create_audit_script_version
from app.services.audit_script_runtime import (
    AuditScriptResolutionError,
    resolve_audit_script_version,
)
import app.services.audit_script_runtime as audit_script_runtime


@pytest.fixture
def audit_script_admin(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> int:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "test.db"))
    monkeypatch.setattr(settings, "audit_scripts_root", str(tmp_path / "scripts"))
    initialize_database()
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO teacher_accounts
                (name, employee_no, password_hash, role, created_at, updated_at)
            VALUES
                ('测试管理员', 'ADMIN001', 'hash', 'super_admin',
                 '2026-07-17T00:00:00+00:00', '2026-07-17T00:00:00+00:00')
            """
        )
        return int(connection.execute("SELECT id FROM teacher_accounts").fetchone()[0])


def create_versioned_script(admin_id: int) -> tuple[dict[str, object], dict[str, object]]:
    created = create_audit_script(
        "材料校验",
        "初始版本",
        "check.py",
        b"def run(payload): return {'passed': True}",
        admin_id,
    )
    versioned = create_audit_script_version(
        str(created["id"]),
        "固定版本",
        "check.py",
        b"def run(payload): return {'passed': False}",
        admin_id,
    )
    return created, versioned


def test_resolves_the_requested_immutable_version(audit_script_admin: int) -> None:
    created, versioned = create_versioned_script(audit_script_admin)

    descriptor = resolve_audit_script_version(
        str(created["id"]), int(created["version"]), str(created["sha256"])
    )

    assert descriptor.script_id == created["id"]
    assert descriptor.version == 1
    assert descriptor.language == "py"
    assert descriptor.entry_path.name == "handler.py"
    assert descriptor.sha256 == created["sha256"]
    assert versioned["version"] == 2


def test_rejects_mismatched_expected_hash(audit_script_admin: int) -> None:
    created, _ = create_versioned_script(audit_script_admin)

    with pytest.raises(AuditScriptResolutionError):
        resolve_audit_script_version(str(created["id"]), 1, "different-hash")


def test_rejects_missing_database_version(audit_script_admin: int) -> None:
    created, _ = create_versioned_script(audit_script_admin)

    with pytest.raises(AuditScriptResolutionError):
        resolve_audit_script_version(str(created["id"]), 99, str(created["sha256"]))


def test_rejects_entry_path_outside_script_root(
    audit_script_admin: int, tmp_path: Path
) -> None:
    created, _ = create_versioned_script(audit_script_admin)
    with get_connection() as connection:
        connection.execute(
            "UPDATE audit_script_versions SET entry_filename = ? WHERE script_id = ? AND version_no = 1",
            ("../../../../escaped.py", str(created["id"])),
        )

    with pytest.raises(AuditScriptResolutionError) as exc_info:
        resolve_audit_script_version(str(created["id"]), 1, str(created["sha256"]))

    assert str(tmp_path) not in str(exc_info.value)


def test_rejects_missing_entry_file(audit_script_admin: int) -> None:
    created, _ = create_versioned_script(audit_script_admin)
    entry_path = Path(settings.audit_scripts_root) / "global" / str(created["id"]) / "1" / "handler.py"
    entry_path.unlink()

    with pytest.raises(AuditScriptResolutionError):
        resolve_audit_script_version(str(created["id"]), 1, str(created["sha256"]))


def test_rejects_entry_file_with_changed_hash(audit_script_admin: int) -> None:
    created, _ = create_versioned_script(audit_script_admin)
    entry_path = Path(settings.audit_scripts_root) / "global" / str(created["id"]) / "1" / "handler.py"
    entry_path.write_bytes(b"tampered")

    with pytest.raises(AuditScriptResolutionError) as exc_info:
        resolve_audit_script_version(str(created["id"]), 1, str(created["sha256"]))

    assert hashlib.sha256(entry_path.read_bytes()).hexdigest() != created["sha256"]
    assert str(entry_path) not in str(exc_info.value)


def test_does_not_leak_path_when_entry_read_fails(
    audit_script_admin: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    created, _ = create_versioned_script(audit_script_admin)
    entry_path = Path(settings.audit_scripts_root) / "global" / str(created["id"]) / "1" / "handler.py"

    def fail_to_open(path: Path, *args: object, **kwargs: object) -> object:
        raise OSError(f"cannot read {path}")

    monkeypatch.setattr(Path, "open", fail_to_open)

    with pytest.raises(AuditScriptResolutionError) as exc_info:
        resolve_audit_script_version(str(created["id"]), 1, str(created["sha256"]))

    assert str(entry_path) not in str(exc_info.value)


def test_does_not_leak_path_when_database_query_fails(
    audit_script_admin: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    created, _ = create_versioned_script(audit_script_admin)

    @contextmanager
    def unavailable_connection():
        raise sqlite3.OperationalError(f"cannot open {settings.database_path}")
        yield

    monkeypatch.setattr(audit_script_runtime, "get_connection", unavailable_connection)

    with pytest.raises(AuditScriptResolutionError) as exc_info:
        resolve_audit_script_version(str(created["id"]), 1, str(created["sha256"]))

    assert settings.database_path not in str(exc_info.value)
