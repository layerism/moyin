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
    roster = client.post(
        f"/api/workflows/{flow['id']}/roster/import",
        json={
            "entries": [{"studentNo": "S901", "name": "学生甲"}],
            "sourceFileName": "归档名单.xlsx",
        },
    )
    assert roster.status_code == 200
    published = client.post(f"/api/workflows/{flow['id']}/publish").json()
    return {"flowId": flow["id"], "versionId": published["flowVersionId"]}


def test_student_session_cannot_create_teacher_flow(client: TestClient) -> None:
    client.post(
        "/api/auth/student/register",
        json={"name": "学生甲", "studentNo": "S900", "password": "Pass1234"},
    )

    response = client.post("/api/workflows", json={"name": "越权流程"})

    assert response.status_code == 401


def test_delete_removes_flow_owned_data_and_retains_accounts_and_audit(
    client: TestClient,
) -> None:
    login_teacher(client)
    created = create_published_flow(client)
    client.post(
        "/api/auth/student/register",
        json={"name": "学生甲", "studentNo": "S901", "password": "Pass1234"},
    )
    flow_id = str(created["flowId"])
    version_id = str(created["versionId"])
    instance_id = "delete-test-instance"
    node_instance_id = "delete-test-node"
    now = "2026-07-10T12:00:00+00:00"

    with get_connection() as connection:
        student_id = connection.execute(
            "SELECT id FROM student_accounts WHERE student_no = 'S901'"
        ).fetchone()["id"]
        connection.execute(
            """
            INSERT INTO flow_instances
                (id, flow_version_id, student_account_id, started_at, last_active_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (instance_id, version_id, student_id, now, now),
        )
        connection.execute(
            """
            INSERT INTO node_instances
                (id, flow_instance_id, node_key, status, opened_at)
            VALUES (?, ?, 'n1', 'draft', ?)
            """,
            (node_instance_id, instance_id, now),
        )
        connection.execute(
            "INSERT INTO node_drafts (node_instance_id, payload, updated_at) VALUES (?, '{}', ?)",
            (node_instance_id, now),
        )
        connection.execute(
            """
            INSERT INTO submissions
                (id, node_instance_id, attempt_no, idempotency_key,
                 payload_snapshot, status, submitted_at)
            VALUES ('delete-test-submission', ?, 1, 'delete-test-key', '{}', 'approved', ?)
            """,
            (node_instance_id, now),
        )
        connection.execute(
            """
            INSERT INTO student_deadline_overrides
                (flow_instance_id, node_key, deadline_at, reason, created_by, created_at)
            VALUES (?, 'n1', ?, '延期', 'teacher-local', ?)
            """,
            (instance_id, now, now),
        )
        connection.executemany(
            """
            INSERT INTO audit_logs
                (actor_id, action, entity_type, entity_id, created_at)
            VALUES ('teacher-local', ?, ?, ?, ?)
            """,
            [
                ("archive", "flow", flow_id, now),
                ("deadline_update", "flow_node_runtime", f"{version_id}:n1", now),
                ("deadline_override", "node_instance", f"{instance_id}:n1", now),
            ],
        )

    response = client.delete(f"/api/workflows/{flow_id}")

    assert response.status_code == 204
    assert client.get("/api/workflows").json() == []
    with get_connection() as connection:
        counts = {
            "flows": connection.execute(
                "SELECT COUNT(*) AS count FROM flows WHERE id = ?", (flow_id,)
            ).fetchone()["count"],
            "flow_roster_entries": connection.execute(
                "SELECT COUNT(*) AS count FROM flow_roster_entries WHERE flow_id = ?",
                (flow_id,),
            ).fetchone()["count"],
            "flow_versions": connection.execute(
                "SELECT COUNT(*) AS count FROM flow_versions WHERE flow_id = ?", (flow_id,)
            ).fetchone()["count"],
            "flow_node_runtime_configs": connection.execute(
                "SELECT COUNT(*) AS count FROM flow_node_runtime_configs WHERE flow_version_id = ?",
                (version_id,),
            ).fetchone()["count"],
            "share_tokens": connection.execute(
                "SELECT COUNT(*) AS count FROM share_tokens WHERE flow_version_id = ?",
                (version_id,),
            ).fetchone()["count"],
            "flow_instances": connection.execute(
                "SELECT COUNT(*) AS count FROM flow_instances WHERE id = ?", (instance_id,)
            ).fetchone()["count"],
            "node_instances": connection.execute(
                "SELECT COUNT(*) AS count FROM node_instances WHERE id = ?", (node_instance_id,)
            ).fetchone()["count"],
            "node_drafts": connection.execute(
                "SELECT COUNT(*) AS count FROM node_drafts WHERE node_instance_id = ?",
                (node_instance_id,),
            ).fetchone()["count"],
            "submissions": connection.execute(
                "SELECT COUNT(*) AS count FROM submissions WHERE node_instance_id = ?",
                (node_instance_id,),
            ).fetchone()["count"],
            "student_deadline_overrides": connection.execute(
                "SELECT COUNT(*) AS count FROM student_deadline_overrides WHERE flow_instance_id = ?",
                (instance_id,),
            ).fetchone()["count"],
        }
        account_counts = connection.execute(
            """
            SELECT
                (SELECT COUNT(*) FROM teacher_accounts) AS teachers,
                (SELECT COUNT(*) FROM student_accounts) AS students
            """
        ).fetchone()
        audit_rows = connection.execute(
            "SELECT action, entity_type, entity_id, before_data, after_data FROM audit_logs"
        ).fetchall()

    assert counts == {table: 0 for table in counts}
    assert account_counts["teachers"] == 1
    assert account_counts["students"] == 1
    assert len(audit_rows) == 1
    assert audit_rows[0]["action"] == "delete"
    assert audit_rows[0]["entity_type"] == "flow"
    assert audit_rows[0]["entity_id"] == flow_id
    assert '"name":"归档验证流程"' in audit_rows[0]["before_data"]
    assert audit_rows[0]["after_data"] is None


def test_delete_missing_flow_returns_not_found(client: TestClient) -> None:
    login_teacher(client)
    created = create_published_flow(client)
    path = f"/api/workflows/{created['flowId']}"

    assert client.delete(path).status_code == 204
    assert client.delete(path).status_code == 404
    assert client.put(f"{path}/draft", json={"config": {"nodes": [], "edges": []}}).status_code == 404
    assert client.post(f"{path}/publish").status_code == 404
