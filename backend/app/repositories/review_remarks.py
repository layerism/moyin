from app.core.database import get_connection

DEFAULT_REMARKS = (
    "材料齐全，符合要求。",
    "请按模板补全后重新提交。",
    "请核对签名与日期后重新提交。",
)


def list_review_remarks(teacher_id: int):
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        for index, text in enumerate(DEFAULT_REMARKS):
            connection.execute(
                "INSERT OR IGNORE INTO teacher_review_remarks (teacher_id, default_index, content) VALUES (?, ?, ?)",
                (teacher_id, index, text),
            )
        return [dict(row) for row in connection.execute(
            "SELECT id, content FROM teacher_review_remarks WHERE teacher_id = ? ORDER BY id", (teacher_id,)
        )]


def save_review_remark(teacher_id: int, content: str, remark_id: int | None = None):
    with get_connection() as connection:
        if remark_id is None:
            remark_id = connection.execute(
                "INSERT INTO teacher_review_remarks (teacher_id, content) VALUES (?, ?)", (teacher_id, content)
            ).lastrowid
        else:
            changed = connection.execute(
                "UPDATE teacher_review_remarks SET content = ? WHERE id = ? AND teacher_id = ?",
                (content, remark_id, teacher_id),
            )
            if changed.rowcount != 1:
                raise KeyError(remark_id)
    return {"id": remark_id, "content": content}
