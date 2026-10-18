from app.core.database import get_connection


def get_presence_roster(version_id: str, teacher_id: int) -> list[dict]:
    with get_connection() as connection:
        version = connection.execute(
            """SELECT v.flow_id FROM flow_versions v JOIN flows f ON f.id = v.flow_id
               WHERE v.id = ? AND f.owner_id = ? AND v.status = 'published'""",
            (version_id, str(teacher_id)),
        ).fetchone()
        if version is None:
            raise KeyError(version_id)
        rows = connection.execute(
            """SELECT r.id AS roster_id, a.id AS student_id
               FROM flow_roster_entries r LEFT JOIN student_accounts a
               ON a.student_no = r.student_no AND a.name = r.name
                  AND a.account_kind = 'normal' AND a.status = 'active'
               WHERE r.flow_id = ? AND r.status = 'active'""",
            (version['flow_id'],),
        ).fetchall()
        return [dict(row) for row in rows]
