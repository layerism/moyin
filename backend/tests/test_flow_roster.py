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
        response = test_client.post(
            "/api/auth/teacher/register",
            json={"name": "名单教师", "employeeNo": "R001", "password": "Pass1234"},
        )
        assert response.status_code == 201
        yield test_client


def create_flow(client: TestClient) -> str:
    response = client.post("/api/workflows", json={"name": "名单验证流程"})
    assert response.status_code == 201
    return response.json()["id"]


def import_roster(
    client: TestClient, flow_id: str, entries: list[dict[str, str]]
) -> object:
    return client.post(
        f"/api/workflows/{flow_id}/roster/import",
        json={"entries": entries, "sourceFileName": "学生名单.xlsx"},
    )


def test_teacher_imports_updates_revokes_and_restores_roster(client: TestClient) -> None:
    flow_id = create_flow(client)

    imported = import_roster(
        client,
        flow_id,
        [
            {"studentNo": "001", "name": "学生甲"},
            {"studentNo": "002", "name": "学生乙"},
        ],
    )

    assert imported.status_code == 200
    assert imported.json()["summary"] == {"added": 2, "restored": 0, "updated": 0}
    assert imported.json()["activeCount"] == 2
    first_entry = imported.json()["entries"][0]

    updated = import_roster(
        client,
        flow_id,
        [{"studentNo": "001", "name": "学生甲（更名）"}],
    )
    assert updated.json()["summary"] == {"added": 0, "restored": 0, "updated": 1}

    revoked = client.delete(f"/api/workflows/{flow_id}/roster/{first_entry['id']}")
    assert revoked.status_code == 200
    assert revoked.json()["activeCount"] == 1
    assert revoked.json()["revokedCount"] == 1

    restored = import_roster(
        client,
        flow_id,
        [{"studentNo": "001", "name": "学生甲（更名）"}],
    )
    assert restored.json()["summary"] == {"added": 0, "restored": 1, "updated": 0}
    assert restored.json()["activeCount"] == 2

    with get_connection() as connection:
        actions = [
            row["action"]
            for row in connection.execute(
                "SELECT action FROM audit_logs ORDER BY id"
            ).fetchall()
        ]
    assert actions == ["roster_import", "roster_import", "roster_revoke", "roster_import"]


def test_import_rejects_conflicting_duplicate_student_numbers(client: TestClient) -> None:
    flow_id = create_flow(client)

    response = import_roster(
        client,
        flow_id,
        [
            {"studentNo": "001", "name": "学生甲"},
            {"studentNo": "001", "name": "另一姓名"},
        ],
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "学号 001 在导入名单中对应多个姓名"}
    assert client.get(f"/api/workflows/{flow_id}/roster").status_code == 200


def test_teacher_cannot_access_another_teachers_roster(client: TestClient) -> None:
    flow_id = create_flow(client)
    client.post("/api/auth/teacher/logout")
    client.post(
        "/api/auth/teacher/register",
        json={"name": "其他教师", "employeeNo": "R002", "password": "Pass1234"},
    )

    assert client.get(f"/api/workflows/{flow_id}/roster").status_code == 404
    assert (
        import_roster(client, flow_id, [{"studentNo": "001", "name": "学生甲"}]).status_code
        == 404
    )
