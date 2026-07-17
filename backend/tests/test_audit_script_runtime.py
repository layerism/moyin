import hashlib
import io
import sqlite3
import textwrap
import zipfile
from contextlib import contextmanager
from pathlib import Path

import pytest

from app.core.config import settings
from app.core.database import get_connection, initialize_database
from app.repositories.audit_scripts import create_audit_script, create_audit_script_version
from app.services.audit_script_runtime import (
    AuditScriptResolutionError,
    AuditScriptRuntimeDescriptor,
    resolve_audit_script_version,
)
from app.services.audit_script_executor import (
    AuditMaterial,
    AuditScriptExecutionError,
    execute_audit_script,
    stage_audit_materials,
)
import app.services.audit_script_runtime as audit_script_runtime


class MemoryStorage:
    def __init__(self, objects: dict[str, bytes]):
        self.objects = objects

    def download_to_file(self, key: str, destination: Path) -> None:
        destination.write_bytes(self.objects[key])


def material(key: str, name: str, content: bytes, *, file_id: str = "file-1") -> AuditMaterial:
    return AuditMaterial(
        id=file_id,
        name=name,
        storage_key=key,
        content_type="application/octet-stream",
        size=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
    )


def ooxml_bytes(folder: str) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types />")
        archive.writestr(f"{folder}/document.xml", "<root />")
    return output.getvalue()


def runtime_descriptor(path: Path, language: str) -> AuditScriptRuntimeDescriptor:
    return AuditScriptRuntimeDescriptor(
        script_id="script-id",
        version=1,
        language=language,
        entry_path=path,
        sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
    )


def runtime_materials() -> tuple[list[AuditMaterial], MemoryStorage]:
    pdf = b"%PDF-1.4\n%%EOF"
    png = b"\x89PNG\r\n\x1a\ncontent"
    return (
        [
            material("pdf-key", "申请.pdf", pdf, file_id="pdf-1"),
            material("png-key", "图片.png", png, file_id="png-1"),
        ],
        MemoryStorage({"pdf-key": pdf, "png-key": png}),
    )


def assert_runtime_root_clean(root: Path) -> None:
    assert root.exists()
    assert list(root.iterdir()) == []


def test_audit_runtime_has_explicit_node_configuration() -> None:
    assert settings.audit_node_executable
    assert Path(settings.audit_node_modules_path).name == "node_modules"


def test_docker_runtime_points_executor_at_installed_node_modules() -> None:
    dockerfile = Path(__file__).resolve().parents[1] / "Dockerfile"

    assert "AUDIT_NODE_MODULES_PATH=/opt/audit-runtime/node_modules" in dockerfile.read_text(
        "utf-8"
    )


def test_stage_audit_materials_validates_and_stages_multiple_files(tmp_path: Path) -> None:
    pdf = b"%PDF-1.4\n%%EOF"
    png = b"\x89PNG\r\n\x1a\ncontent"
    storage = MemoryStorage({"pdf-key": pdf, "png-key": png})

    staged = stage_audit_materials(
        [
            material("pdf-key", "申请.PDF", pdf, file_id="pdf-1"),
            material("png-key", "图片.png", png, file_id="png-1"),
        ],
        tmp_path,
        storage,
    )

    assert [item["extension"] for item in staged] == [".pdf", ".png"]
    assert all(Path(str(item["path"])).is_relative_to(tmp_path.resolve()) for item in staged)
    assert [Path(str(item["path"])).name for item in staged] == ["pdf-1.pdf", "png-1.png"]


@pytest.mark.parametrize(
    ("name", "content"),
    [
        ("unsafe.exe", b"MZ"),
        ("fake.pdf", b"not-a-pdf"),
        ("fake.docx", ooxml_bytes("xl")),
        ("fake.xlsx", ooxml_bytes("ppt")),
        ("fake.pptx", ooxml_bytes("word")),
    ],
)
def test_stage_audit_materials_rejects_unsupported_or_forged_files(
    tmp_path: Path, name: str, content: bytes
) -> None:
    storage = MemoryStorage({"secret/storage-key": content})

    with pytest.raises(AuditScriptExecutionError) as exc_info:
        stage_audit_materials([material("secret/storage-key", name, content)], tmp_path, storage)

    assert str(tmp_path) not in str(exc_info.value)
    assert "secret/storage-key" not in str(exc_info.value)


def test_stage_audit_materials_rejects_hash_mismatch(tmp_path: Path) -> None:
    content = b"%PDF-1.4\n%%EOF"
    wrong = material("pdf-key", "file.pdf", content)
    wrong = AuditMaterial(**{**wrong.__dict__, "sha256": "0" * 64})

    with pytest.raises(AuditScriptExecutionError):
        stage_audit_materials([wrong], tmp_path, MemoryStorage({"pdf-key": content}))


def test_stage_audit_materials_rejects_duplicate_file_ids(tmp_path: Path) -> None:
    first = b"%PDF-1.4\n%%EOF"
    second = b"%PDF-1.5\n%%EOF"
    storage = MemoryStorage({"first": first, "second": second})

    with pytest.raises(AuditScriptExecutionError, match="标识"):
        stage_audit_materials(
            [
                material("first", "first.pdf", first, file_id="duplicate"),
                material("second", "second.pdf", second, file_id="duplicate"),
            ],
            tmp_path,
            storage,
        )


