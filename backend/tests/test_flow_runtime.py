from collections.abc import Iterator
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app.core.config import settings
from app.domain.workflow_runtime import validate_submission
from app.main import app


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings.database_path = str(tmp_path / "test.db")
    with TestClient(app) as test_client:
        test_client.post(
            "/api/auth/teacher/register",
            json={"name": "测试教师", "employeeNo": "TR001", "password": "Pass1234"},
        )
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


def test_teacher_cannot_manage_another_teachers_flow_runtime(client: TestClient) -> None:
    published = publish_flow(client)
    register(client, "20260043", "流程学生")
    instance = client.post(f"/api/student/shared/{published['token']}/enter").json()
    client.post("/api/auth/teacher/logout")
    registered = client.post(
        "/api/auth/teacher/register",
        json={"name": "另一位教师", "employeeNo": "TR002", "password": "Pass1234"},
    )

    assert registered.status_code == 201
    version_id = published["flowVersionId"]
    assert (
        client.get(f"/api/workflow-admin/versions/{version_id}/progress").status_code
        == 404
    )
    assert (
        client.patch(
            f"/api/workflow-admin/versions/{version_id}/nodes/n1/deadline",
            json={"deadlineAt": "2030-08-01T00:00:00+00:00", "reason": "越权修改"},
        ).status_code
        == 404
    )
    assert (
        client.put(
            f"/api/workflow-admin/instances/{instance['id']}/nodes/n1/deadline",
            json={"deadlineAt": "2030-08-01T00:00:00+00:00", "reason": "越权延期"},
        ).status_code
        == 404
    )


def test_student_lists_joined_flow_instances(client: TestClient) -> None:
    published = publish_flow(client)
    register(client, "20260051", "学生账户页")
    entered = client.post(f"/api/student/shared/{published['token']}/enter").json()

    response = client.get("/api/student/flow-instances")

    assert response.status_code == 200
    items = response.json()
    assert len(items) == 1
    assert items[0]["id"] == entered["id"]
    assert items[0]["name"] == "学生材料流程"
    assert items[0]["status"] == "in_progress"
    assert items[0]["lastActiveAt"]


@pytest.mark.parametrize(
    ("node", "payload", "message"),
    [
        (
            {"kind": "form", "infoFields": ["姓名", "学号"]},
            {"姓名": "学生甲", "学号": "  "},
            "请填写：学号",
        ),
        (
            {"kind": "confirmation", "infoFields": []},
            {"confirmed": False},
            "请完成确认后再提交",
        ),
        (
            {"kind": "file", "fileExtensions": "pdf, docx", "fileLimitMb": "10"},
            {"file": {"name": "材料.exe", "size": 1024}},
            "仅允许上传：pdf, docx",
        ),
        (
            {"kind": "file", "fileExtensions": "pdf", "fileLimitMb": "1"},
            {"file": {"name": "材料.pdf", "size": 2 * 1024 * 1024}},
            "文件大小不能超过 1 MB",
        ),
    ],
)
def test_validate_submission_rejects_invalid_payload(
    node: dict[str, object], payload: dict[str, object], message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        validate_submission(node, payload)
