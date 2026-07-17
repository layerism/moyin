import json
import sqlite3
from collections.abc import Iterator
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

from fastapi.testclient import TestClient
import pytest
from starlette.datastructures import UploadFile as StarletteUploadFile

from app.core.config import settings
from app.core.database import get_connection, initialize_database
from app.main import app
from app.repositories.audit_scripts import (
    create_audit_script,
    create_audit_script_version,
    list_audit_scripts,
)
from app.services.audit_script_templates import get_template_archive


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


@pytest.mark.parametrize(
    ("language", "filename", "entry"),
    [
        ("python", "audit-script-python-template.zip", "handler.py"),
        ("javascript", "audit-script-javascript-template.zip", "handler.js"),
    ],
)
def test_template_archive_contains_contract_files(language: str, filename: str, entry: str) -> None:
    content, actual_filename = get_template_archive(language)

    assert actual_filename == filename
    with ZipFile(BytesIO(content)) as archive:
        assert set(archive.namelist()) == {
            entry,
            "input.example.json",
            "output.example.json",
            "README.md",
        }
        source = archive.read(entry).decode("utf-8")
        assert '"schemaVersion"' in archive.read("input.example.json").decode("utf-8")
        assert '"checkedFileCount"' in archive.read("output.example.json").decode("utf-8")
        assert ".docx" in source and ".png" in source
        expected_imports = (
            (
                "import fitz",
                "import openpyxl",
                "from docx import Document",
                "from PIL import Image",
                "from pptx import Presentation",
            )
            if language == "python"
            else (
                'require("read-excel-file/node")',
                'require("mammoth")',
                'require("pdf-parse")',
                'require("jszip")',
                'require("fast-xml-parser")',
                'require("sharp")',
            )
        )
        assert all(dependency in source for dependency in expected_imports)
        assert 'message": "文件解析失败"' in source or 'message: "文件解析失败"' in source
        if language == "javascript":
            assert 'require("node:fs/promises")' in source


@pytest.mark.parametrize(
    ("language", "filename"),
    [
        ("python", "audit-script-python-template.zip"),
        ("javascript", "audit-script-javascript-template.zip"),
    ],
)
def test_super_admin_downloads_template_archive(
    client: TestClient, language: str, filename: str
) -> None:
    register_teacher(client)
    promote_current_teacher()

    response = client.get(f"/api/workflow-admin/audit-scripts/templates/{language}")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert filename in response.headers["content-disposition"]
    with ZipFile(BytesIO(response.content)) as archive:
        assert "README.md" in archive.namelist()


def test_repository_persists_script_description_and_updated_at(client: TestClient) -> None:
    register_teacher(client)
    promote_current_teacher()
    with get_connection() as connection:
        admin_id = int(
            connection.execute(
                "SELECT id FROM teacher_accounts WHERE employee_no = 'TS001'"
            ).fetchone()[0]
        )

    created = create_audit_script(
        "材料基础校验",
        "校验文件结构与字段",
        "check.py",
        b"def run(payload): return {'passed': True}",
        admin_id,
    )

    assert created["description"] == "校验文件结构与字段"
    assert created["updatedAt"]
    assert list_audit_scripts()[0]["description"] == "校验文件结构与字段"

    versioned = create_audit_script_version(
        str(created["id"]),
        "校验文件结构、字段和格式",
        "check.py",
        b"def run(payload): return {'passed': False}",
        admin_id,
    )

    assert versioned["version"] == 2
    assert versioned["description"] == "校验文件结构、字段和格式"
    assert versioned["updatedAt"]


