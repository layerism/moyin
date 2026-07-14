from collections.abc import Iterator
from copy import deepcopy
import json
from pathlib import Path
import sqlite3

from fastapi.testclient import TestClient
import pytest

from app.core.config import settings
from app.core.database import get_connection
from app.main import app
from app.repositories.workflows import publish_flow


BASE_CONFIG = {
    "nodes": [
        {
            "id": "root",
            "kind": "form",
            "title": "根节点",
            "requirement": "填写根节点",
            "infoFields": ["value"],
            "autoApprove": True,
        },
        {
            "id": "left",
            "kind": "form",
            "title": "左分支",
            "requirement": "填写左分支",
            "infoFields": ["value"],
            "autoApprove": True,
        },
        {
            "id": "right",
            "kind": "form",
            "title": "右分支",
            "requirement": "填写右分支",
            "infoFields": ["value"],
            "autoApprove": True,
        },
        {
            "id": "join",
            "kind": "confirmation",
            "title": "汇总",
            "requirement": "确认汇总",
            "infoFields": [],
            "autoApprove": True,
        },
    ],
    "edges": [
        {"id": "root-left", "source": "root", "target": "left"},
        {"id": "root-right", "source": "root", "target": "right"},
        {"id": "left-join", "source": "left", "target": "join"},
        {"id": "right-join", "source": "right", "target": "join"},
    ],
}


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings.database_path = str(tmp_path / "test.db")
    with TestClient(app) as test_client:
        registered = test_client.post(
            "/api/auth/teacher/register",
            json={"name": "测试教师", "employeeNo": "RP001", "password": "Pass1234"},
        )
        assert registered.status_code == 201
        yield test_client


def _nodes(instance: dict[str, object]) -> dict[str, dict[str, object]]:
    return {node["nodeKey"]: node for node in instance["nodeInstances"]}  # type: ignore[index]


def _submit(client: TestClient, instance_id: str, node_key: str) -> dict[str, object]:
    instance = client.get(f"/api/student/flow-instances/{instance_id}").json()
    node = _nodes(instance)[node_key]
    payload = {"confirmed": True} if node_key == "join" else {"value": node_key}
    response = client.post(
        f"/api/student/node-instances/{node['id']}/submit",
        json={"payload": payload, "idempotencyKey": f"submit-{node_key}"},
    )
    assert response.status_code == 200
    return response.json()


def _completed_flow(client: TestClient) -> dict[str, object]:
    flow = client.post("/api/workflows", json={"name": "修订迁移流程"}).json()
    saved = client.put(f"/api/workflows/{flow['id']}/draft", json={"config": BASE_CONFIG})
    assert saved.status_code == 200
    roster = client.post(
        f"/api/workflows/{flow['id']}/roster/import",
        json={
            "entries": [{"studentNo": "20260001", "name": "迁移学生"}],
            "sourceFileName": "迁移名单.xlsx",
        },
    )
    assert roster.status_code == 200
    published = client.post(f"/api/workflows/{flow['id']}/publish").json()
    registered = client.post(
        "/api/auth/register",
        json={"studentNo": "20260001", "name": "迁移学生", "password": "Pass1234"},
    )
    assert registered.status_code == 201
    instance = client.post(f"/api/student/shared/{published['token']}/enter").json()
    for node_key in ("root", "left", "right", "join"):
        instance = _submit(client, instance["id"], node_key)
    assert instance["status"] == "completed"
    return {"flow": flow, "published": published, "instance": instance}


def _save_and_republish(
    client: TestClient, context: dict[str, object], config: dict[str, object]
) -> dict[str, object]:
    flow = context["flow"]
    saved = client.put(
        f"/api/workflows/{flow['id']}/draft",  # type: ignore[index]
        json={"config": config},
    )
    assert saved.status_code == 200
    response = client.post(f"/api/workflows/{flow['id']}/publish")  # type: ignore[index]
    assert response.status_code == 201
    return response.json()


