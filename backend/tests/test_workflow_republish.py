from collections.abc import Iterator
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import secrets
import sqlite3
import uuid

from fastapi.testclient import TestClient
import pytest

from app.core.config import settings
from app.core.database import get_connection
from app.main import app
from app.repositories import flow_instances
from app.repositories.workflows import canonical_json, publish_flow, resolve_share_token


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
        override = connection.execute(
            """
            SELECT * FROM student_deadline_overrides
            WHERE flow_instance_id = ? AND node_key = ?
            """,
            (node["flow_instance_id"], node["node_key"]),
        ).fetchone()
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
        "deadlineOverride": (
            {
                "flowInstanceId": override["flow_instance_id"],
                "nodeKey": override["node_key"],
                "deadlineAt": override["deadline_at"],
                "reason": override["reason"],
                "createdBy": override["created_by"],
                "createdAt": override["created_at"],
            }
            if override
            else None
        ),
    }


def _insert_legacy_published_version(
    flow_id: str, config: dict[str, object], teacher_id: int
) -> tuple[str, str]:
    version_id = str(uuid.uuid4())
    token = secrets.token_urlsafe(32)
    snapshot = canonical_json(config)
    now = "2026-07-14T04:00:00+00:00"
    with get_connection() as connection:
        version_no = connection.execute(
            "SELECT MAX(version_no) + 1 AS value FROM flow_versions WHERE flow_id = ?",
            (flow_id,),
        ).fetchone()["value"]
        connection.execute(
            """
            INSERT INTO flow_versions
                (id, flow_id, version_no, config_snapshot, config_hash,
                 status, published_by, published_at)
            VALUES (?, ?, ?, ?, ?, 'published', ?, ?)
            """,
            (
                version_id,
                flow_id,
                version_no,
                snapshot,
                hashlib.sha256(snapshot.encode()).hexdigest(),
                str(teacher_id),
                now,
            ),
        )
        for node in config["nodes"]:  # type: ignore[index]
            connection.execute(
                """
                INSERT INTO flow_node_runtime_configs
                    (flow_version_id, node_key, deadline_at, updated_by, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (version_id, node["id"], node.get("deadlineAt"), str(teacher_id), now),
            )
        connection.execute(
            """
            INSERT INTO share_tokens
                (id, flow_version_id, token_hash, token_value, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid.uuid4()),
                version_id,
                hashlib.sha256(token.encode()).hexdigest(),
                token,
                str(teacher_id),
                now,
            ),
        )
    return version_id, token


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
    assert migrated_nodes["root"]["id"] == node_ids["root"]
    assert migrated_nodes["right"]["id"] == node_ids["right"]
    assert migrated_nodes["left"]["id"] != node_ids["left"]
    assert migrated_nodes["join"]["id"] != node_ids["join"]
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
    expected_left.update(
        {
            "oldVersionId": context["published"]["flowVersionId"],  # type: ignore[index]
            "newVersionId": republished["flowVersionId"],
            "invalidationReasons": ["node_definition_changed"],
        }
    )

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
        "affectedStudentCount": 1,
        "changedNodeIds": ["left"],
        "invalidatedNodeIds": ["left", "join"],
        "migratedStudentCount": 1,
        "newVersionId": republished["flowVersionId"],
        "oldVersionId": context["published"]["flowVersionId"],  # type: ignore[index]
        "oldVersionIds": [context["published"]["flowVersionId"]],  # type: ignore[index]
        "predecessorChangedNodeIds": [],
        "sourceVersionImpacts": [
            {
                "addedNodeIds": [],
                "affectedStudentCount": 1,
                "changedNodeIds": ["left"],
                "invalidatedNodeIds": ["left", "join"],
                "predecessorChangedNodeIds": [],
                "status": "published",
                "versionId": context["published"]["flowVersionId"],  # type: ignore[index]
                "versionNo": 1,
            }
        ],
    }
    assert token_audit is not None
    assert context["published"]["token"] not in "|".join(  # type: ignore[index]
        str(value) for value in token_audit
    )


