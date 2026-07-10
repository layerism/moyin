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


def test_publish_returns_share_url_and_resolvable_snapshot(client: TestClient) -> None:
    flow = client.post("/api/workflows", json={"name": "报销流程"}).json()
    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": sample_config()})

    published = client.post(f"/api/workflows/{flow['id']}/publish")

    assert published.status_code == 201
    body = published.json()
    assert body["shareUrl"].startswith("/s/")
    assert body["versionNo"] == 1
    shared = client.get(f"/api/shared-flows/{body['token']}")
    assert shared.status_code == 200
    assert shared.json()["config"]["nodes"][0]["id"] == "n1"


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
    published = client.post(f"/api/workflows/{flow['id']}/publish").json()
    changed = sample_config()
    changed["nodes"][0]["title"] = "修改后的标题"  # type: ignore[index]

    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": changed})

    shared = client.get(f"/api/shared-flows/{published['token']}").json()
    assert shared["config"]["nodes"][0]["title"] == "基本信息"
