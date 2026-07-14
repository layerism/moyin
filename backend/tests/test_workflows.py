from collections.abc import Iterator
from copy import deepcopy
import json
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
        test_client.post(
            "/api/auth/teacher/register",
            json={"name": "测试教师", "employeeNo": "TW001", "password": "Pass1234"},
        )
        yield test_client


def sample_config() -> dict[str, object]:
    return {
        "nodes": [
            {
                "id": "n1",
                "kind": "form",
                "title": "基本信息",
                "requirement": "填写基本信息",
                "infoFields": ["姓名", "联系电话"],
            },
            {
                "id": "n2",
                "kind": "confirmation",
                "title": "确认提交",
                "requirement": "确认信息无误",
                "infoFields": [],
            },
        ],
        "edges": [{"id": "e1", "source": "n1", "target": "n2"}],
    }


def add_roster(
    client: TestClient, flow_id: str, entries: list[dict[str, str]] | None = None
) -> None:
    response = client.post(
        f"/api/workflows/{flow_id}/roster/import",
        json={
            "entries": entries or [{"studentNo": "W001", "name": "流程学生"}],
            "sourceFileName": "名单.xlsx",
        },
    )
    assert response.status_code == 200


def test_duplicate_flow_name_is_rejected(client: TestClient) -> None:
    first = client.post("/api/workflows", json={"name": "课程材料收集"})

    duplicate = client.post("/api/workflows", json={"name": "课程材料收集"})

    assert first.status_code == 201
    assert duplicate.status_code == 409
    assert duplicate.json() == {"detail": "已存在同名流程"}
    assert len(client.get("/api/workflows").json()) == 1


def test_duplicate_check_uses_trimmed_name_and_allows_other_names(client: TestClient) -> None:
    first = client.post("/api/workflows", json={"name": "请假审批"})

    whitespace_duplicate = client.post("/api/workflows", json={"name": "  请假审批  "})
    distinct = client.post("/api/workflows", json={"name": "销假审批"})

    assert first.status_code == 201
    assert whitespace_duplicate.status_code == 409
    assert distinct.status_code == 201


def test_archived_legacy_name_does_not_block_visible_flow_creation(client: TestClient) -> None:
    archived = client.post("/api/workflows", json={"name": "历史归档流程"}).json()
    with get_connection() as connection:
        connection.execute("UPDATE flows SET status = 'archived' WHERE id = ?", (archived["id"],))

    replacement = client.post("/api/workflows", json={"name": "历史归档流程"})

    assert replacement.status_code == 201
    visible = client.get("/api/workflows").json()
    assert [flow["id"] for flow in visible] == [replacement.json()["id"]]


def test_teacher_can_only_access_owned_flows(client: TestClient) -> None:
    teacher_a_flow = client.post("/api/workflows", json={"name": "教师私有流程"}).json()
    client.post("/api/auth/teacher/logout")
    registered = client.post(
        "/api/auth/teacher/register",
        json={"name": "另一位教师", "employeeNo": "TW002", "password": "Pass1234"},
    )

    assert registered.status_code == 201
    assert client.get("/api/workflows").json() == []
    assert client.get(f"/api/workflows/{teacher_a_flow['id']}").status_code == 404
    assert (
        client.put(
            f"/api/workflows/{teacher_a_flow['id']}/draft",
            json={"config": sample_config()},
        ).status_code
        == 404
    )
    assert client.post(f"/api/workflows/{teacher_a_flow['id']}/publish").status_code == 404
    assert client.delete(f"/api/workflows/{teacher_a_flow['id']}").status_code == 404

    teacher_b_flow = client.post("/api/workflows", json={"name": "教师私有流程"})
    assert teacher_b_flow.status_code == 201
    assert [flow["id"] for flow in client.get("/api/workflows").json()] == [
        teacher_b_flow.json()["id"]
    ]

    client.post("/api/auth/teacher/logout")
    login = client.post(
        "/api/auth/teacher/login",
        json={"name": "测试教师", "employeeNo": "TW001", "password": "Pass1234"},
    )
    assert login.status_code == 200
    assert [flow["id"] for flow in client.get("/api/workflows").json()] == [teacher_a_flow["id"]]


def test_publish_returns_share_url_and_resolvable_snapshot(client: TestClient) -> None:
    flow = client.post("/api/workflows", json={"name": "报销流程"}).json()
    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": sample_config()})
    add_roster(client, flow["id"])

    published = client.post(f"/api/workflows/{flow['id']}/publish")

    assert published.status_code == 201
    body = published.json()
    assert body["shareUrl"].startswith("/s/")
    assert body["versionNo"] == 1
    listed = client.get("/api/workflows").json()[0]
    assert listed["shareUrl"] == body["shareUrl"]
    assert listed["publishedVersionId"] == body["flowVersionId"]
    shared = client.get(f"/api/shared-flows/{body['token']}")
    assert shared.status_code == 200
    assert shared.json() == {"description": "", "name": "报销流程"}


def test_cycle_is_rejected(client: TestClient) -> None:
    config = {
        "nodes": [{"id": "a"}, {"id": "b"}],
        "edges": [
            {"id": "e1", "source": "a", "target": "b"},
            {"id": "e2", "source": "b", "target": "a"},
        ],
    }

    response = client.post("/api/workflows/validate", json={"config": config})

    assert response.status_code == 422


