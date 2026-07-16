import json
from collections.abc import Iterator
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app.core.config import settings
from app.core.database import get_connection
from app.main import app
from app.services.audit_script_templates import get_template_source


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "test.db"))
    monkeypatch.setattr(settings, "audit_scripts_root", str(tmp_path / "scripts"))
    with TestClient(app) as test_client:
        yield test_client


def register_teacher(client: TestClient, employee_no: str = "TS001") -> None:
    response = client.post(
        "/api/auth/teacher/register",
        json={"name": "测试教师", "employeeNo": employee_no, "password": "Pass1234"},
    )
    assert response.status_code == 201


def promote_current_teacher() -> None:
    with get_connection() as connection:
        connection.execute("UPDATE teacher_accounts SET role = 'super_admin'")


def test_python_template_uses_json_stdin_stdout_contract() -> None:
    source, filename = get_template_source("python")

    assert filename == "audit_script_template.py"
    assert "def run(payload: dict) -> dict:" in source
    assert "json.loads(sys.stdin.read())" in source
    assert "json.dumps(result" in source


def test_teacher_can_list_but_cannot_download_or_upload_script(client: TestClient) -> None:
    register_teacher(client)

    assert client.get("/api/workflow-admin/audit-scripts").json() == []
    assert client.get("/api/workflow-admin/audit-scripts/templates/python").status_code == 403
    response = client.post(
        "/api/workflow-admin/audit-scripts",
        data={"name": "材料审核"},
        files={"file": ("audit.py", b"def run(payload): return {}", "text/x-python")},
    )
    assert response.status_code == 403


def test_super_admin_uploads_versioned_script_and_manifest(client: TestClient) -> None:
    register_teacher(client)
    promote_current_teacher()

    response = client.post(
        "/api/workflow-admin/audit-scripts",
        data={"name": "材料基础校验"},
        files={"file": ("check.py", b"def run(payload): return {'passed': True}", "text/x-python")},
    )

    assert response.status_code == 201
    script = response.json()
    assert script["language"] == "py"
    assert script["version"] == 1
    assert "directoryPath" not in script
    directory = Path(settings.audit_scripts_root) / "global" / script["id"] / "1"
    assert (directory / "handler.py").exists()
    manifest = json.loads((directory / "manifest.json").read_text("utf-8"))
    assert manifest["sha256"] == script["sha256"]
    assert manifest["entryFilename"] == "handler.py"


def test_super_admin_creates_immutable_new_version_and_archives_script(client: TestClient) -> None:
    register_teacher(client)
    promote_current_teacher()
    created = client.post(
        "/api/workflow-admin/audit-scripts",
        data={"name": "材料命名校验"},
        files={"file": ("name.js", b"async function run(payload) { return { passed: true }; }", "text/javascript")},
    ).json()

    versioned = client.put(
        f"/api/workflow-admin/audit-scripts/{created['id']}",
        files={"file": ("name.js", b"async function run(payload) { return { passed: false }; }", "text/javascript")},
    )
    assert versioned.status_code == 200
    assert versioned.json()["version"] == 2
    assert (Path(settings.audit_scripts_root) / "global" / created["id"] / "1" / "handler.js").exists()
    assert (Path(settings.audit_scripts_root) / "global" / created["id"] / "2" / "handler.js").exists()

    archived = client.delete(f"/api/workflow-admin/audit-scripts/{created['id']}")
    assert archived.status_code == 204
    assert client.get("/api/workflow-admin/audit-scripts").json() == []


def test_script_upload_rejects_empty_and_unsupported_sources(client: TestClient) -> None:
    register_teacher(client)
    promote_current_teacher()

    empty = client.post(
        "/api/workflow-admin/audit-scripts",
        data={"name": "空脚本"},
        files={"file": ("empty.py", b"", "text/x-python")},
    )
    unsupported = client.post(
        "/api/workflow-admin/audit-scripts",
        data={"name": "不支持"},
        files={"file": ("script.sh", b"echo unsafe", "text/plain")},
    )

    assert empty.status_code == 422
    assert unsupported.status_code == 422