def _add_node_artifacts(instance_id: str, node_ids: dict[str, str]) -> None:
    with get_connection() as connection:
        connection.execute(
            "INSERT INTO node_drafts (node_instance_id, payload, updated_at) VALUES (?, ?, ?)",
            (node_ids["left"], '{"draft":"left"}', "2026-07-14T01:00:00+00:00"),
        )
        connection.execute(
            "INSERT INTO node_drafts (node_instance_id, payload, updated_at) VALUES (?, ?, ?)",
            (node_ids["right"], '{"draft":"right"}', "2026-07-14T02:00:00+00:00"),
        )
        for node_key in ("left", "right"):
            connection.execute(
                """
                INSERT INTO student_deadline_overrides
                    (flow_instance_id, node_key, deadline_at, reason, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    instance_id,
                    node_key,
                    "2030-01-01T00:00:00+00:00",
                    f"保留-{node_key}",
                    "1",
                    "2026-07-14T03:00:00+00:00",
                ),
            )


def _table_rows(table: str) -> list[tuple[object, ...]]:
    with get_connection() as connection:
        rows = connection.execute(f"SELECT * FROM {table} ORDER BY rowid").fetchall()
    return [tuple(row) for row in rows]


def _node_before_data(node_instance_id: str) -> dict[str, object]:
    with get_connection() as connection:
        node = connection.execute(
            "SELECT * FROM node_instances WHERE id = ?", (node_instance_id,)
        ).fetchone()
        draft = connection.execute(
            "SELECT * FROM node_drafts WHERE node_instance_id = ?", (node_instance_id,)
        ).fetchone()
        submissions = connection.execute(
            "SELECT * FROM submissions WHERE node_instance_id = ? ORDER BY attempt_no, id",
            (node_instance_id,),
        ).fetchall()
    return {
        "nodeInstance": {
            "id": node["id"],
            "flowInstanceId": node["flow_instance_id"],
            "nodeKey": node["node_key"],
            "status": node["status"],
            "openedAt": node["opened_at"],
            "submittedAt": node["submitted_at"],
            "approvedAt": node["approved_at"],
            "attemptNo": node["attempt_no"],
        },
        "draft": (
            {
                "nodeInstanceId": draft["node_instance_id"],
                "payload": json.loads(draft["payload"]),
                "updatedAt": draft["updated_at"],
            }
            if draft
            else None
        ),
        "submissions": [
            {
                "id": row["id"],
                "nodeInstanceId": row["node_instance_id"],
                "attemptNo": row["attempt_no"],
                "idempotencyKey": row["idempotency_key"],
                "payloadSnapshot": json.loads(row["payload_snapshot"]),
                "status": row["status"],
                "submittedAt": row["submitted_at"],
            }
            for row in submissions
        ],
    }


def test_content_change_resets_only_changed_branch_and_preserves_artifacts(
    client: TestClient,
) -> None:
    context = _completed_flow(client)
    original = context["instance"]
    original_nodes = _nodes(original)  # type: ignore[arg-type]
    node_ids = {key: node["id"] for key, node in original_nodes.items()}
    _add_node_artifacts(original["id"], node_ids)  # type: ignore[index,arg-type]
    changed = deepcopy(BASE_CONFIG)
    changed["nodes"][1]["requirement"] = "填写修改后的左分支"

    republished = _save_and_republish(client, context, changed)
    migrated = client.get(
        f"/api/student/flow-instances/{original['id']}"  # type: ignore[index]
    ).json()
    migrated_nodes = _nodes(migrated)

    assert migrated["id"] == original["id"]  # type: ignore[index]
    assert migrated["flowVersionId"] == republished["flowVersionId"]
    assert migrated["status"] == "in_progress"
    assert {key: node["id"] for key, node in migrated_nodes.items()} == node_ids
    assert {key: node["status"] for key, node in migrated_nodes.items()} == {
        "root": "approved",
        "left": "available",
        "right": "approved",
        "join": "locked",
    }
    assert migrated_nodes["left"]["attemptNo"] == 0
    assert migrated_nodes["left"]["submittedAt"] is None
    assert migrated_nodes["left"]["approvedAt"] is None
    assert migrated_nodes["right"]["attemptNo"] == 1
    assert migrated_nodes["right"]["draft"] == {"draft": "right"}
    with get_connection() as connection:
        assert (
            connection.execute(
                "SELECT 1 FROM submissions WHERE node_instance_id = ?", (node_ids["left"],)
            ).fetchone()
            is None
        )
        overrides = connection.execute(
            "SELECT node_key FROM student_deadline_overrides WHERE flow_instance_id = ?",
            (original["id"],),  # type: ignore[index]
        ).fetchall()
    assert [row["node_key"] for row in overrides] == ["right"]


def test_added_node_is_created_and_rewired_successor_is_reset(client: TestClient) -> None:
    context = _completed_flow(client)
    original = context["instance"]
    changed = deepcopy(BASE_CONFIG)
    changed["edges"].remove(next(edge for edge in changed["edges"] if edge["id"] == "left-join"))
    changed["edges"].extend(
        [
            {"id": "left-review", "source": "left", "target": "review"},
            {"id": "review-join", "source": "review", "target": "join"},
        ]
    )
    changed["nodes"].append(
        {
            "id": "review",
            "kind": "form",
            "title": "复核",
            "requirement": "完成复核",
            "infoFields": ["value"],
            "autoApprove": True,
        }
    )

    _save_and_republish(client, context, changed)
    migrated = client.get(
        f"/api/student/flow-instances/{original['id']}"  # type: ignore[index]
    ).json()

    assert {node["nodeKey"]: node["status"] for node in migrated["nodeInstances"]} == {
        "root": "approved",
        "left": "approved",
        "right": "approved",
        "join": "locked",
        "review": "available",
    }
    review = _nodes(migrated)["review"]
    assert review["attemptNo"] == 0
    assert review["submittedAt"] is None


def test_layout_only_republish_preserves_all_progress_and_has_no_invalidation_audit(
    client: TestClient,
) -> None:
    context = _completed_flow(client)
    original = context["instance"]
    node_ids = {key: node["id"] for key, node in _nodes(original).items()}  # type: ignore[arg-type]
    _add_node_artifacts(original["id"], node_ids)  # type: ignore[index,arg-type]
    before_nodes = _table_rows("node_instances")
    before_drafts = _table_rows("node_drafts")
    before_submissions = _table_rows("submissions")
    before_overrides = _table_rows("student_deadline_overrides")
    changed = deepcopy(BASE_CONFIG)
    changed["nodes"][0].update({"x": 300, "y": 120, "deadlineAt": "2030-01-01"})

    republished = _save_and_republish(client, context, changed)

    assert _table_rows("node_instances") == before_nodes
    assert _table_rows("node_drafts") == before_drafts
    assert _table_rows("submissions") == before_submissions
    assert _table_rows("student_deadline_overrides") == before_overrides
    migrated = client.get(
        f"/api/student/flow-instances/{original['id']}"  # type: ignore[index]
    ).json()
    assert migrated["flowVersionId"] == republished["flowVersionId"]
    with get_connection() as connection:
        count = connection.execute(
            "SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'node_submission_invalidated'"
        ).fetchone()["count"]
    assert count == 0


def test_republish_keeps_token_and_instance_routes_while_moving_progress(
    client: TestClient,
) -> None:
    context = _completed_flow(client)
    original_version_id = context["published"]["flowVersionId"]  # type: ignore[index]
    token = context["published"]["token"]  # type: ignore[index]
    instance_id = context["instance"]["id"]  # type: ignore[index]
    changed = deepcopy(BASE_CONFIG)
    changed["nodes"][1]["title"] = "左分支 v2"

    republished = _save_and_republish(client, context, changed)
    entered = client.post(f"/api/student/shared/{token}/enter").json()
    fetched = client.get(f"/api/student/flow-instances/{instance_id}").json()
    old_progress = client.get(f"/api/workflow-admin/versions/{original_version_id}/progress").json()
    new_progress = client.get(
        f"/api/workflow-admin/versions/{republished['flowVersionId']}/progress"
    ).json()

    assert republished["token"] == token
    assert republished["versionNo"] == 2
    assert entered["id"] == instance_id
    assert fetched["id"] == instance_id
    assert entered["flowVersionId"] == republished["flowVersionId"]
    assert fetched["flowVersionId"] == republished["flowVersionId"]
    assert old_progress["students"] == []
    assert [student["instanceId"] for student in new_progress["students"]] == [instance_id]


def test_invalidation_audit_captures_state_draft_and_submissions_before_delete(
    client: TestClient,
) -> None:
    context = _completed_flow(client)
    original = context["instance"]
    node_ids = {key: node["id"] for key, node in _nodes(original).items()}  # type: ignore[arg-type]
    _add_node_artifacts(original["id"], node_ids)  # type: ignore[index,arg-type]
    expected_left = _node_before_data(node_ids["left"])
    changed = deepcopy(BASE_CONFIG)
    changed["nodes"][1]["requirement"] = "新的左分支要求"

    republished = _save_and_republish(client, context, changed)

    with get_connection() as connection:
        invalidated = connection.execute(
            """
            SELECT entity_id, before_data FROM audit_logs
            WHERE action = 'node_submission_invalidated'
            ORDER BY id
            """
        ).fetchall()
        workflow_audit = connection.execute(
            "SELECT after_data FROM audit_logs WHERE action = 'workflow_republish'"
        ).fetchone()
        token_audit = connection.execute(
            "SELECT * FROM audit_logs WHERE action = 'share_token_retargeted'"
        ).fetchone()

    assert [row["entity_id"] for row in invalidated] == [
        node_ids["left"],
        node_ids["join"],
    ]
    assert json.loads(invalidated[0]["before_data"]) == expected_left
    assert json.loads(workflow_audit["after_data"]) == {
        "addedNodeIds": [],
        "changedNodeIds": ["left"],
        "invalidatedNodeIds": ["left", "join"],
        "migratedStudentCount": 1,
        "newVersionId": republished["flowVersionId"],
        "oldVersionId": context["published"]["flowVersionId"],  # type: ignore[index]
        "predecessorChangedNodeIds": [],
    }
    assert token_audit is not None
    assert context["published"]["token"] not in "|".join(  # type: ignore[index]
        str(value) for value in token_audit
    )


def test_forced_migration_failure_rolls_back_every_republish_change(
    client: TestClient,
) -> None:
    context = _completed_flow(client)
    changed = deepcopy(BASE_CONFIG)
    changed["nodes"][1]["title"] = "触发回滚"
    flow_id = context["flow"]["id"]  # type: ignore[index]
    saved = client.put(f"/api/workflows/{flow_id}/draft", json={"config": changed})
    assert saved.status_code == 200
    tables = (
        "flow_versions",
        "flow_node_runtime_configs",
        "share_tokens",
        "flow_instances",
        "node_instances",
        "node_drafts",
        "submissions",
        "student_deadline_overrides",
        "audit_logs",
    )
    before = {table: _table_rows(table) for table in tables}
    with get_connection() as connection:
        teacher_id = connection.execute(
            "SELECT id FROM teacher_accounts WHERE employee_no = 'RP001'"
        ).fetchone()["id"]
        connection.execute(
            """
            CREATE TRIGGER force_republish_failure
            BEFORE UPDATE OF flow_version_id ON share_tokens
            BEGIN
                SELECT RAISE(ABORT, 'forced migration failure');
            END
            """
        )

    with pytest.raises(sqlite3.IntegrityError, match="forced migration failure"):
        publish_flow(flow_id, teacher_id)

    assert {table: _table_rows(table) for table in tables} == before