def test_late_draft_and_submit_using_invalidated_node_id_are_rejected(
    client: TestClient,
) -> None:
    context = _completed_flow(client)
    original = context["instance"]
    old_left_id = _nodes(original)["left"]["id"]  # type: ignore[arg-type]
    changed = deepcopy(BASE_CONFIG)
    changed["nodes"][1]["requirement"] = "迁移后的左分支要求"

    _save_and_republish(client, context, changed)

    late_draft = client.put(
        f"/api/student/node-instances/{old_left_id}/draft",
        json={"payload": {"value": "stale"}},
    )
    late_submit = client.post(
        f"/api/student/node-instances/{old_left_id}/submit",
        json={"payload": {"value": "stale"}, "idempotencyKey": "stale-submit"},
    )
    retried_submit = client.post(
        f"/api/student/node-instances/{old_left_id}/submit",
        json={"payload": {"value": "stale"}, "idempotencyKey": "stale-submit"},
    )
    migrated = client.get(
        f"/api/student/flow-instances/{original['id']}"  # type: ignore[index]
    ).json()
    new_left = _nodes(migrated)["left"]

    assert late_draft.status_code == 404
    assert late_submit.status_code == 404
    assert retried_submit.status_code == 404
    assert new_left["id"] != old_left_id
    assert new_left["status"] == "available"
    assert new_left["attemptNo"] == 0
    assert new_left["draft"] == {}


def test_multiple_published_versions_tokens_and_duplicate_students_are_normalized(
    client: TestClient,
) -> None:
    context = _completed_flow(client)
    flow_id = context["flow"]["id"]  # type: ignore[index]
    version_one = context["published"]["flowVersionId"]  # type: ignore[index]
    token_one = context["published"]["token"]  # type: ignore[index]
    with get_connection() as connection:
        teacher_id = connection.execute(
            "SELECT id FROM teacher_accounts WHERE employee_no = 'RP001'"
        ).fetchone()["id"]
    version_two, token_two = _insert_legacy_published_version(flow_id, BASE_CONFIG, teacher_id)
    latest_duplicate = client.post(f"/api/student/shared/{token_two}/enter").json()
    for node_key in ("root", "left", "right", "join"):
        latest_duplicate = _submit(client, latest_duplicate["id"], node_key)

    roster = client.post(
        f"/api/workflows/{flow_id}/roster/import",
        json={
            "entries": [{"studentNo": "20260002", "name": "历史版本学生"}],
            "sourceFileName": "历史名单.xlsx",
        },
    )
    assert roster.status_code == 200
    client.post("/api/auth/logout")
    registered = client.post(
        "/api/auth/register",
        json={"studentNo": "20260002", "name": "历史版本学生", "password": "Pass1234"},
    )
    assert registered.status_code == 201
    old_only = client.post(f"/api/student/shared/{token_one}/enter").json()
    with get_connection() as connection:
        connection.execute(
            "UPDATE flow_versions SET status = 'disabled' WHERE id = ?",
            (version_one,),
        )

    changed = deepcopy(BASE_CONFIG)
    changed["nodes"][1]["requirement"] = "统一迁移要求"
    saved = client.put(f"/api/workflows/{flow_id}/draft", json={"config": changed})
    assert saved.status_code == 200
    impact = client.post(f"/api/workflows/{flow_id}/revision-impact").json()
    assert impact["affectedStudentCount"] == 2
    assert impact["invalidatedNodeIds"] == ["left", "join"]
    assert impact["sourceVersionImpacts"] == [
        {
            "versionId": version_one,
            "versionNo": 1,
            "status": "disabled",
            "addedNodeIds": [],
            "changedNodeIds": ["left"],
            "predecessorChangedNodeIds": [],
            "invalidatedNodeIds": ["left", "join"],
            "affectedStudentCount": 2,
        },
        {
            "versionId": version_two,
            "versionNo": 2,
            "status": "published",
            "addedNodeIds": [],
            "changedNodeIds": ["left"],
            "predecessorChangedNodeIds": [],
            "invalidatedNodeIds": ["left", "join"],
            "affectedStudentCount": 1,
        },
    ]
    republished = _save_and_republish(client, context, changed)

    with get_connection() as connection:
        instances = connection.execute(
            """
            SELECT flow_instances.id, flow_instances.flow_version_id,
                   flow_instances.student_account_id
            FROM flow_instances
            JOIN flow_versions ON flow_versions.id = flow_instances.flow_version_id
            WHERE flow_versions.flow_id = ?
            ORDER BY flow_instances.student_account_id
            """,
            (flow_id,),
        ).fetchall()
        old_statuses = connection.execute(
            "SELECT id, status FROM flow_versions WHERE id IN (?, ?) ORDER BY id",
            (version_one, version_two),
        ).fetchall()
        workflow_audit = connection.execute(
            "SELECT after_data FROM audit_logs WHERE action = 'workflow_republish'"
        ).fetchone()

    assert len(instances) == 2
    assert {row["flow_version_id"] for row in instances} == {republished["flowVersionId"]}
    assert latest_duplicate["id"] in {row["id"] for row in instances}
    assert old_only["id"] in {row["id"] for row in instances}
    assert context["instance"]["id"] not in {row["id"] for row in instances}  # type: ignore[index]
    assert {row["status"] for row in old_statuses} == {"disabled"}
    assert resolve_share_token(token_one)["flowVersionId"] == republished["flowVersionId"]
    assert resolve_share_token(token_two)["flowVersionId"] == republished["flowVersionId"]
    audit_data = json.loads(workflow_audit["after_data"])
    assert audit_data["affectedStudentCount"] == 2
    assert audit_data["sourceVersionImpacts"] == impact["sourceVersionImpacts"]


