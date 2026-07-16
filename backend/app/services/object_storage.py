from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any, BinaryIO
from urllib.parse import quote

from app.core.config import Settings, settings


class ObjectStorageError(RuntimeError):
    pass


class ObjectStorageNotConfigured(ObjectStorageError):
    pass


@dataclass(frozen=True)
class UploadedObject:
    etag: str


class ObjectStorage:
    def __init__(self, configuration: Settings):
        required = {
            "OSS_ENDPOINT": configuration.oss_endpoint,
            "OSS_BUCKET": configuration.oss_bucket,
            "OSS_ACCESS_KEY_ID": configuration.oss_access_key_id,
            "OSS_ACCESS_KEY_SECRET": configuration.oss_access_key_secret,
        }
        missing = [name for name, value in required.items() if not str(value).strip()]
        if missing:
            raise ObjectStorageNotConfigured(f"OSS 未配置：{', '.join(missing)}")

        try:
            import oss2

            auth = oss2.Auth(configuration.oss_access_key_id, configuration.oss_access_key_secret)
            bucket = oss2.Bucket(auth, configuration.oss_endpoint, configuration.oss_bucket)
        except ObjectStorageNotConfigured:
            raise
        except Exception as exc:
            raise ObjectStorageError("OSS 客户端初始化失败") from exc

        self._bucket = bucket
        self._prefix = _normalize_prefix(configuration.oss_prefix)
        self._expires = configuration.oss_signed_url_expires_seconds

    @classmethod
    def from_bucket(cls, bucket: Any, *, prefix: str, expires: int) -> "ObjectStorage":
        instance = cls.__new__(cls)
        instance._bucket = bucket
        instance._prefix = _normalize_prefix(prefix)
        instance._expires = expires
        return instance

    def put_object(self, key: str, fileobj: BinaryIO, content_type: str) -> UploadedObject:
        try:
            response = self._bucket.put_object(
                key,
                fileobj,
                headers={"Content-Type": content_type or "application/octet-stream"},
            )
        except Exception as exc:
            raise ObjectStorageError("OSS 上传失败") from exc
        _ensure_success(response, "上传")
        return UploadedObject(etag=str(getattr(response, "etag", "")).strip('"'))

    def delete_object(self, key: str) -> None:
        try:
            response = self._bucket.delete_object(key)
        except Exception as exc:
            raise ObjectStorageError("OSS 删除失败") from exc
        _ensure_success(response, "删除")

    def signed_download_url(self, key: str, filename: str) -> str:
        safe_name = quote(filename, safe="")
        try:
            return self._bucket.sign_url(
                "GET",
                key,
                self._expires,
                params={
                    "response-content-disposition": f"attachment; filename*=UTF-8''{safe_name}",
                },
            )
        except Exception as exc:
            raise ObjectStorageError("OSS 下载链接生成失败") from exc


def get_object_storage() -> ObjectStorage:
    return ObjectStorage(settings)


def object_key(prefix: str, *parts: str) -> str:
    normalized = [_safe_part(part) for part in parts]
    return str(PurePosixPath(_normalize_prefix(prefix), *normalized))


def _normalize_prefix(value: str) -> str:
    return "/".join(part for part in str(value).split("/") if part)


def _safe_part(value: str) -> str:
    return PurePosixPath(str(value).replace("\\", "/")).name or "unnamed"


def _ensure_success(response: Any, operation: str) -> None:
    status = int(getattr(response, "status", 200))
    if status >= 300:
        raise ObjectStorageError(f"OSS {operation}失败")
