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


def publish_flow(client: TestClient, *, deadline_at: str | None = None) -> dict[str, object]:
    flow = client.post("/api/workflows", json={"name": "学生材料流程"}).json()
    config = {
        "nodes": [
            {
                "id": "n1",
                "kind": "form",
                "title": "基本信息",
                "requirement": "填写基本信息",
                "infoFields": ["姓名"],
                "deadlineAt": deadline_at,
                "autoApprove": True,
            },
            {
                "id": "n2",
                "kind": "confirmation",
                "title": "确认提交",
                "requirement": "确认信息",
                "infoFields": [],
                "autoApprove": True,
            },
        ],
        "edges": [{"id": "e1", "source": "n1", "target": "n2"}],
    }
    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": config})
    return client.post(f"/api/workflows/{flow['id']}/publish").json()


def register(client: TestClient, number: str, name: str) -> None:
    response = client.post(
        "/api/auth/register",
        json={"name": name, "studentNo": number, "password": "Pass1234"},
    )
    assert response.status_code == 201


def test_students_share_definition_but_have_independent_progress(client: TestClient) -> None:
    published = publish_flow(client)
    token = published["token"]
    register(client, "20260011", "学生甲")
    first = client.post(f"/api/student/shared/{token}/enter").json()
    client.post("/api/auth/logout")
    register(client, "20260012", "学生乙")
    second = client.post(f"/api/student/shared/{token}/enter").json()

    assert first["flowVersionId"] == second["flowVersionId"]
    assert first["id"] != second["id"]
    assert first["nodeInstances"][0]["status"] == "available"
    assert second["nodeInstances"][0]["status"] == "available"


def test_approved_root_opens_downstream_without_changing_other_students(
    client: TestClient,
) -> None:
    published = publish_flow(client)
    register(client, "20260021", "学生甲")
    first = client.post(f"/api/student/shared/{published['token']}/enter").json()
    root = first["nodeInstances"][0]

    submitted = client.post(
        f"/api/student/node-instances/{root['id']}/submit",
        json={"payload": {"姓名": "学生甲"}, "idempotencyKey": "submit-1"},
    )

    assert submitted.status_code == 200
    refreshed = client.get(f"/api/student/flow-instances/{first['id']}").json()
    assert [node["status"] for node in refreshed["nodeInstances"]] == [
        "approved",
        "available",
    ]


def test_expired_node_rejects_submit_and_override_reopens(client: TestClient) -> None:
    published = publish_flow(client, deadline_at="2020-01-01T00:00:00+00:00")
    register(client, "20260031", "延期学生")
    instance = client.post(f"/api/student/shared/{published['token']}/enter").json()
    root = instance["nodeInstances"][0]

    rejected = client.post(
        f"/api/student/node-instances/{root['id']}/submit",
        json={"payload": {"姓名": "延期学生"}, "idempotencyKey": "expired-1"},
    )
    assert rejected.status_code == 422

    extended = client.put(
        f"/api/workflow-admin/instances/{instance['id']}/nodes/n1/deadline",
        json={"deadlineAt": "2030-08-01T00:00:00+00:00", "reason": "批准延期"},
    )
    assert extended.status_code == 200
    accepted = client.post(
        f"/api/student/node-instances/{root['id']}/submit",
        json={"payload": {"姓名": "延期学生"}, "idempotencyKey": "extended-1"},
    )
    assert accepted.status_code == 200


def test_teacher_progress_lists_each_student_instance(client: TestClient) -> None:
    published = publish_flow(client)
    register(client, "20260041", "学生甲")
    client.post(f"/api/student/shared/{published['token']}/enter")
    client.post("/api/auth/logout")
    register(client, "20260042", "学生乙")
    client.post(f"/api/student/shared/{published['token']}/enter")

    progress = client.get(
        f"/api/workflow-admin/versions/{published['flowVersionId']}/progress"
    )

    assert progress.status_code == 200
    assert {item["studentNo"] for item in progress.json()["students"]} == {
        "20260041",
        "20260042",
    }

