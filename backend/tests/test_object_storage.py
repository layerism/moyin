import io

import pytest

from app.core.config import settings
from app.services.object_storage import ObjectStorage, ObjectStorageNotConfigured


class FakeResponse:
    status = 200
    etag = '"etag-1"'


class FakeBucket:
    def __init__(self):
        self.put_calls = []

    def put_object(self, key, fileobj, headers=None):
        self.put_calls.append((key, fileobj.read(), headers))
        return FakeResponse()

    def delete_object(self, key):
        return FakeResponse()

    def sign_url(self, method, key, expires, params=None):
        return f"https://signed/{key}"


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
    assert storage.signed_download_url("coze/files/a.txt", "a.txt").startswith(
        "https://signed/"
    )
