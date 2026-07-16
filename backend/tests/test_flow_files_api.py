import sqlite3
from collections.abc import Iterator
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app.core.config import settings
from app.main import app
from app.api.routes import student_flows


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
    with TestClient(app) as test_client:
        registered = test_client.post(
            "/api/auth/teacher/register",
            json={"name": "测试教师", "employeeNo": "TR001", "password": "Pass1234"},
        )
        assert registered.status_code == 201
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
