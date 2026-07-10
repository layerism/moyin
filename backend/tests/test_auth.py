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


def test_register_creates_authenticated_session(client: TestClient) -> None:
    response = client.post(
        "/api/auth/register",
        json={"name": "张三", "studentNo": "20260001", "password": "Pass1234"},
    )

    assert response.status_code == 201
    assert response.json()["studentNo"] == "20260001"
    assert client.get("/api/auth/me").json()["studentNo"] == "20260001"


def test_duplicate_student_number_is_rejected(client: TestClient) -> None:
    payload = {"name": "李四", "studentNo": "20260002", "password": "Pass1234"}
    assert client.post("/api/auth/register", json=payload).status_code == 201

    response = client.post("/api/auth/register", json=payload)

    assert response.status_code == 409


def test_login_restores_session_after_logout(client: TestClient) -> None:
    payload = {"name": "王五", "studentNo": "20260003", "password": "Pass1234"}
    client.post("/api/auth/register", json=payload)
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401

    response = client.post("/api/auth/login", json=payload)

    assert response.status_code == 200
    assert client.get("/api/auth/me").json()["name"] == "王五"