@pytest.mark.parametrize("language", ["py", "js"])
def test_execute_audit_script_runs_multifile_json_protocol(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, language: str
) -> None:
    audit_root = tmp_path / "audit"
    monkeypatch.setattr(settings, "audit_temp_root", str(audit_root))
    monkeypatch.setenv("OSS_ACCESS_KEY_SECRET", "must-not-leak")
    suffix = ".py" if language == "py" else ".js"
    entry = tmp_path / f"handler{suffix}"
    if language == "py":
        entry.write_text(
            textwrap.dedent(
                """
                import json, os, sys
                payload = json.loads(sys.stdin.read())
                valid = (
                    len(payload["files"]) == 2
                    and payload["context"] == {"nodeId": "node-1"}
                    and "OSS_ACCESS_KEY_SECRET" not in os.environ
                )
                print(json.dumps({
                    "schemaVersion": "1.0", "passed": valid, "reason": "",
                    "details": {"checkedFileCount": len(payload["files"]), "issues": []}
                }))
                """
            ),
            "utf-8",
        )
    else:
        entry.write_text(
            """
            const fs = require("node:fs");
            const payload = JSON.parse(fs.readFileSync(0, "utf8"));
            const valid = payload.files.length === 2
              && payload.context.nodeId === "node-1"
              && !("OSS_ACCESS_KEY_SECRET" in process.env);
            process.stdout.write(JSON.stringify({schemaVersion: "1.0", passed: valid,
              reason: "", details: {checkedFileCount: payload.files.length, issues: []}}));
            """,
            "utf-8",
        )
    materials, storage = runtime_materials()

    result = execute_audit_script(
        runtime_descriptor(entry, language),
        materials,
        {"nodeId": "node-1"},
        storage=storage,
    )

    assert result["passed"] is True
    assert result["details"] == {"checkedFileCount": 2, "issues": []}
    assert_runtime_root_clean(audit_root)


def test_execute_audit_script_rejects_empty_materials(tmp_path: Path) -> None:
    entry = tmp_path / "handler.py"
    entry.write_text("pass", "utf-8")

    with pytest.raises(AuditScriptExecutionError, match="不能为空"):
        execute_audit_script(runtime_descriptor(entry, "py"), [], {}, storage=MemoryStorage({}))


@pytest.mark.parametrize(
    ("source", "setting", "limit", "message"),
    [
        ("import time; time.sleep(1)", "audit_script_timeout_seconds", 0.05, "超时"),
        ("import sys; sys.exit(2)", None, None, "执行失败"),
        ("print('not-json')", None, None, "输出协议无效"),
        (
            'print(\'{"schemaVersion":"2.0","passed":true,"reason":"","details":{"checkedFileCount":2,"issues":[]}}\')',
            None,
            None,
            "输出协议无效",
        ),
        (
            'print(\'{"schemaVersion":"1.0","passed":true,"reason":"","details":{"checkedFileCount":1,"issues":[]}}\')',
            None,
            None,
            "文件数量不一致",
        ),
        ("print('x' * 100)", "audit_script_stdout_max_bytes", 32, "标准输出超限"),
        (
            "import sys; sys.stderr.write('x' * 100); print('{}')",
            "audit_script_stderr_max_bytes",
            32,
            "标准错误超限",
        ),
    ],
)
def test_execute_audit_script_rejects_runtime_failures_and_cleans_temp_directory(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    source: str,
    setting: str | None,
    limit: float | int | None,
    message: str,
) -> None:
    audit_root = tmp_path / "audit"
    monkeypatch.setattr(settings, "audit_temp_root", str(audit_root))
    if setting:
        monkeypatch.setattr(settings, setting, limit)
    entry = tmp_path / "handler.py"
    entry.write_text(source, "utf-8")
    materials, storage = runtime_materials()

    with pytest.raises(AuditScriptExecutionError, match=message):
        execute_audit_script(runtime_descriptor(entry, "py"), materials, {}, storage=storage)

    assert_runtime_root_clean(audit_root)


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


def test_rejects_entry_path_outside_script_root(audit_script_admin: int, tmp_path: Path) -> None:
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
    entry_path = (
        Path(settings.audit_scripts_root) / "global" / str(created["id"]) / "1" / "handler.py"
    )
    entry_path.unlink()

    with pytest.raises(AuditScriptResolutionError):
        resolve_audit_script_version(str(created["id"]), 1, str(created["sha256"]))


def test_rejects_entry_file_with_changed_hash(audit_script_admin: int) -> None:
    created, _ = create_versioned_script(audit_script_admin)
    entry_path = (
        Path(settings.audit_scripts_root) / "global" / str(created["id"]) / "1" / "handler.py"
    )
    entry_path.write_bytes(b"tampered")

    with pytest.raises(AuditScriptResolutionError) as exc_info:
        resolve_audit_script_version(str(created["id"]), 1, str(created["sha256"]))

    assert hashlib.sha256(entry_path.read_bytes()).hexdigest() != created["sha256"]
    assert str(entry_path) not in str(exc_info.value)


def test_does_not_leak_path_when_entry_read_fails(
    audit_script_admin: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    created, _ = create_versioned_script(audit_script_admin)
    entry_path = (
        Path(settings.audit_scripts_root) / "global" / str(created["id"]) / "1" / "handler.py"
    )

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
