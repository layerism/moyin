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


def create_invitation(
    client: TestClient,
    *,
    employee_no: str = "20002",
    name: str = "教师甲",
) -> dict[str, object]:
    provision_teacher(employee_no="20001", name="超级管理员", role="super_admin")
    login_teacher(client, employee_no="20001", name="超级管理员")
    response = client.post(
        "/api/admin/teacher-invitations",
        json={
            "name": name,
            "employeeNo": employee_no,
            "expiresAt": (datetime.now(UTC) + timedelta(hours=24)).isoformat(),
        },
    )
    assert response.status_code == 201
    return response.json()


def test_public_teacher_registration_route_is_closed(client: TestClient) -> None:
    response = client.post(
        "/api/auth/teacher/register",
        json={"name": "教师甲", "employeeNo": "20002", "password": "Pass1234"},
    )

    assert response.status_code == 404


def test_teacher_login_restores_existing_five_digit_account(client: TestClient) -> None:
    provision_teacher(employee_no="20003", name="教师乙")
    login_teacher(client, employee_no="20003", name="教师乙")
    assert client.post("/api/auth/teacher/logout").status_code == 204
    assert client.get("/api/auth/teacher/me").status_code == 401

    login_teacher(client, employee_no="20003", name="教师乙")

    assert client.get("/api/auth/teacher/me").json()["employeeNo"] == "20003"


def test_teacher_login_rejects_non_five_digit_employee_number(client: TestClient) -> None:
    response = client.post(
        "/api/auth/teacher/login",
        json={"name": "教师甲", "employeeNo": "T001", "password": "Pass1234"},
    )

    assert response.status_code == 422


def test_teacher_identity_returns_persisted_super_admin_role(client: TestClient) -> None:
    provision_teacher(employee_no="20006", name="超级管理员", role="super_admin")
    login_teacher(client, employee_no="20006", name="超级管理员")

    identity = client.get("/api/auth/teacher/me")

    assert identity.status_code == 200
    assert identity.json()["role"] == "super_admin"


def test_student_prefixed_routes_preserve_student_authentication(client: TestClient) -> None:
    payload = {"name": "学生甲", "studentNo": "S001", "password": "Pass1234"}

    assert client.post("/api/auth/student/register", json=payload).status_code == 201
    assert client.get("/api/auth/student/me").json()["studentNo"] == "S001"
    assert client.post("/api/auth/student/logout").status_code == 204
    assert client.post("/api/auth/student/login", json=payload).status_code == 200


def test_invitation_binds_identity_and_creates_ordinary_teacher(client: TestClient) -> None:
    created = create_invitation(client)
    token = str(created["token"])

    summary = client.get(f"/api/auth/teacher-invitations/{token}")
    accepted = client.post(
        f"/api/auth/teacher-invitations/{token}/accept",
        json={"password": "Pass5678"},
    )

    assert summary.status_code == 200
    assert summary.json()["employeeNo"] == "20002"
    assert summary.json()["name"] == "教师甲"
    assert accepted.status_code == 201
    assert accepted.json()["role"] == "teacher"
    assert client.get("/api/auth/teacher/me").json()["employeeNo"] == "20002"
    with get_connection() as connection:
        account = connection.execute(
            "SELECT role FROM teacher_accounts WHERE employee_no = '20002'"
        ).fetchone()
        invitation = connection.execute(
            "SELECT status, used_by_teacher_id FROM teacher_invitations WHERE id = ?",
            (created["id"],),
        ).fetchone()
    assert account["role"] == "teacher"
    assert invitation["status"] == "used"
    assert invitation["used_by_teacher_id"] == accepted.json()["id"]


def test_used_invitation_returns_the_generic_invalid_message(client: TestClient) -> None:
    created = create_invitation(client)
    token = str(created["token"])
    client.post(
        f"/api/auth/teacher-invitations/{token}/accept",
        json={"password": "Pass5678"},
    )

    response = client.get(f"/api/auth/teacher-invitations/{token}")

    assert response.status_code == 404
    assert response.json() == {"detail": "邀请链接无效或已失效"}


def test_revoked_and_expired_invitations_share_the_invalid_message(client: TestClient) -> None:
    revoked = create_invitation(client, employee_no="20004", name="教师丙")
    assert client.post(
        f"/api/admin/teacher-invitations/{revoked['id']}/revoke"
    ).status_code == 200
    revoked_response = client.get(
        f"/api/auth/teacher-invitations/{revoked['token']}"
    )

    expired = client.post(
        "/api/admin/teacher-invitations",
        json={
            "name": "教师丁",
            "employeeNo": "20005",
            "expiresAt": (datetime.now(UTC) + timedelta(hours=24)).isoformat(),
        },
    ).json()
    with get_connection() as connection:
        connection.execute(
            "UPDATE teacher_invitations SET expires_at = ? WHERE id = ?",
            ((datetime.now(UTC) - timedelta(minutes=1)).isoformat(), expired["id"]),
        )
    expired_response = client.get(
        f"/api/auth/teacher-invitations/{expired['token']}"
    )

    assert revoked_response.status_code == 404
    assert expired_response.status_code == 404
    assert revoked_response.json() == expired_response.json() == {
        "detail": "邀请链接无效或已失效"
    }
