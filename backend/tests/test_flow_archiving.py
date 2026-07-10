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


def login_teacher(client: TestClient) -> None:
    response = client.post(
        "/api/auth/teacher/register",
        json={"name": "管理教师", "employeeNo": "T900", "password": "Pass1234"},
    )
    assert response.status_code == 201


def create_published_flow(client: TestClient) -> dict[str, object]:
    flow = client.post("/api/workflows", json={"name": "归档验证流程"}).json()
    config = {
        "nodes": [{"id": "n1", "kind": "form", "title": "信息", "infoFields": []}],
        "edges": [],
    }
    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": config})
    published = client.post(f"/api/workflows/{flow['id']}/publish").json()
    return {"flowId": flow["id"], "versionId": published["flowVersionId"]}


def test_student_session_cannot_create_teacher_flow(client: TestClient) -> None:
    client.post(
        "/api/auth/student/register",
        json={"name": "学生甲", "studentNo": "S900", "password": "Pass1234"},
    )

    response = client.post("/api/workflows", json={"name": "越权流程"})

    assert response.status_code == 401


def test_archive_hides_flow_and_retains_version(client: TestClient) -> None:
    login_teacher(client)
    created = create_published_flow(client)

    response = client.delete(f"/api/workflows/{created['flowId']}")

    assert response.status_code == 204
    assert client.get("/api/workflows").json() == []
    with get_connection() as connection:
        flow = connection.execute(
            "SELECT status FROM flows WHERE id = ?", (created["flowId"],)
        ).fetchone()
        version_count = connection.execute(
            "SELECT COUNT(*) AS count FROM flow_versions WHERE flow_id = ?",
            (created["flowId"],),
        ).fetchone()["count"]
    assert flow["status"] == "archived"
    assert version_count == 1


def test_archive_is_idempotent_and_blocks_future_edits(client: TestClient) -> None:
    login_teacher(client)
    created = create_published_flow(client)
    path = f"/api/workflows/{created['flowId']}"

    assert client.delete(path).status_code == 204
    assert client.delete(path).status_code == 204
    assert client.put(f"{path}/draft", json={"config": {"nodes": [], "edges": []}}).status_code == 409
    assert client.post(f"{path}/publish").status_code == 409

