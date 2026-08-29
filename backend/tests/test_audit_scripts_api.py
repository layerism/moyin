import hashlib
import json
from collections.abc import Iterator
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app.core.config import settings
from app.core.database import get_connection
from app.main import app
from app.services.audit_script_catalog import list_audit_scripts
from tests.teacher_auth_helpers import login_teacher, provision_teacher


def write_script(
    root: Path,
    script_id: str = "material-check",
    version: int = 1,
    *,
    directory_name: str | None = None,
    language: str = "py",
    entry_name: str | None = None,
    source: str = "def run(payload): return {'passed': True}",
) -> Path:
    script = root / (directory_name or script_id)
    version_dir = script / "versions" / str(version)
    version_dir.mkdir(parents=True)
    entry = version_dir / (entry_name or ("handler.py" if language == "py" else "handler.js"))
    entry.write_text(source, encoding="utf-8")
    (script / "manifest.json").write_text(
        json.dumps(
            {
                "id": script_id,
                "name": "材料基础校验",
                "description": "校验材料结构",
                "language": language,
                "version": version,
                "entry": entry.name,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return entry


@pytest.fixture
def script_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "scripts"
    monkeypatch.setattr(settings, "audit_scripts_root", str(root))
    return root


@pytest.fixture
def client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, script_root: Path
) -> Iterator[TestClient]:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "test.db"))
    with TestClient(app) as test_client:
        yield test_client


def register_teacher(client: TestClient, employee_no: str = "16001") -> None:
    provision_teacher(employee_no=employee_no, name="测试教师")
    login_teacher(client, employee_no=employee_no, name="测试教师")


def promote_current_teacher() -> None:
    with get_connection() as connection:
        connection.execute("UPDATE teacher_accounts SET role = 'super_admin'")


def test_catalog_lists_valid_scripts_with_computed_hash(script_root: Path) -> None:
    entry = write_script(script_root)

    scripts = list_audit_scripts()

    assert scripts == [
        {
            "id": "material-check",
            "name": "材料基础校验",
            "description": "校验材料结构",
            "language": "py",
            "version": 1,
            "sha256": hashlib.sha256(entry.read_bytes()).hexdigest(),
            "updatedAt": scripts[0]["updatedAt"],
        }
    ]
    assert isinstance(scripts[0]["updatedAt"], str)
    assert scripts[0]["updatedAt"]


def test_catalog_returns_empty_list_for_missing_or_empty_root(script_root: Path) -> None:
    assert list_audit_scripts() == []

    script_root.mkdir()
    assert list_audit_scripts() == []


def test_catalog_omits_malformed_manifest(script_root: Path) -> None:
    script = script_root / "broken"
    script.mkdir(parents=True)
    (script / "manifest.json").write_text("{not-json", encoding="utf-8")

    assert list_audit_scripts() == []


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("id", "Material_Check"),
        ("name", ""),
        ("description", ""),
        ("language", "python"),
        ("language", []),
        ("version", 0),
        ("version", True),
        ("entry", "../handler.py"),
        ("entry", "handler.js"),
    ],
)
def test_catalog_omits_invalid_manifest_fields(
    script_root: Path, field: str, value: object
) -> None:
    write_script(script_root)
    manifest_path = script_root / "material-check" / "manifest.json"
    manifest = json.loads(manifest_path.read_text("utf-8"))
    manifest[field] = value
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    assert list_audit_scripts() == []


def test_catalog_omits_missing_and_oversized_entries(
    script_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    missing = write_script(script_root, "missing")
    missing.unlink()
    oversized = write_script(script_root, "oversized")
    monkeypatch.setattr(settings, "audit_script_max_bytes", 4)

    assert oversized.stat().st_size > settings.audit_script_max_bytes
    assert list_audit_scripts() == []


def test_catalog_omits_entry_symlink_that_escapes_script_directory(script_root: Path) -> None:
    entry = write_script(script_root)
    outside = script_root / "outside.py"
    outside.write_text("print('outside')", encoding="utf-8")
    entry.unlink()
    entry.symlink_to(outside)

    assert list_audit_scripts() == []


def test_catalog_omits_all_scripts_with_duplicate_ids(script_root: Path) -> None:
    write_script(script_root, "duplicate", directory_name="first")
    write_script(script_root, "duplicate", directory_name="second")

    assert list_audit_scripts() == []


def test_catalog_has_stable_name_then_id_order(script_root: Path) -> None:
    write_script(script_root, "z-script")
    write_script(script_root, "a-script")
    manifest_path = script_root / "a-script" / "manifest.json"
    manifest = json.loads(manifest_path.read_text("utf-8"))
    manifest["name"] = "阿尔法校验"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")

    assert [script["id"] for script in list_audit_scripts()] == ["z-script", "a-script"]


def test_authenticated_teacher_lists_preconfigured_scripts(
    client: TestClient, script_root: Path
) -> None:
    entry = write_script(script_root)
    register_teacher(client)

    response = client.get("/api/workflow-admin/audit-scripts")

    assert response.status_code == 200
    assert response.json()[0]["id"] == "material-check"
    assert response.json()[0]["sha256"] == hashlib.sha256(entry.read_bytes()).hexdigest()


def test_audit_script_write_and_template_routes_do_not_exist(client: TestClient) -> None:
    register_teacher(client)
    promote_current_teacher()

    assert client.get("/api/workflow-admin/audit-scripts/templates/python").status_code == 404
    assert client.post("/api/workflow-admin/audit-scripts").status_code == 405
    assert client.put("/api/workflow-admin/audit-scripts/material-check").status_code == 404
    assert client.delete("/api/workflow-admin/audit-scripts/material-check").status_code == 404