def test_student_enter_after_republish_creates_only_a_new_version_instance(
    client: TestClient,
) -> None:
    context = _completed_flow(client)
    flow_id = context["flow"]["id"]  # type: ignore[index]
    old_token = context["published"]["token"]  # type: ignore[index]
    roster = client.post(
        f"/api/workflows/{flow_id}/roster/import",
        json={
            "entries": [{"studentNo": "20260003", "name": "迟到学生"}],
            "sourceFileName": "迟到名单.xlsx",
        },
    )
    assert roster.status_code == 200
    republished = _save_and_republish(client, context, deepcopy(BASE_CONFIG))
    client.post("/api/auth/logout")
    registered = client.post(
        "/api/auth/register",
        json={"studentNo": "20260003", "name": "迟到学生", "password": "Pass1234"},
    )
    assert registered.status_code == 201

    entered = client.post(f"/api/student/shared/{old_token}/enter").json()

    assert entered["flowVersionId"] == republished["flowVersionId"]
    with get_connection() as connection:
        versions = connection.execute(
            """
            SELECT flow_version_id FROM flow_instances
            WHERE student_account_id = (
                SELECT id FROM student_accounts WHERE student_no = '20260003'
            )
            """
        ).fetchall()
    assert [row["flow_version_id"] for row in versions] == [republished["flowVersionId"]]


def test_partial_progress_recomputes_changed_node_with_past_deadline(
    client: TestClient,
) -> None:
    context = _completed_flow(client)
    original = context["instance"]
    right_id = _nodes(original)["right"]["id"]  # type: ignore[arg-type]
    with get_connection() as connection:
        connection.execute("UPDATE node_instances SET status = 'draft' WHERE id = ?", (right_id,))
        connection.execute(
            """
            INSERT INTO node_drafts (node_instance_id, payload, updated_at)
            VALUES (?, '{"value":"partial"}', '2026-07-14T05:00:00+00:00')
            """,
            (right_id,),
        )
        connection.execute(
            "UPDATE flow_instances SET status = 'in_progress', completed_at = NULL WHERE id = ?",
            (original["id"],),  # type: ignore[index]
        )
    changed = deepcopy(BASE_CONFIG)
    changed["nodes"][1].update(
        {
            "requirement": "已经过期的新要求",
            "deadlineAt": "2020-01-01T00:00:00+00:00",
        }
    )

    _save_and_republish(client, context, changed)
    migrated = client.get(
        f"/api/student/flow-instances/{original['id']}"  # type: ignore[index]
    ).json()

    assert {key: node["status"] for key, node in _nodes(migrated).items()} == {
        "root": "approved",
        "left": "expired",
        "right": "draft",
        "join": "locked",
    }
    assert _nodes(migrated)["right"]["draft"] == {"value": "partial"}


