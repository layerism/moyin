from collections.abc import Iterator
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app.core.config import settings
from app.core.database import get_connection
from app.main import app


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings.database_path = str(tmp_path / "test.db")
    with TestClient(app) as test_client:
        yield test_client


def register_teacher(client: TestClient, employee_no: str) -> None:
    response = client.post(
        "/api/auth/teacher/register",
        json={"name": "管理教师", "employeeNo": employee_no, "password": "Pass1234"},
    )
    assert response.status_code == 201


def promote_current_teacher(employee_no: str) -> None:
    with get_connection() as connection:
        connection.execute(
            "UPDATE teacher_accounts SET role = 'super_admin' WHERE employee_no = ?",
            (employee_no,),
        )


def test_regular_teacher_cannot_access_database_admin(client: TestClient) -> None:
    register_teacher(client, "T100")

    response = client.get("/api/admin/database/tables")

    assert response.status_code == 403


def test_super_admin_lists_tables_and_redacts_sensitive_values(client: TestClient) -> None:
    register_teacher(client, "A100")
    promote_current_teacher("A100")

    tables = client.get("/api/admin/database/tables")
    rows = client.get("/api/admin/database/tables/teacher_accounts/rows")

    assert tables.status_code == 200
    assert "teacher_accounts" in {table["name"] for table in tables.json()}
    assert rows.status_code == 200
    assert rows.json()["rows"][0]["password_hash"] == "******"
    assert rows.json()["rows"][0]["role"] == "super_admin"


def test_super_admin_update_creates_backup_and_redacted_audit(client: TestClient) -> None:
    register_teacher(client, "A200")
    promote_current_teacher("A200")
    flow = client.post("/api/workflows", json={"name": "待维护流程"}).json()

    response = client.patch(
        "/api/admin/database/tables/flows/rows",
        json={
            "key": {"id": flow["id"]},
            "changes": {"description": "管理员维护后的说明"},
            "reason": "修正流程说明",
        },
    )

    assert response.status_code == 200
    assert response.json()["row"]["description"] == "管理员维护后的说明"
    assert response.json()["backupCreated"] is True
    with get_connection() as connection:
        audit = connection.execute(
            "SELECT * FROM audit_logs WHERE action = 'admin_update'"
        ).fetchone()
    assert audit is not None
    assert audit["actor_id"]
    assert "管理员维护后的说明" in audit["after_data"]
