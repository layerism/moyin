from collections.abc import Iterator
from copy import deepcopy
import hashlib
import json
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app.core.config import settings
from app.core.database import get_connection
from app.main import app
from app.repositories import workflows
from app.services.object_storage import ObjectStorageError, UploadedObject


class FakeCloneStorage:
    def __init__(self, fail_on_copy: int | None = None):
        self.copy_calls: list[tuple[str, str]] = []
        self.delete_calls: list[str] = []
        self.fail_on_copy = fail_on_copy

    def copy_object(self, source_key: str, target_key: str) -> UploadedObject:
        self.copy_calls.append((source_key, target_key))
        if self.fail_on_copy == len(self.copy_calls):
            raise ObjectStorageError("OSS 复制失败")
        return UploadedObject(etag=f"copied-{len(self.copy_calls)}")

    def delete_object(self, key: str) -> None:
        self.delete_calls.append(key)


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


def add_template_assets(flow_id: str, count: int = 1) -> dict[str, object]:
    nodes = []
    now = "2026-08-08T00:00:00+00:00"
    with get_connection() as connection:
        teacher_id = connection.execute(
            "SELECT id FROM teacher_accounts WHERE employee_no = 'TW001'"
        ).fetchone()["id"]
        for index in range(count):
            asset_id = f"{flow_id}-asset-{index + 1}"
            node_id = f"file-{index + 1}"
            metadata = {
                "assetId": asset_id,
                "contentType": "application/pdf",
                "originalName": f"模板-{index + 1}.pdf",
                "sha256": f"hash-{index + 1}",
                "sizeBytes": 10 + index,
            }
            nodes.append(
                {
                    "id": node_id,
                    "kind": "file",
                    "title": f"文件-{index + 1}",
                    "requirement": "上传文件",
                    "infoFields": [],
                    "templateAsset": metadata,
                }
            )
            connection.execute(
                """
                INSERT INTO flow_template_assets
                    (id, flow_id, node_key, storage_key, original_name, content_type,
                     size_bytes, sha256, etag, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    asset_id, flow_id, node_id, f"source/{asset_id}",
                    metadata["originalName"], metadata["contentType"],
                    metadata["sizeBytes"], metadata["sha256"], "source-etag",
                    teacher_id, now,
                ),
            )
        config = {"nodes": nodes, "edges": []}
        connection.execute(
            "UPDATE flows SET draft_config = ? WHERE id = ?",
            (json.dumps(config, ensure_ascii=False), flow_id),
        )
    return config


def test_clone_published_flow_creates_editable_draft_without_runtime_data(
    client: TestClient,
) -> None:
    source = client.post(
        "/api/workflows", json={"name": "原流程", "description": "复制说明"}
    ).json()
    client.put(f"/api/workflows/{source['id']}/draft", json={"config": sample_config()})
    add_roster(client, source["id"])
    assert client.post(f"/api/workflows/{source['id']}/publish").status_code == 201

    response = client.post(f"/api/workflows/{source['id']}/clone", json={"name": "新流程"})

    assert response.status_code == 201
    cloned = response.json()
    assert cloned["description"] == "复制说明"
    assert cloned["config"] == sample_config()
    assert cloned["status"] == "draft"
    assert cloned["publishedVersionId"] is None
    assert cloned["publishedNodeIds"] == []
    assert client.get(f"/api/workflows/{cloned['id']}/roster").json()["activeCount"] == 0
    with get_connection() as connection:
        assert connection.execute(
            "SELECT COUNT(*) AS count FROM flow_versions WHERE flow_id = ?", (cloned["id"],)
        ).fetchone()["count"] == 0
        audit = connection.execute(
            "SELECT before_data, after_data FROM audit_logs WHERE action = 'workflow_cloned'"
        ).fetchone()
    assert json.loads(audit["before_data"]) == {"sourceFlowId": source["id"]}
    assert json.loads(audit["after_data"]) == {
        "newFlowId": cloned["id"], "newName": "新流程", "templateCount": 0
    }


def test_clone_rejects_source_name_duplicate_name_and_foreign_source(client: TestClient) -> None:
    source = client.post("/api/workflows", json={"name": "原流程"}).json()
    client.post("/api/workflows", json={"name": "已有流程"})
    assert client.post(
        f"/api/workflows/{source['id']}/clone", json={"name": " 原流程 "}
    ).status_code == 409
    assert client.post(
        f"/api/workflows/{source['id']}/clone", json={"name": "已有流程"}
    ).status_code == 409
    client.post("/api/auth/teacher/logout")
    client.post(
        "/api/auth/teacher/register",
        json={"name": "另一位教师", "employeeNo": "TW002", "password": "Pass1234"},
    )
    assert client.post(
        f"/api/workflows/{source['id']}/clone", json={"name": "越权副本"}
    ).status_code == 404


def test_clone_rewrites_template_assets_and_compensates_copy_failure(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = client.post("/api/workflows", json={"name": "模板流程"}).json()
    source_config = add_template_assets(source["id"], count=2)
    storage = FakeCloneStorage()
    monkeypatch.setattr(workflows, "get_object_storage", lambda: storage)

    success = client.post(f"/api/workflows/{source['id']}/clone", json={"name": "模板副本"})

    assert success.status_code == 201
    cloned = success.json()
    assert len(storage.copy_calls) == 2
    assert [node["id"] for node in cloned["config"]["nodes"]] == ["file-1", "file-2"]
    for source_node, cloned_node in zip(source_config["nodes"], cloned["config"]["nodes"]):
        assert cloned_node["templateAsset"]["assetId"] != source_node["templateAsset"]["assetId"]
        assert {**cloned_node["templateAsset"], "assetId": source_node["templateAsset"]["assetId"]} == source_node["templateAsset"]

    failing_source = client.post("/api/workflows", json={"name": "失败来源"}).json()
    add_template_assets(failing_source["id"], count=2)
    failing_storage = FakeCloneStorage(fail_on_copy=2)
    monkeypatch.setattr(workflows, "get_object_storage", lambda: failing_storage)
    failed = client.post(
        f"/api/workflows/{failing_source['id']}/clone", json={"name": "不应存在"}
    )
    assert failed.status_code == 502
    assert failing_storage.delete_calls == [failing_storage.copy_calls[0][1]]
    assert all(flow["name"] != "不应存在" for flow in client.get("/api/workflows").json())


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


def test_incomplete_scan_audit_can_be_saved_as_draft_but_not_published(
    client: TestClient,
) -> None:
    flow = client.post("/api/workflows", json={"name": "承诺书流程"}).json()
    config = {
        "nodes": [
            {
                "id": "confirmation-1",
                "kind": "confirmation",
                "title": "签署承诺书",
                "requirement": "下载、签署并上传承诺书",
                "infoFields": [],
                "scanAuditEnabled": True,
                "scanAuditMode": "pass_fail",
                "scanAuditPrompt": "",
            }
        ],
        "edges": [],
    }

    saved = client.put(f"/api/workflows/{flow['id']}/draft", json={"config": config})
    publish_validation = client.post("/api/workflows/validate", json={"config": config})

    assert saved.status_code == 200
    assert publish_validation.status_code == 422
    assert publish_validation.json()["detail"] == "请填写扫描审核标准"


def test_published_snapshot_does_not_change_with_draft(client: TestClient) -> None:
    flow = client.post("/api/workflows", json={"name": "证明收集"}).json()
    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": sample_config()})
    add_roster(client, flow["id"])
    published = client.post(f"/api/workflows/{flow['id']}/publish").json()
    changed = sample_config()
    changed["nodes"][0]["title"] = "修改后的标题"  # type: ignore[index]

    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": changed})

    reloaded = client.get(f"/api/workflows/{flow['id']}").json()
    assert reloaded["config"]["nodes"][0]["title"] == "基本信息"
    assert reloaded["draftConfig"]["nodes"][0]["title"] == "修改后的标题"
    assert reloaded["hasUnpublishedChanges"] is True

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
    assert current["draftConfig"] == current["config"]
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
    assert saved.json()["config"]["nodes"][0]["title"] == "基本信息"
    assert saved.json()["draftConfig"]["nodes"][0]["title"] == "修改后的基本信息"
    assert saved.json()["hasUnpublishedChanges"] is True

    impact = client.post(f"/api/workflows/{flow['id']}/revision-impact")
    assert impact.status_code == 200
    assert impact.json() == {
        "currentVersionId": published["flowVersionId"],
        "currentVersionNo": 1,
        "nextVersionNo": 2,
        "draftConfigHash": hashlib.sha256(
            json.dumps(changed, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest(),
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


def test_payload_revision_preview_is_stateless_until_confirmed_publish(
    client: TestClient,
) -> None:
    flow = client.post("/api/workflows", json={"name": "本地修订发布"}).json()
    original = sample_config()
    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": original})
    add_roster(client, flow["id"])
    first = client.post(f"/api/workflows/{flow['id']}/publish").json()
    changed = deepcopy(original)
    changed["nodes"][0]["title"] = "仅在浏览器修改"

    preview = client.post(
        f"/api/workflows/{flow['id']}/revision-impact",
        json={"config": changed},
    )

    assert preview.status_code == 200
    with get_connection() as connection:
        persisted_before_confirm = json.loads(
            connection.execute(
                "SELECT draft_config FROM flows WHERE id = ?", (flow["id"],)
            ).fetchone()["draft_config"]
        )
    assert persisted_before_confirm == original

    published = client.post(
        f"/api/workflows/{flow['id']}/publish",
        json={
            "config": changed,
            "expectedDraftConfigHash": preview.json()["draftConfigHash"],
            "expectedCurrentVersionId": first["flowVersionId"],
        },
    )

    assert published.status_code == 201
    with get_connection() as connection:
        row = connection.execute(
            "SELECT draft_config FROM flows WHERE id = ?", (flow["id"],)
        ).fetchone()
        version_count = connection.execute(
            "SELECT COUNT(*) AS count FROM flow_versions WHERE flow_id = ?",
            (flow["id"],),
        ).fetchone()["count"]
    assert json.loads(row["draft_config"]) == changed
    assert version_count == 2


def test_revision_impact_is_empty_for_unpublished_flow(client: TestClient) -> None:
    flow = client.post("/api/workflows", json={"name": "未发布修订流程"}).json()
    config = sample_config()
    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": config})

    impact = client.post(f"/api/workflows/{flow['id']}/revision-impact")

    assert impact.status_code == 200
    assert impact.json() == {
        "currentVersionId": None,
        "currentVersionNo": None,
        "nextVersionNo": 1,
        "draftConfigHash": hashlib.sha256(
            json.dumps(config, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest(),
        "addedNodeIds": [],
        "changedNodeIds": [],
        "predecessorChangedNodeIds": [],
        "invalidatedNodeIds": [],
        "affectedStudentCount": 0,
        "sourceVersionImpacts": [],
    }


@pytest.mark.parametrize(
    "edges",
    [
        [{"id": "dangling", "source": "n1", "target": "missing"}],
        [
            {"id": "forward", "source": "n1", "target": "n2"},
            {"id": "back", "source": "n2", "target": "n1"},
        ],
    ],
)
def test_revision_impact_rejects_invalid_dag_with_422(
    client: TestClient, edges: list[dict[str, str]]
) -> None:
    flow = client.post("/api/workflows", json={"name": f"非法影响预览-{edges[0]['id']}"}).json()
    config = sample_config()
    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": config})
    add_roster(client, flow["id"])
    client.post(f"/api/workflows/{flow['id']}/publish")
    config["edges"] = [*config["edges"], *edges]
    saved = client.put(f"/api/workflows/{flow['id']}/draft", json={"config": config})
    assert saved.status_code == 200

    impact = client.post(f"/api/workflows/{flow['id']}/revision-impact")

    assert impact.status_code == 422


def test_republish_rejects_stale_revision_impact_hash(client: TestClient) -> None:
    flow = client.post("/api/workflows", json={"name": "修订确认并发保护"}).json()
    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": sample_config()})
    add_roster(client, flow["id"])
    client.post(f"/api/workflows/{flow['id']}/publish")
    reviewed = deepcopy(sample_config())
    reviewed["nodes"][0]["title"] = "预览版本标题"
    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": reviewed})

    missing_hash = client.post(f"/api/workflows/{flow['id']}/publish")

    assert missing_hash.status_code == 409
    assert missing_hash.json() == {"detail": "草稿已变更，请重新确认修订影响"}
    impact = client.post(f"/api/workflows/{flow['id']}/revision-impact").json()
    changed_after_review = deepcopy(reviewed)
    changed_after_review["nodes"][0]["title"] = "预览后再次修改"
    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": changed_after_review})

    rejected = client.post(
        f"/api/workflows/{flow['id']}/publish",
        json={
            "expectedDraftConfigHash": impact["draftConfigHash"],
            "expectedCurrentVersionId": impact["currentVersionId"],
        },
    )

    assert rejected.status_code == 409
    assert rejected.json() == {"detail": "草稿已变更，请重新确认修订影响"}
    with get_connection() as connection:
        version_count = connection.execute(
            "SELECT COUNT(*) AS count FROM flow_versions WHERE flow_id = ?", (flow["id"],)
        ).fetchone()["count"]
    assert version_count == 1


def test_republish_checks_stale_hash_before_validating_changed_dag(
    client: TestClient,
) -> None:
    flow = client.post("/api/workflows", json={"name": "旧预览不可发布新循环图"}).json()
    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": sample_config()})
    add_roster(client, flow["id"])
    client.post(f"/api/workflows/{flow['id']}/publish")
    reviewed = deepcopy(sample_config())
    reviewed["nodes"][0]["title"] = "已确认预览"
    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": reviewed})
    preview = client.post(f"/api/workflows/{flow['id']}/revision-impact").json()
    cyclic = deepcopy(reviewed)
    cyclic["edges"].append({"id": "back", "source": "n2", "target": "n1"})
    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": cyclic})

    rejected = client.post(
        f"/api/workflows/{flow['id']}/publish",
        json={
            "expectedDraftConfigHash": preview["draftConfigHash"],
            "expectedCurrentVersionId": preview["currentVersionId"],
        },
    )

    assert rejected.status_code == 409
    assert rejected.json() == {"detail": "草稿已变更，请重新确认修订影响"}


def test_cross_tab_republish_confirmation_is_bound_to_current_version(
    client: TestClient,
) -> None:
    flow = client.post("/api/workflows", json={"name": "跨标签发布基准保护"}).json()
    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": sample_config()})
    add_roster(client, flow["id"])
    first_version = client.post(f"/api/workflows/{flow['id']}/publish").json()
    changed = deepcopy(sample_config())
    changed["nodes"][0]["title"] = "已预览的修订"
    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": changed})
    preview = client.post(f"/api/workflows/{flow['id']}/revision-impact").json()
    payload = {
        "expectedDraftConfigHash": preview["draftConfigHash"],
        "expectedCurrentVersionId": preview["currentVersionId"],
    }

    tab_one = client.post(f"/api/workflows/{flow['id']}/publish", json=payload)
    tab_two = client.post(f"/api/workflows/{flow['id']}/publish", json=payload)

    assert tab_one.status_code == 201
    assert tab_two.status_code == 409
    assert tab_two.json() == {"detail": "草稿已变更，请重新确认修订影响"}
    with get_connection() as connection:
        versions = connection.execute(
            "SELECT id FROM flow_versions WHERE flow_id = ? ORDER BY version_no",
            (flow["id"],),
        ).fetchall()
    assert [row["id"] for row in versions] == [
        first_version["flowVersionId"],
        tab_one.json()["flowVersionId"],
    ]


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

    snapshot = json.dumps(stale_draft, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    rejected = client.post(
        f"/api/workflows/{flow['id']}/publish",
        json={
            "expectedDraftConfigHash": hashlib.sha256(snapshot.encode()).hexdigest(),
            "expectedCurrentVersionId": published.json()["flowVersionId"],
        },
    )

    assert rejected.status_code == 409
    assert rejected.json() == {"detail": "已发布节点不可删除：n1"}


def test_historical_node_cannot_be_deleted_when_latest_legacy_version_omits_it(
    client: TestClient,
) -> None:
    flow = client.post("/api/workflows", json={"name": "历史节点永久保护"}).json()
    original = sample_config()
    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": original})
    add_roster(client, flow["id"])
    first = client.post(f"/api/workflows/{flow['id']}/publish").json()
    legacy_latest = {
        "nodes": [deepcopy(original["nodes"][1])],  # type: ignore[index]
        "edges": [],
    }
    snapshot = json.dumps(legacy_latest, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    with get_connection() as connection:
        teacher_id = connection.execute(
            "SELECT id FROM teacher_accounts WHERE employee_no = 'TW001'"
        ).fetchone()["id"]
        connection.execute(
            "UPDATE flow_versions SET status = 'disabled' WHERE id = ?",
            (first["flowVersionId"],),
        )
        connection.execute(
            """
            INSERT INTO flow_versions
                (id, flow_id, version_no, config_snapshot, config_hash,
                 status, published_by, published_at)
            VALUES ('legacy-v2', ?, 2, ?, ?, 'published', ?, '2026-07-14T00:00:00+00:00')
            """,
            (
                flow["id"],
                snapshot,
                hashlib.sha256(snapshot.encode()).hexdigest(),
                str(teacher_id),
            ),
        )
        connection.execute(
            """
            INSERT INTO flow_node_runtime_configs
                (flow_version_id, node_key, deadline_at, updated_by, updated_at)
            VALUES ('legacy-v2', 'n2', NULL, ?, '2026-07-14T00:00:00+00:00')
            """,
            (str(teacher_id),),
        )

    rejected_draft = client.put(
        f"/api/workflows/{flow['id']}/draft", json={"config": legacy_latest}
    )
    assert rejected_draft.status_code == 409
    assert rejected_draft.json() == {"detail": "已发布节点不可删除：n1"}

    with get_connection() as connection:
        connection.execute("UPDATE flows SET draft_config = ? WHERE id = ?", (snapshot, flow["id"]))
    rejected_preview = client.post(f"/api/workflows/{flow['id']}/revision-impact")
    rejected_publish = client.post(
        f"/api/workflows/{flow['id']}/publish",
        json={
            "expectedDraftConfigHash": hashlib.sha256(snapshot.encode()).hexdigest(),
            "expectedCurrentVersionId": "legacy-v2",
        },
    )
    assert rejected_preview.status_code == 409
    assert rejected_preview.json() == {"detail": "已发布节点不可删除：n1"}
    assert rejected_publish.status_code == 409
    assert rejected_publish.json() == {"detail": "已发布节点不可删除：n1"}
