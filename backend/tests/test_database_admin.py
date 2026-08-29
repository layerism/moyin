from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app.core.config import settings
from app.core.database import get_connection
from app.main import app
from tests.teacher_auth_helpers import login_teacher, provision_teacher


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings.database_path = str(tmp_path / "test.db")
    with TestClient(app) as test_client:
        yield test_client


def register_teacher(client: TestClient, employee_no: str) -> None:
    provision_teacher(employee_no=employee_no)
    login_teacher(client, employee_no=employee_no)


def promote_current_teacher(employee_no: str) -> None:
    with get_connection() as connection:
        connection.execute(
            "UPDATE teacher_accounts SET role = 'super_admin' WHERE employee_no = ?",
            (employee_no,),
        )


def test_regular_teacher_cannot_access_database_admin(client: TestClient) -> None:
    register_teacher(client, "30001")

    response = client.get("/api/admin/database/tables")

    assert response.status_code == 403


def test_super_admin_lists_tables_and_redacts_sensitive_values(client: TestClient) -> None:
    register_teacher(client, "30002")
    promote_current_teacher("30002")

    tables = client.get("/api/admin/database/tables")
    rows = client.get("/api/admin/database/tables/teacher_accounts/rows")

    assert tables.status_code == 200
    table_names = {table["name"] for table in tables.json()}
    assert "teacher_accounts" in table_names
    assert {
        "answer_sheet_drafts",
        "answer_sheet_grades",
        "flow_content_assets",
        "flow_version_answer_keys",
        "flow_version_content_assets",
    } <= table_names
    assert rows.status_code == 200
    assert rows.json()["rows"][0]["password_hash"] == "******"
    assert rows.json()["rows"][0]["role"] == "super_admin"


def test_super_admin_update_creates_backup_and_redacted_audit(client: TestClient) -> None:
    register_teacher(client, "30003")
    promote_current_teacher("30003")
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


def test_super_admin_delete_creates_backup_and_audit(client: TestClient) -> None:
    register_teacher(client, "30004")
    promote_current_teacher("30004")
    flow = client.post("/api/workflows", json={"name": "待删除流程"}).json()

    response = client.request(
        "DELETE",
        "/api/admin/database/tables/flows/rows",
        json={"key": {"id": flow["id"]}, "reason": "清理错误创建的流程"},
    )

    assert response.status_code == 200
    assert response.json() == {"deleted": True, "backupCreated": True}
    with get_connection() as connection:
        deleted = connection.execute(
            "SELECT id FROM flows WHERE id = ?", (flow["id"],)
        ).fetchone()
        audit = connection.execute(
            "SELECT * FROM audit_logs WHERE action = 'admin_delete'"
        ).fetchone()
    assert deleted is None
    assert audit is not None
    assert flow["id"] in audit["entity_id"]
    assert "待删除流程" in audit["before_data"]


def test_regular_teacher_cannot_manage_teacher_invitations(client: TestClient) -> None:
    register_teacher(client, "30005")

    response = client.get("/api/admin/teacher-invitations")

    assert response.status_code == 403


def test_super_admin_creates_lists_and_revokes_teacher_invitation(
    client: TestClient,
) -> None:
    register_teacher(client, "30006")
    promote_current_teacher("30006")
    created = client.post(
        "/api/admin/teacher-invitations",
        json={
            "name": "受邀教师",
            "employeeNo": "30007",
            "expiresAt": (datetime.now(UTC) + timedelta(hours=24)).isoformat(),
        },
    )

    listed = client.get("/api/admin/teacher-invitations")
    revoked = client.post(
        f"/api/admin/teacher-invitations/{created.json()['id']}/revoke"
    )

    assert created.status_code == 201
    assert created.json()["token"]
    assert listed.status_code == 200
    assert "token" not in listed.json()[0]
    assert "tokenHash" not in listed.json()[0]
    assert revoked.status_code == 200
    assert revoked.json()["status"] == "revoked"


def test_super_admin_cannot_duplicate_account_or_active_invitation(
    client: TestClient,
) -> None:
    register_teacher(client, "30008")
    promote_current_teacher("30008")
    expiry = (datetime.now(UTC) + timedelta(hours=24)).isoformat()

    existing_account = client.post(
        "/api/admin/teacher-invitations",
        json={"name": "已有教师", "employeeNo": "30008", "expiresAt": expiry},
    )
    first = client.post(
        "/api/admin/teacher-invitations",
        json={"name": "待注册教师", "employeeNo": "30009", "expiresAt": expiry},
    )
    duplicate = client.post(
        "/api/admin/teacher-invitations",
        json={"name": "待注册教师", "employeeNo": "30009", "expiresAt": expiry},
    )

    assert existing_account.status_code == 422
    assert first.status_code == 201
    assert duplicate.status_code == 422
