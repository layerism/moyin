from fastapi.testclient import TestClient

from app.core.database import get_connection
from app.services.security import hash_password, utc_now_iso


def provision_teacher(
    *,
    employee_no: str,
    name: str = "管理教师",
    password: str = "Pass1234",
    role: str = "teacher",
) -> None:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO teacher_accounts
                (employee_no, name, password_hash, status, role, created_at, updated_at)
            VALUES (?, ?, ?, 'active', ?, ?, ?)
            """,
            (employee_no, name, hash_password(password), role, now, now),
        )


def login_teacher(
    client: TestClient,
    *,
    employee_no: str,
    name: str = "管理教师",
    password: str = "Pass1234",
) -> None:
    response = client.post(
        "/api/auth/teacher/login",
        json={"name": name, "employeeNo": employee_no, "password": password},
    )
    assert response.status_code == 200
