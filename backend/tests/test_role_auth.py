from collections.abc import Iterator
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app.core.config import settings
from app.main import app


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings.database_path = str(tmp_path / "test.db")
    with TestClient(app) as test_client:
        yield test_client


def test_teacher_register_creates_teacher_session(client: TestClient) -> None:
    response = client.post(
        "/api/auth/teacher/register",
        json={"name": "教师甲", "employeeNo": "T001", "password": "Pass1234"},
    )

    assert response.status_code == 201
    assert response.json()["employeeNo"] == "T001"
    assert client.get("/api/auth/teacher/me").json()["name"] == "教师甲"


def test_duplicate_employee_number_is_rejected(client: TestClient) -> None:
    payload = {"name": "教师甲", "employeeNo": "T002", "password": "Pass1234"}
    assert client.post("/api/auth/teacher/register", json=payload).status_code == 201

    response = client.post("/api/auth/teacher/register", json=payload)

    assert response.status_code == 409


def test_teacher_login_restores_session_after_logout(client: TestClient) -> None:
    payload = {"name": "教师乙", "employeeNo": "T003", "password": "Pass1234"}
    client.post("/api/auth/teacher/register", json=payload)
    assert client.post("/api/auth/teacher/logout").status_code == 204
    assert client.get("/api/auth/teacher/me").status_code == 401

    assert client.post("/api/auth/teacher/login", json=payload).status_code == 200
    assert client.get("/api/auth/teacher/me").json()["employeeNo"] == "T003"


def test_student_prefixed_routes_preserve_student_authentication(client: TestClient) -> None:
    payload = {"name": "学生甲", "studentNo": "S001", "password": "Pass1234"}

    assert client.post("/api/auth/student/register", json=payload).status_code == 201
    assert client.get("/api/auth/student/me").json()["studentNo"] == "S001"
    assert client.post("/api/auth/student/logout").status_code == 204
    assert client.post("/api/auth/student/login", json=payload).status_code == 200

