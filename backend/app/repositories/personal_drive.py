"""Personal uploads are independent of immutable workflow submissions."""
import sqlite3

from app.core.database import get_connection


def serialize_file(row: sqlite3.Row) -> dict[str, object]:
    return {
        "fileId": row["id"], "originalName": row["original_name"],
        "contentType": row["content_type"], "sizeBytes": row["size_bytes"],
        "createdAt": row["created_at"],
    }


def list_files(owner_id: int) -> list[dict[str, object]]:
    with get_connection() as db:
        return [serialize_file(row) for row in db.execute(
            "SELECT * FROM personal_drive_files WHERE owner_teacher_id = ? ORDER BY created_at DESC, id",
            (owner_id,),
        )]


def get_file(db: sqlite3.Connection, file_id: str, owner_id: int) -> sqlite3.Row:
    row = db.execute(
        "SELECT * FROM personal_drive_files WHERE id = ? AND owner_teacher_id = ?",
        (file_id, owner_id),
    ).fetchone()
    if row is None:
        raise KeyError(file_id)
    return row