def test_runtime_writes_begin_immediately_and_revalidate_current_version(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    context = _completed_flow(client)
    changed = deepcopy(BASE_CONFIG)
    changed["nodes"][1]["requirement"] = "事务协议要求"
    republished = _save_and_republish(client, context, changed)
    instance_id = context["instance"]["id"]  # type: ignore[index]
    migrated = client.get(f"/api/student/flow-instances/{instance_id}").json()
    nodes = _nodes(migrated)
    with get_connection() as connection:
        student_id = connection.execute(
            "SELECT id FROM student_accounts WHERE student_no = '20260001'"
        ).fetchone()["id"]
        teacher_id = connection.execute(
            "SELECT id FROM teacher_accounts WHERE employee_no = 'RP001'"
        ).fetchone()["id"]

    real_get_connection = flow_instances.get_connection
    statements: list[str] = []

    def traced_connection():
        connection = real_get_connection()
        connection.set_trace_callback(statements.append)
        return connection

    monkeypatch.setattr(flow_instances, "get_connection", traced_connection)

    def capture(operation) -> tuple[str, list[str]]:
        statements.clear()
        operation()
        return statements[0].strip().upper(), list(statements)

    first_statements: list[str] = []
    first, enter_trace = capture(
        lambda: flow_instances.get_or_create_instance(
            context["published"]["token"],
            student_id,  # type: ignore[index]
        )
    )
    first_statements.append(first)
    first_statements.append(
        capture(
            lambda: flow_instances.save_node_draft(
                nodes["left"]["id"], student_id, {"value": "draft"}
            )
        )[0]
    )
    first_statements.append(
        capture(
            lambda: flow_instances.submit_node(
                nodes["left"]["id"], student_id, {"value": "left"}, "transactional"
            )
        )[0]
    )
    first_statements.append(
        capture(
            lambda: flow_instances.set_student_deadline(
                instance_id,
                "right",
                "2031-01-01T00:00:00+00:00",
                "事务覆盖",
                teacher_id,
            )
        )[0]
    )
    first_statements.append(
        capture(
            lambda: flow_instances.set_global_deadline(
                republished["flowVersionId"],
                "right",
                "2032-01-01T00:00:00+00:00",
                "事务全局截止时间",
                teacher_id,
            )
        )[0]
    )

    assert first_statements == ["BEGIN IMMEDIATE"] * 5
    assert any("FROM SHARE_TOKENS" in statement.upper() for statement in enter_trace)


def test_get_instance_uses_one_snapshot_when_republish_commits_between_selects(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    context = _completed_flow(client)
    flow_id = context["flow"]["id"]  # type: ignore[index]
    instance_id = context["instance"]["id"]  # type: ignore[index]
    old_version_id = context["published"]["flowVersionId"]  # type: ignore[index]
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
            "title": "并发复核",
            "requirement": "并发复核要求",
            "infoFields": ["value"],
            "autoApprove": True,
        }
    )
    saved = client.put(f"/api/workflows/{flow_id}/draft", json={"config": changed})
    assert saved.status_code == 200
    with get_connection() as connection:
        student_id = connection.execute(
            "SELECT id FROM student_accounts WHERE student_no = '20260001'"
        ).fetchone()["id"]
        teacher_id = connection.execute(
            "SELECT id FROM teacher_accounts WHERE employee_no = 'RP001'"
        ).fetchone()["id"]

    real_get_connection = flow_instances.get_connection
    triggered = False
    new_publication: dict[str, object] = {}

    class CursorProxy:
        def __init__(self, cursor):
            self.cursor = cursor

        def fetchone(self):
            nonlocal triggered, new_publication
            row = self.cursor.fetchone()
            if not triggered:
                triggered = True
                new_publication = publish_flow(flow_id, teacher_id)
            return row

        def __getattr__(self, name):
            return getattr(self.cursor, name)

    class ConnectionProxy:
        def __init__(self):
            self.connection = real_get_connection()

        def execute(self, sql, parameters=()):
            cursor = self.connection.execute(sql, parameters)
            if "SELECT i.*, a.student_no" in sql:
                return CursorProxy(cursor)
            return cursor

        def __enter__(self):
            self.connection.__enter__()
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            return self.connection.__exit__(exc_type, exc_value, traceback)

        def __getattr__(self, name):
            return getattr(self.connection, name)

    monkeypatch.setattr(flow_instances, "get_connection", ConnectionProxy)

    snapshot = flow_instances.get_instance(instance_id, student_id)

    assert triggered is True
    assert snapshot["flowVersionId"] == old_version_id
    assert [node["nodeKey"] for node in snapshot["nodeInstances"]] == [
        "root",
        "left",
        "right",
        "join",
    ]
    current = flow_instances.get_instance(instance_id, student_id)
    assert current["flowVersionId"] == new_publication["flowVersionId"]
    assert "review" in {node["nodeKey"] for node in current["nodeInstances"]}


