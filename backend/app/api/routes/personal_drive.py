from pathlib import PurePosixPath
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.core.config import settings
from app.core.database import get_connection
from app.repositories.personal_drive import get_file, serialize_file
from app.services.object_storage import ObjectStorageError, get_object_storage, object_key
from app.services.security import get_current_teacher, utc_now_iso

router = APIRouter()
MAX_FILE_BYTES = 100 * 1024 * 1024


@router.post("/personal-files", status_code=201)
def upload_personal_file(
    file: UploadFile = File(...),
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    filename = PurePosixPath((file.filename or "").replace("\\", "/")).name
    if not filename:
        raise HTTPException(422, detail="请选择文件")
    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    if size > MAX_FILE_BYTES:
        raise HTTPException(413, detail="单个文件不能超过 100 MB")
    owner_id = int(teacher["id"])
    file_id = str(uuid4())
    key = object_key(settings.oss_prefix, "personal", str(owner_id), file_id, filename)
    content_type = file.content_type or "application/octet-stream"
    try:
        storage = get_object_storage()
        storage.put_object(key, file.file, content_type)
    except ObjectStorageError as exc:
        raise HTTPException(503, detail="文件存储暂不可用，上传失败") from exc
    try:
        with get_connection() as db:
            db.execute(
                """INSERT INTO personal_drive_files
                (id, owner_teacher_id, original_name, content_type, size_bytes, storage_key, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (file_id, owner_id, filename, content_type, size, key, utc_now_iso()),
            )
            result = serialize_file(get_file(db, file_id, owner_id))
    except Exception:
        storage.delete_object(key)
        raise
    return result


@router.get("/personal-files/{file_id}/download")
def download_personal_file(
    file_id: str, teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        with get_connection() as db:
            row = get_file(db, file_id, int(teacher["id"]))
        return {**serialize_file(row), "url": get_object_storage().signed_download_url(
            row["storage_key"], row["original_name"],
        )}
    except KeyError as exc:
        raise HTTPException(404, detail="个人文件不存在") from exc
    except ObjectStorageError as exc:
        raise HTTPException(503, detail="文件下载链接生成失败") from exc


@router.delete("/personal-files/{file_id}")
def delete_personal_file(
    file_id: str, teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, bool]:
    try:
        with get_connection() as db:
            # Serialize against account deletion and concurrent file deletion.
            db.execute("BEGIN IMMEDIATE")
            row = get_file(db, file_id, int(teacher["id"]))
            get_object_storage().delete_object(row["storage_key"])
            db.execute("DELETE FROM personal_drive_files WHERE id = ?", (file_id,))
    except KeyError as exc:
        raise HTTPException(404, detail="个人文件不存在") from exc
    except ObjectStorageError as exc:
        raise HTTPException(503, detail="文件删除失败，请重试") from exc
    return {"deleted": True}