def test_published_snapshot_does_not_change_with_draft(client: TestClient) -> None:
    flow = client.post("/api/workflows", json={"name": "证明收集"}).json()
    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": sample_config()})
    add_roster(client, flow["id"])
    published = client.post(f"/api/workflows/{flow['id']}/publish").json()
    changed = sample_config()
    changed["nodes"][0]["title"] = "修改后的标题"  # type: ignore[index]

    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": changed})

    registered = client.post(
        "/api/auth/student/register",
        json={"name": "流程学生", "studentNo": "W001", "password": "Pass1234"},
    )
    assert registered.status_code == 201
    instance = client.post(f"/api/student/shared/{published['token']}/enter").json()
    assert instance["config"]["nodes"][0]["title"] == "基本信息"


def test_publish_requires_an_active_student_roster(client: TestClient) -> None:
    flow = client.post("/api/workflows", json={"name": "空名单流程"}).json()
    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": sample_config()})

    response = client.post(f"/api/workflows/{flow['id']}/publish")

    assert response.status_code == 422
    assert response.json() == {"detail": "请先导入学生名单"}


def test_revision_metadata_and_impact_protect_published_nodes(client: TestClient) -> None:
    flow = client.post("/api/workflows", json={"name": "修订影响流程"}).json()
    roster = [
        {"studentNo": "W001", "name": "流程学生一"},
        {"studentNo": "W002", "name": "流程学生二"},
        {"studentNo": "W003", "name": "流程学生三"},
    ]
    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": sample_config()})
    add_roster(client, flow["id"], roster)
    published = client.post(f"/api/workflows/{flow['id']}/publish").json()

    current = client.get(f"/api/workflows/{flow['id']}").json()
    assert current["publishedNodeIds"] == ["n1", "n2"]
    assert current["publishedVersionNo"] == 1
    assert current["hasUnpublishedChanges"] is False

    for entry in roster:
        registered = client.post(
            "/api/auth/student/register",
            json={**entry, "password": "Pass1234"},
        )
        assert registered.status_code == 201
        entered = client.post(f"/api/student/shared/{published['token']}/enter")
        assert entered.status_code == 200

    changed = deepcopy(sample_config())
    changed["nodes"][0]["title"] = "修改后的基本信息"
    saved = client.put(f"/api/workflows/{flow['id']}/draft", json={"config": changed})
    assert saved.status_code == 200
    assert saved.json()["hasUnpublishedChanges"] is True

    impact = client.post(f"/api/workflows/{flow['id']}/revision-impact")
    assert impact.status_code == 200
    assert impact.json() == {
        "currentVersionId": published["flowVersionId"],
        "currentVersionNo": 1,
        "nextVersionNo": 2,
        "addedNodeIds": [],
        "changedNodeIds": ["n1"],
        "predecessorChangedNodeIds": [],
        "invalidatedNodeIds": ["n1", "n2"],
        "affectedStudentCount": 3,
        "sourceVersionImpacts": [
            {
                "versionId": published["flowVersionId"],
                "versionNo": 1,
                "status": "published",
                "addedNodeIds": [],
                "changedNodeIds": ["n1"],
                "predecessorChangedNodeIds": [],
                "invalidatedNodeIds": ["n1", "n2"],
                "affectedStudentCount": 3,
            }
        ],
    }

    without_published_node = deepcopy(changed)
    without_published_node["nodes"] = [node for node in changed["nodes"] if node["id"] != "n1"]
    without_published_node["edges"] = []
    rejected = client.put(
        f"/api/workflows/{flow['id']}/draft",
        json={"config": without_published_node},
    )
    assert rejected.status_code == 409
    assert rejected.json() == {"detail": "已发布节点不可删除：n1"}

    client.post("/api/auth/teacher/logout")
    client.post(
        "/api/auth/teacher/register",
        json={"name": "另一位教师", "employeeNo": "TW002", "password": "Pass1234"},
    )
    assert client.post(f"/api/workflows/{flow['id']}/revision-impact").status_code == 404


def test_revision_impact_is_empty_for_unpublished_flow(client: TestClient) -> None:
    flow = client.post("/api/workflows", json={"name": "未发布修订流程"}).json()

    impact = client.post(f"/api/workflows/{flow['id']}/revision-impact")

    assert impact.status_code == 200
    assert impact.json() == {
        "currentVersionId": None,
        "currentVersionNo": None,
        "nextVersionNo": 1,
        "addedNodeIds": [],
        "changedNodeIds": [],
        "predecessorChangedNodeIds": [],
        "invalidatedNodeIds": [],
        "affectedStudentCount": 0,
        "sourceVersionImpacts": [],
    }


def test_publish_rejects_persisted_draft_missing_published_node(client: TestClient) -> None:
    flow = client.post("/api/workflows", json={"name": "历史草稿发布流程"}).json()
    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": sample_config()})
    add_roster(client, flow["id"])
    published = client.post(f"/api/workflows/{flow['id']}/publish")
    assert published.status_code == 201

    stale_draft = deepcopy(sample_config())
    stale_draft["nodes"] = [node for node in stale_draft["nodes"] if node["id"] != "n1"]
    stale_draft["edges"] = []
    with get_connection() as connection:
        connection.execute(
            "UPDATE flows SET draft_config = ? WHERE id = ?",
            (json.dumps(stale_draft), flow["id"]),
        )

    rejected = client.post(f"/api/workflows/{flow['id']}/publish")

    assert rejected.status_code == 409
    assert rejected.json() == {"detail": "已发布节点不可删除：n1"}