def test_republish_retargets_only_unexpired_active_tokens_and_returns_a_valid_one(
    client: TestClient,
) -> None:
    context = _completed_flow(client)
    old_version_id = context["published"]["flowVersionId"]  # type: ignore[index]
    original_token = context["published"]["token"]  # type: ignore[index]
    valid_token = "valid-history-token"
    expired_token = "expired-history-token"
    with get_connection() as connection:
        teacher_id = connection.execute(
            "SELECT id FROM teacher_accounts WHERE employee_no = 'RP001'"
        ).fetchone()["id"]
        for token, expires_at, created_at in (
            (valid_token, "2035-01-01T00:00:00+00:00", "2031-01-01T00:00:00+00:00"),
            (expired_token, "2020-01-01T00:00:00+00:00", "2032-01-01T00:00:00+00:00"),
        ):
            connection.execute(
                """
                INSERT INTO share_tokens
                    (id, flow_version_id, token_hash, token_value, status,
                     expires_at, created_by, created_at)
                VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    old_version_id,
                    hashlib.sha256(token.encode()).hexdigest(),
                    token,
                    expires_at,
                    str(teacher_id),
                    created_at,
                ),
            )

    republished = _save_and_republish(client, context, deepcopy(BASE_CONFIG))

    assert republished["token"] == valid_token
    assert resolve_share_token(original_token)["flowVersionId"] == republished["flowVersionId"]
    assert resolve_share_token(valid_token)["flowVersionId"] == republished["flowVersionId"]
    with pytest.raises(KeyError):
        resolve_share_token(expired_token)
    with get_connection() as connection:
        token_targets = {
            row["token_value"]: row["flow_version_id"]
            for row in connection.execute(
                """
                SELECT token_value, flow_version_id FROM share_tokens
                WHERE token_value IN (?, ?, ?)
                """,
                (original_token, valid_token, expired_token),
            ).fetchall()
        }
    assert token_targets == {
        original_token: republished["flowVersionId"],
        valid_token: republished["flowVersionId"],
        expired_token: old_version_id,
    }


def test_republish_creates_a_new_token_when_all_old_tokens_are_expired(
    client: TestClient,
) -> None:
    context = _completed_flow(client)
    old_token = context["published"]["token"]  # type: ignore[index]
    old_version_id = context["published"]["flowVersionId"]  # type: ignore[index]
    with get_connection() as connection:
        connection.execute(
            """
            UPDATE share_tokens SET expires_at = '2020-01-01T00:00:00+00:00'
            WHERE token_value = ?
            """,
            (old_token,),
        )

    republished = _save_and_republish(client, context, deepcopy(BASE_CONFIG))

    assert republished["token"] != old_token
    assert (
        resolve_share_token(republished["token"])["flowVersionId"] == republished["flowVersionId"]
    )
    with pytest.raises(KeyError):
        resolve_share_token(old_token)
    with get_connection() as connection:
        old_target = connection.execute(
            "SELECT flow_version_id FROM share_tokens WHERE token_value = ?",
            (old_token,),
        ).fetchone()["flow_version_id"]
    assert old_target == old_version_id


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
