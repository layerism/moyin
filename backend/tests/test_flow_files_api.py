import base64
import sqlite3
from collections.abc import Iterator
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app.core.config import settings
from app.main import app
from app.api.routes import student_flows, workflows
from app.repositories.flow_files import add_pending_scan
from tests.teacher_auth_helpers import login_teacher, provision_teacher


ONE_PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


class FakeObjectStorage:
    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.fail_put = False

    def put_object(self, key, fileobj, content_type):
        if self.fail_put:
            raise RuntimeError("fake OSS failure")
        self.objects[key] = fileobj.read()
        return type("Upload", (), {"etag": "fake-etag"})()

    def delete_object(self, key):
        self.objects.pop(key, None)

    def signed_download_url(self, key, filename):
        return f"https://download.invalid/{key}?name={filename}"


@pytest.fixture
def client(tmp_path: Path, monkeypatch) -> Iterator[tuple[TestClient, FakeObjectStorage]]:
    settings.database_path = str(tmp_path / "test.db")
    storage = FakeObjectStorage()
    monkeypatch.setattr(student_flows, "get_object_storage", lambda: storage, raising=False)
    monkeypatch.setattr(workflows, "get_object_storage", lambda: storage, raising=False)
    with TestClient(app) as test_client:
        provision_teacher(employee_no="14001", name="测试教师")
        login_teacher(test_client, employee_no="14001", name="测试教师")
        yield test_client, storage


def publish_file_flow(client: TestClient) -> dict:
    flow = client.post("/api/workflows", json={"name": "材料流程"}).json()
    config = {
        "nodes": [
            {
                "id": "file-node",
                "kind": "file",
                "title": "材料审核",
                "requirement": "上传材料",
                "infoFields": [],
                "fileExtensions": ".pdf,.docx",
                "fileLimitMb": "2",
                "autoApprove": True,
            }
        ],
        "edges": [],
    }
    draft = client.put(f"/api/workflows/{flow['id']}/draft", json={"config": config})
    assert draft.status_code == 200
    roster = client.post(
        f"/api/workflows/{flow['id']}/roster/import",
        json={"entries": [{"studentNo": "20260071", "name": "上传学生"}, {"studentNo": "20260072", "name": "另一位学生"}], "sourceFileName": "名单.xlsx"},
    )
    assert roster.status_code == 200
    published = client.post(f"/api/workflows/{flow['id']}/publish")
    assert published.status_code == 201
    return published.json()


