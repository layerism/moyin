import hashlib
import io
import json
import textwrap
import zipfile
from pathlib import Path

import pytest

from app.core.config import settings
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
def versioned_script(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> tuple[Path, Path]:
    root = tmp_path / "scripts"
    script = root / "material-check"
    version_1 = script / "versions" / "1" / "handler.py"
    version_2 = script / "versions" / "2" / "handler.py"
    version_1.parent.mkdir(parents=True)
    version_2.parent.mkdir(parents=True)
    version_1.write_text("print('version 1')", encoding="utf-8")
    version_2.write_text("print('version 2')", encoding="utf-8")
    (script / "manifest.json").write_text(
        json.dumps(
            {
                "id": "material-check",
                "name": "材料校验",
                "description": "校验材料结构",
                "language": "py",
                "version": 2,
                "entry": "handler.py",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(settings, "audit_scripts_root", str(root))
    return version_1, version_2


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_resolves_the_requested_immutable_version(versioned_script: tuple[Path, Path]) -> None:
    version_1, version_2 = versioned_script

    descriptor = resolve_audit_script_version("material-check", 1, file_hash(version_1))

    assert descriptor.script_id == "material-check"
    assert descriptor.version == 1
    assert descriptor.language == "py"
    assert descriptor.entry_path == version_1.resolve()
    assert descriptor.sha256 == file_hash(version_1)
    assert version_2.is_file()


@pytest.mark.parametrize("latest_state", ["missing", "oversized"])
def test_resolves_old_version_when_latest_entry_is_unusable(
    versioned_script: tuple[Path, Path],
    monkeypatch: pytest.MonkeyPatch,
    latest_state: str,
) -> None:
    version_1, version_2 = versioned_script
    expected_hash = file_hash(version_1)
    if latest_state == "missing":
        version_2.unlink()
    else:
        version_2.write_bytes(b"x" * 100)
        monkeypatch.setattr(settings, "audit_script_max_bytes", 64)

    descriptor = resolve_audit_script_version("material-check", 1, expected_hash)

    assert descriptor.entry_path == version_1.resolve()
    assert descriptor.sha256 == expected_hash


def test_runtime_rejects_duplicate_manifest_ids(versioned_script: tuple[Path, Path]) -> None:
    version_1, _ = versioned_script
    duplicate = Path(settings.audit_scripts_root) / "duplicate-directory"
    duplicate_entry = duplicate / "versions" / "1" / "handler.py"
    duplicate_entry.parent.mkdir(parents=True)
    duplicate_entry.write_text("print('duplicate')", encoding="utf-8")
    (duplicate / "manifest.json").write_text(
        (version_1.parents[2] / "manifest.json").read_text("utf-8"),
        encoding="utf-8",
    )

    with pytest.raises(AuditScriptResolutionError):
        resolve_audit_script_version("material-check", 1, file_hash(version_1))


def test_rejects_mismatched_expected_hash(versioned_script: tuple[Path, Path]) -> None:
    with pytest.raises(AuditScriptResolutionError):
        resolve_audit_script_version("material-check", 1, "different-hash")


def test_rejects_missing_directory_version(versioned_script: tuple[Path, Path]) -> None:
    version_1, _ = versioned_script
    with pytest.raises(AuditScriptResolutionError):
        resolve_audit_script_version("material-check", 99, file_hash(version_1))


def test_rejects_entry_path_outside_script_root(
    versioned_script: tuple[Path, Path], tmp_path: Path
) -> None:
    version_1, _ = versioned_script
    manifest_path = version_1.parents[2] / "manifest.json"
    manifest = json.loads(manifest_path.read_text("utf-8"))
    manifest["entry"] = "../../../../escaped.py"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(AuditScriptResolutionError) as exc_info:
        resolve_audit_script_version("material-check", 1, file_hash(version_1))

    assert str(tmp_path) not in str(exc_info.value)


def test_rejects_missing_entry_file(versioned_script: tuple[Path, Path]) -> None:
    version_1, _ = versioned_script
    expected_hash = file_hash(version_1)
    version_1.unlink()

    with pytest.raises(AuditScriptResolutionError):
        resolve_audit_script_version("material-check", 1, expected_hash)


def test_rejects_entry_file_with_changed_hash(versioned_script: tuple[Path, Path]) -> None:
    version_1, _ = versioned_script
    expected_hash = file_hash(version_1)
    version_1.write_bytes(b"tampered")

    with pytest.raises(AuditScriptResolutionError) as exc_info:
        resolve_audit_script_version("material-check", 1, expected_hash)

    assert file_hash(version_1) != expected_hash
    assert str(version_1) not in str(exc_info.value)


def test_does_not_leak_path_when_entry_read_fails(
    versioned_script: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    version_1, _ = versioned_script
    expected_hash = file_hash(version_1)

    def fail_to_open(path: Path, *args: object, **kwargs: object) -> object:
        raise OSError(f"cannot read {path}")

    monkeypatch.setattr(Path, "open", fail_to_open)

    with pytest.raises(AuditScriptResolutionError) as exc_info:
        resolve_audit_script_version("material-check", 1, expected_hash)

    assert str(version_1) not in str(exc_info.value)


def test_does_not_leak_path_when_manifest_read_fails(
    versioned_script: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    version_1, _ = versioned_script
    expected_hash = file_hash(version_1)
    manifest_path = version_1.parents[2] / "manifest.json"
    original_read_text = Path.read_text

    def fail_manifest_read(path: Path, *args: object, **kwargs: object) -> str:
        if path == manifest_path:
            raise OSError(f"cannot read {path}")
        return original_read_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", fail_manifest_read)

    with pytest.raises(AuditScriptResolutionError) as exc_info:
        resolve_audit_script_version("material-check", 1, expected_hash)

    assert str(manifest_path) not in str(exc_info.value)