def test_initialize_database_migrates_legacy_audit_script_metadata(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database_path = tmp_path / "legacy.db"
    with sqlite3.connect(database_path) as connection:
        connection.executescript(
            """
            CREATE TABLE audit_scripts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                language TEXT NOT NULL,
                current_version INTEGER NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                archived_at TEXT
            );
            INSERT INTO audit_scripts
                (id, name, language, current_version, created_by, created_at, archived_at)
            VALUES ('legacy-script', '旧版脚本', 'py', 1, 1, '2026-07-17T00:00:00+00:00', NULL);
            """
        )
    monkeypatch.setattr(settings, "database_path", str(database_path))

    initialize_database()

    with sqlite3.connect(database_path) as connection:
        columns = {row[1]: row for row in connection.execute("PRAGMA table_info(audit_scripts)")}
        legacy_script = connection.execute(
            "SELECT description, created_at, updated_at FROM audit_scripts WHERE id = 'legacy-script'"
        ).fetchone()
        migration = connection.execute(
            "SELECT 1 FROM schema_migrations WHERE id = '20260717_add_audit_script_metadata'"
        ).fetchone()

    assert {"description", "updated_at"}.issubset(columns)
    assert columns["updated_at"][3] == 1
    assert legacy_script == ("", "2026-07-17T00:00:00+00:00", "2026-07-17T00:00:00+00:00")
    assert migration == (1,)


def test_teacher_can_list_but_cannot_download_or_upload_script(client: TestClient) -> None:
    register_teacher(client)

    assert client.get("/api/workflow-admin/audit-scripts").json() == []
    assert client.get("/api/workflow-admin/audit-scripts/templates/python").status_code == 403
    response = client.post(
        "/api/workflow-admin/audit-scripts",
        data={"name": "材料审核", "description": "校验材料"},
        files={"file": ("audit.py", b"def run(payload): return {}", "text/x-python")},
    )
    assert response.status_code == 403

    with get_connection() as connection:
        admin_id = int(
            connection.execute(
                "SELECT id FROM teacher_accounts WHERE employee_no = 'TS001'"
            ).fetchone()[0]
        )
    created = create_audit_script(
        "教师不可更新",
        "用于校验更新权限",
        "audit.py",
        b"def run(payload): return {}",
        admin_id,
    )
    versioned = client.put(
        f"/api/workflow-admin/audit-scripts/{created['id']}",
        data={"description": "教师不能创建新版本"},
        files={"file": ("audit.py", b"def run(payload): return {}", "text/x-python")},
    )
    assert versioned.status_code == 403


def test_upload_requires_nonempty_description(client: TestClient) -> None:
    register_teacher(client)
    promote_current_teacher()

    missing = client.post(
        "/api/workflow-admin/audit-scripts",
        data={"name": "材料审核"},
        files={"file": ("audit.py", b"def run(payload): return {}", "text/x-python")},
    )
    empty = client.post(
        "/api/workflow-admin/audit-scripts",
        data={"name": "材料审核", "description": ""},
        files={"file": ("audit.py", b"def run(payload): return {}", "text/x-python")},
    )

    assert missing.status_code == 422
    assert empty.status_code == 422


def test_super_admin_uploads_versioned_script_and_manifest(client: TestClient) -> None:
    register_teacher(client)
    promote_current_teacher()

    response = client.post(
        "/api/workflow-admin/audit-scripts",
        data={"name": "材料基础校验", "description": "校验文件结构与字段"},
        files={"file": ("check.py", b"def run(payload): return {'passed': True}", "text/x-python")},
    )

    assert response.status_code == 201
    script = response.json()
    assert script["language"] == "py"
    assert script["version"] == 1
    assert script["description"] == "校验文件结构与字段"
    assert script["updatedAt"]
    assert "directoryPath" not in script
    directory = Path(settings.audit_scripts_root) / "global" / script["id"] / "1"
    assert (directory / "handler.py").exists()
    manifest = json.loads((directory / "manifest.json").read_text("utf-8"))
    assert manifest["sha256"] == script["sha256"]
    assert manifest["entryFilename"] == "handler.py"
    assert manifest["description"] == "校验文件结构与字段"

    listed = client.get("/api/workflow-admin/audit-scripts")
    assert listed.status_code == 200
    assert listed.json()[0]["description"] == "校验文件结构与字段"
    assert listed.json()[0]["updatedAt"]
    assert "directoryPath" not in listed.json()[0]
    assert "entryFilename" not in listed.json()[0]
    assert "source" not in listed.json()[0]


def test_super_admin_creates_immutable_new_version_and_archives_script(client: TestClient) -> None:
    register_teacher(client)
    promote_current_teacher()
    created = client.post(
        "/api/workflow-admin/audit-scripts",
        data={"name": "材料命名校验", "description": "校验材料命名"},
        files={
            "file": (
                "name.js",
                b"async function run(payload) { return { passed: true }; }",
                "text/javascript",
            )
        },
    ).json()

    versioned = client.put(
        f"/api/workflow-admin/audit-scripts/{created['id']}",
        data={"description": "校验材料命名和格式"},
        files={
            "file": (
                "name.js",
                b"async function run(payload) { return { passed: false }; }",
                "text/javascript",
            )
        },
    )
    assert versioned.status_code == 200
    assert versioned.json()["version"] == 2
    assert versioned.json()["description"] == "校验材料命名和格式"
    assert (
        Path(settings.audit_scripts_root) / "global" / created["id"] / "1" / "handler.js"
    ).exists()
    assert (
        Path(settings.audit_scripts_root) / "global" / created["id"] / "2" / "handler.js"
    ).exists()

    wrong_language = client.put(
        f"/api/workflow-admin/audit-scripts/{created['id']}",
        data={"description": "改为 Python"},
        files={"file": ("name.py", b"def run(payload): return {'passed': True}", "text/x-python")},
    )
    assert wrong_language.status_code == 422

    archived = client.delete(f"/api/workflow-admin/audit-scripts/{created['id']}")
    assert archived.status_code == 204
    assert client.get("/api/workflow-admin/audit-scripts").json() == []


def test_script_upload_rejects_empty_and_unsupported_sources(client: TestClient) -> None:
    register_teacher(client)
    promote_current_teacher()

    empty = client.post(
        "/api/workflow-admin/audit-scripts",
        data={"name": "空脚本", "description": "空内容校验"},
        files={"file": ("empty.py", b"", "text/x-python")},
    )
    unsupported = client.post(
        "/api/workflow-admin/audit-scripts",
        data={"name": "不支持", "description": "格式校验"},
        files={"file": ("script.sh", b"echo unsafe", "text/plain")},
    )

    assert empty.status_code == 422
    assert unsupported.status_code == 422


def test_upload_routes_read_at_most_one_byte_past_script_limit(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    register_teacher(client)
    promote_current_teacher()
    with get_connection() as connection:
        admin_id = int(
            connection.execute(
                "SELECT id FROM teacher_accounts WHERE employee_no = 'TS001'"
            ).fetchone()[0]
        )
    existing = create_audit_script(
        "可更新脚本",
        "用于上传边界测试",
        "audit.py",
        b"def run(payload): return {}",
        admin_id,
    )
    read_limits: list[int] = []
    original_read = StarletteUploadFile.read

    async def record_read_limit(file: StarletteUploadFile, size: int = -1) -> bytes:
        read_limits.append(size)
        return await original_read(file, size)

    monkeypatch.setattr(StarletteUploadFile, "read", record_read_limit)
    oversized = b"x" * (settings.audit_script_max_bytes + 1)

    created = client.post(
        "/api/workflow-admin/audit-scripts",
        data={"name": "超限脚本", "description": "直接 API 上传边界校验"},
        files={"file": ("oversized.py", oversized, "text/x-python")},
    )
    updated = client.put(
        f"/api/workflow-admin/audit-scripts/{existing['id']}",
        data={"description": "直接 API 更新边界校验"},
        files={"file": ("audit.py", oversized, "text/x-python")},
    )

    assert created.status_code == 422
    assert updated.status_code == 422
    assert read_limits == [settings.audit_script_max_bytes + 1] * 2
