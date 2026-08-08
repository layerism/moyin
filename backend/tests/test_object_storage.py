import io
from pathlib import Path

import pytest

from app.core.config import settings
from app.services.object_storage import ObjectStorage, ObjectStorageError, ObjectStorageNotConfigured


class FakeResponse:
    status = 200
    etag = '"etag-1"'


class FakeBucket:
    bucket_name = "test-bucket"

    def __init__(self):
        self.put_calls = []
        self.copy_calls = []

    def put_object(self, key, fileobj, headers=None):
        self.put_calls.append((key, fileobj.read(), headers))
        return FakeResponse()

    def delete_object(self, key):
        return FakeResponse()

    def copy_object(self, source_bucket_name, source_key, target_key):
        self.copy_calls.append((source_bucket_name, source_key, target_key))
        return FakeResponse()

    def sign_url(self, method, key, expires, params=None):
        return f"https://signed/{key}"

    def get_object_to_file(self, key, destination):
        Path(destination).write_bytes(b"downloaded")
        return FakeResponse()


def test_missing_oss_configuration_is_explicit(monkeypatch):
    monkeypatch.setattr(settings, "oss_endpoint", "")
    with pytest.raises(ObjectStorageNotConfigured):
        ObjectStorage(settings)


def test_put_and_sign_delegate_to_bucket():
    bucket = FakeBucket()
    storage = ObjectStorage.from_bucket(bucket, prefix="coze/files", expires=600)

    result = storage.put_object("coze/files/a.txt", io.BytesIO(b"abc"), "text/plain")

    assert result.etag == "etag-1"
    assert bucket.put_calls[0][0] == "coze/files/a.txt"
    assert bucket.put_calls[0][2] == {"Content-Type": "text/plain"}
    assert storage.signed_download_url("coze/files/a.txt", "a.txt").startswith("https://signed/")


def test_download_to_file_delegates_to_bucket(tmp_path: Path):
    storage = ObjectStorage.from_bucket(FakeBucket(), prefix="coze/files", expires=600)
    destination = tmp_path / "downloaded.bin"

    storage.download_to_file("coze/files/a.bin", destination)

    assert destination.read_bytes() == b"downloaded"


def test_copy_object_delegates_to_same_bucket():
    bucket = FakeBucket()
    storage = ObjectStorage.from_bucket(bucket, prefix="coze/files", expires=600)

    result = storage.copy_object("coze/files/source.bin", "coze/files/target.bin")

    assert result.etag == "etag-1"
    assert bucket.copy_calls == [
        ("test-bucket", "coze/files/source.bin", "coze/files/target.bin")
    ]


def test_copy_object_wraps_sdk_errors():
    bucket = FakeBucket()
    bucket.copy_object = lambda *_args: (_ for _ in ()).throw(RuntimeError("broken"))
    storage = ObjectStorage.from_bucket(bucket, prefix="coze/files", expires=600)

    with pytest.raises(ObjectStorageError, match="OSS 复制失败"):
        storage.copy_object("source", "target")