def publish_confirmation_flow(client: TestClient) -> dict:
    flow = client.post("/api/workflows", json={"name": "签署流程"}).json()
    config = {
        "nodes": [
            {
                "id": "confirmation-node",
                "kind": "confirmation",
                "title": "签署安全责任书",
                "requirement": "下载、签署并上传扫描件",
                "infoFields": [],
                "scanAuditEnabled": True,
                "scanAuditMode": "pass_fail",
                "scanAuditPrompt": "检查签名和日期是否完整",
            }
        ],
        "edges": [],
    }
    draft = client.put(f"/api/workflows/{flow['id']}/draft", json={"config": config})
    assert draft.status_code == 200
    template = client.post(
        f"/api/workflows/{flow['id']}/nodes/confirmation-node/template",
        files={
            "file": (
                "安全责任书.docx",
                b"template-content",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert template.status_code == 200
    roster = client.post(
        f"/api/workflows/{flow['id']}/roster/import",
        json={
            "entries": [{"studentNo": "20260081", "name": "签署学生"}],
            "sourceFileName": "签署名单.xlsx",
        },
    )
    assert roster.status_code == 200
    published = client.post(f"/api/workflows/{flow['id']}/publish")
    assert published.status_code == 201
    return published.json()


def register_student(client: TestClient, number: str, name: str) -> None:
    response = client.post(
        "/api/auth/register",
        json={"name": name, "studentNo": number, "password": "Pass1234"},
    )
    assert response.status_code == 201


def test_upload_persists_metadata_and_submit_attaches_it(client):
    test_client, storage = client
    published = publish_file_flow(test_client)
    register_student(test_client, "20260071", "上传学生")
    instance = test_client.post(f"/api/student/shared/{published['token']}/enter").json()
    node_id = instance["nodeInstances"][0]["id"]

    uploaded = test_client.post(
        f"/api/student/node-instances/{node_id}/file",
        files={"file": ("材料.pdf", b"pdf-content", "application/pdf")},
    )

    assert uploaded.status_code == 200
    file_record = uploaded.json()
    submitted = test_client.post(
        f"/api/student/node-instances/{node_id}/submit",
        json={"payload": {"file": {"fileId": file_record["fileId"]}}, "idempotencyKey": "file-1"},
    )
    assert submitted.status_code == 200
    assert storage.objects[file_record["storageKey"]] == b"pdf-content"
    with sqlite3.connect(settings.database_path) as connection:
        row = connection.execute(
            "SELECT submission_id, sha256, size_bytes FROM uploaded_files WHERE id = ?",
            (file_record["fileId"],),
        ).fetchone()
    assert row[0]
    assert row[1]
    assert row[2] == 11


def test_wrong_extension_and_cross_student_file_id_are_rejected(client):
    test_client, _ = client
    published = publish_file_flow(test_client)
    register_student(test_client, "20260071", "上传学生")
    instance = test_client.post(f"/api/student/shared/{published['token']}/enter").json()
    node_id = instance["nodeInstances"][0]["id"]
    wrong = test_client.post(
        f"/api/student/node-instances/{node_id}/file",
        files={"file": ("材料.exe", b"x", "application/octet-stream")},
    )
    assert wrong.status_code == 409
    valid = test_client.post(
        f"/api/student/node-instances/{node_id}/file",
        files={"file": ("材料.pdf", b"x", "application/pdf")},
    ).json()
    test_client.post("/api/auth/logout")
    register_student(test_client, "20260072", "另一位学生")
    other = test_client.post(f"/api/student/shared/{published['token']}/enter").json()
    cross_student = test_client.post(
        f"/api/student/node-instances/{other['nodeInstances'][0]['id']}/submit",
        json={"payload": {"file": {"fileId": valid["fileId"]}}, "idempotencyKey": "cross-1"},
    )
    assert cross_student.status_code == 409


def test_storage_failure_does_not_leave_metadata(client):
    test_client, storage = client
    published = publish_file_flow(test_client)
    register_student(test_client, "20260071", "上传学生")
    instance = test_client.post(f"/api/student/shared/{published['token']}/enter").json()
    storage.fail_put = True

    response = test_client.post(
        f"/api/student/node-instances/{instance['nodeInstances'][0]['id']}/file",
        files={"file": ("材料.pdf", b"x", "application/pdf")},
    )

    assert response.status_code == 502
    assert storage.objects == {}


def test_confirmation_scan_upload_rejects_wrong_filename_before_storage(client):
    test_client, storage = client
    published = publish_confirmation_flow(test_client)
    register_student(test_client, "20260081", "签署学生")
    instance = test_client.post(f"/api/student/shared/{published['token']}/enter").json()
    node_id = instance["nodeInstances"][0]["id"]
    downloaded = test_client.post(f"/api/student/node-instances/{node_id}/template/download")
    assert downloaded.status_code == 200

    invalid_scan = test_client.post(
        f"/api/student/node-instances/{node_id}/scans",
        files={"file": ("扫描件1.png", ONE_PIXEL_PNG, "image/png")},
    )

    assert invalid_scan.status_code == 422
    assert "请改为以“安全责任书”开头" in invalid_scan.json()["detail"]
    assert storage.objects == {}
    with sqlite3.connect(settings.database_path) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM uploaded_files WHERE node_instance_id = ?", (node_id,)
        ).fetchone()[0] == 0


def test_confirmation_submit_rejects_wrong_scan_filename_before_audit(client):
    test_client, _ = client
    published = publish_confirmation_flow(test_client)
    register_student(test_client, "20260081", "签署学生")
    instance = test_client.post(f"/api/student/shared/{published['token']}/enter").json()
    node_id = instance["nodeInstances"][0]["id"]
    downloaded = test_client.post(f"/api/student/node-instances/{node_id}/template/download")
    assert downloaded.status_code == 200
    with sqlite3.connect(settings.database_path) as connection:
        student_id = connection.execute(
            """
            SELECT i.student_account_id
            FROM node_instances n
            JOIN flow_instances i ON i.id = n.flow_instance_id
            WHERE n.id = ?
            """,
            (node_id,),
        ).fetchone()[0]
    invalid_scan = add_pending_scan(
        node_id,
        student_id,
        "test/invalid-scan.png",
        "扫描件1.png",
        "image/png",
        len(ONE_PIXEL_PNG),
        "invalid-scan-sha256",
        "invalid-scan-etag",
        1,
    )

    rejected = test_client.post(
        f"/api/student/node-instances/{node_id}/submit",
        json={"payload": {"confirmed": True}, "idempotencyKey": "invalid-name"},
    )

    assert rejected.status_code == 409
    assert "请改为以“安全责任书”开头" in rejected.json()["detail"]
    with sqlite3.connect(settings.database_path) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM submissions WHERE node_instance_id = ?", (node_id,)
        ).fetchone()[0] == 0
        assert connection.execute(
            "SELECT COUNT(*) FROM audit_jobs WHERE node_instance_id = ?", (node_id,)
        ).fetchone()[0] == 0
        assert connection.execute(
            "SELECT submission_id FROM uploaded_files WHERE id = ?",
            (invalid_scan["fileId"],),
        ).fetchone()[0] is None

    deleted = test_client.delete(
        f"/api/student/node-instances/{node_id}/scans/{invalid_scan['fileId']}"
    )
    assert deleted.status_code == 200
    valid_scan = test_client.post(
        f"/api/student/node-instances/{node_id}/scans",
        files={"file": ("安全责任书第1页.png", ONE_PIXEL_PNG, "image/png")},
    )
    assert valid_scan.status_code == 200
    accepted = test_client.post(
        f"/api/student/node-instances/{node_id}/submit",
        json={"payload": {"confirmed": True}, "idempotencyKey": "valid-name"},
    )

    assert accepted.status_code == 200
    with sqlite3.connect(settings.database_path) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM submissions WHERE node_instance_id = ?", (node_id,)
        ).fetchone()[0] == 1
        assert connection.execute(
            "SELECT COUNT(*) FROM audit_jobs WHERE node_instance_id = ?", (node_id,)
        ).fetchone()[0] == 1
        assert connection.execute(
            "SELECT submission_id FROM uploaded_files WHERE id = ?",
            (valid_scan.json()["fileId"],),
        ).fetchone()[0] is not None
