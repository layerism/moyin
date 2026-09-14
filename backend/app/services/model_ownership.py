"""Migration to publisher-owned model cards and script bindings."""
from datetime import UTC, datetime

from app.core.database import get_connection


def initialize_model_ownership() -> None:
    migration_id = "20260914_publisher_model_ownership"
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        if connection.execute("SELECT 1 FROM schema_migrations WHERE id = ?", (migration_id,)).fetchone():
            return
        admins = connection.execute("SELECT id FROM teacher_accounts WHERE role = 'super_admin' ORDER BY id").fetchall()
        if not admins and connection.execute("SELECT 1 FROM audit_model_cards LIMIT 1").fetchone():
            raise RuntimeError("迁移模型卡前请先配置超级管理员")
        owner_id = admins[0]["id"] if admins else None
        connection.execute("ALTER TABLE audit_model_cards ADD COLUMN owner_teacher_id INTEGER REFERENCES teacher_accounts(id)")
        connection.execute("UPDATE audit_model_cards SET owner_teacher_id = ?", (owner_id,))
        connection.execute("CREATE UNIQUE INDEX audit_model_cards_owner_id ON audit_model_cards(owner_teacher_id, id)")
        connection.execute("""
            CREATE TABLE audit_model_bindings_owned (
                owner_teacher_id INTEGER NOT NULL REFERENCES teacher_accounts(id),
                script_id TEXT NOT NULL,
                card_id TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY(owner_teacher_id, script_id),
                FOREIGN KEY(owner_teacher_id, card_id)
                    REFERENCES audit_model_cards(owner_teacher_id, id) ON DELETE RESTRICT
            )
        """)
        connection.execute("""INSERT INTO audit_model_bindings_owned (owner_teacher_id, script_id, card_id, revision)
                              SELECT ?, script_id, card_id, revision FROM audit_model_bindings""", (owner_id,))
        connection.execute("DROP TABLE audit_model_bindings")
        connection.execute("ALTER TABLE audit_model_bindings_owned RENAME TO audit_model_bindings")
        connection.execute("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
                           (migration_id, datetime.now(UTC).isoformat()))
