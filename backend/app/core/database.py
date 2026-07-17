import sqlite3
import hashlib
import secrets
from datetime import UTC, datetime
from pathlib import Path

from app.core.config import settings


SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS student_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_no TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS student_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_account_id INTEGER NOT NULL REFERENCES student_accounts(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teacher_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_no TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    role TEXT NOT NULL DEFAULT 'teacher' CHECK (role IN ('teacher', 'super_admin')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teacher_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_account_id INTEGER NOT NULL REFERENCES teacher_accounts(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    before_data TEXT,
    after_data TEXT,
    reason TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    owner_id TEXT NOT NULL DEFAULT 'teacher-local',
    status TEXT NOT NULL DEFAULT 'draft',
    draft_config TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flow_roster_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    student_no TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    UNIQUE(flow_id, student_no)
);

CREATE TABLE IF NOT EXISTS flow_versions (
    id TEXT PRIMARY KEY,
    flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    version_no INTEGER NOT NULL,
    config_snapshot TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'published',
    published_by TEXT NOT NULL,
    published_at TEXT NOT NULL,
    UNIQUE(flow_id, version_no)
);

CREATE TABLE IF NOT EXISTS flow_node_runtime_configs (
    flow_version_id TEXT NOT NULL REFERENCES flow_versions(id) ON DELETE CASCADE,
    node_key TEXT NOT NULL,
    deadline_at TEXT,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(flow_version_id, node_key)
);

CREATE TABLE IF NOT EXISTS share_tokens (
    id TEXT PRIMARY KEY,
    flow_version_id TEXT NOT NULL REFERENCES flow_versions(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    token_value TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    expires_at TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flow_instances (
    id TEXT PRIMARY KEY,
    flow_version_id TEXT NOT NULL REFERENCES flow_versions(id),
    student_account_id INTEGER NOT NULL REFERENCES student_accounts(id),
    status TEXT NOT NULL DEFAULT 'in_progress',
    started_at TEXT NOT NULL,
    completed_at TEXT,
    last_active_at TEXT NOT NULL,
    UNIQUE(flow_version_id, student_account_id)
);

CREATE TABLE IF NOT EXISTS node_instances (
    id TEXT PRIMARY KEY,
    flow_instance_id TEXT NOT NULL REFERENCES flow_instances(id) ON DELETE CASCADE,
    node_key TEXT NOT NULL,
    status TEXT NOT NULL,
    opened_at TEXT,
    submitted_at TEXT,
    approved_at TEXT,
    attempt_no INTEGER NOT NULL DEFAULT 0,
    UNIQUE(flow_instance_id, node_key)
);

CREATE TABLE IF NOT EXISTS node_drafts (
    node_instance_id TEXT PRIMARY KEY REFERENCES node_instances(id) ON DELETE CASCADE,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    node_instance_id TEXT NOT NULL REFERENCES node_instances(id) ON DELETE CASCADE,
    attempt_no INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_snapshot TEXT NOT NULL,
    status TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    UNIQUE(node_instance_id, attempt_no),
    UNIQUE(node_instance_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS uploaded_files (
    id TEXT PRIMARY KEY,
    node_instance_id TEXT NOT NULL REFERENCES node_instances(id) ON DELETE CASCADE,
    student_account_id INTEGER NOT NULL REFERENCES student_accounts(id) ON DELETE CASCADE,
    submission_id TEXT REFERENCES submissions(id) ON DELETE SET NULL,
    storage_key TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    sha256 TEXT NOT NULL,
    etag TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_uploaded_files_node
    ON uploaded_files(node_instance_id, student_account_id);

CREATE INDEX IF NOT EXISTS idx_uploaded_files_submission
    ON uploaded_files(submission_id);

CREATE TABLE IF NOT EXISTS audit_scripts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL CHECK (language IN ('py', 'js')),
    current_version INTEGER NOT NULL,
    created_by INTEGER NOT NULL REFERENCES teacher_accounts(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_script_versions (
    script_id TEXT NOT NULL REFERENCES audit_scripts(id) ON DELETE CASCADE,
    version_no INTEGER NOT NULL,
    entry_filename TEXT NOT NULL,
    directory_path TEXT NOT NULL UNIQUE,
    sha256 TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    created_by INTEGER NOT NULL REFERENCES teacher_accounts(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY (script_id, version_no)
);

CREATE TABLE IF NOT EXISTS student_deadline_overrides (
    flow_instance_id TEXT NOT NULL REFERENCES flow_instances(id) ON DELETE CASCADE,
    node_key TEXT NOT NULL,
    deadline_at TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(flow_instance_id, node_key)
);
"""


def get_connection() -> sqlite3.Connection:
    database_path = Path(settings.database_path)
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


def initialize_database() -> None:
    with get_connection() as connection:
        connection.executescript(SCHEMA)
        _apply_super_admin_role_migration(connection)
        _apply_flow_owner_migration(connection)
        _apply_share_token_value_migration(connection)
        _apply_audit_script_metadata_migration(connection)


def _apply_super_admin_role_migration(connection: sqlite3.Connection) -> None:
    migration_id = "20260714_add_teacher_role_and_promote_04170"
    columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(teacher_accounts)").fetchall()
    }
    if "role" not in columns:
        connection.execute(
            "ALTER TABLE teacher_accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'teacher'"
        )

    applied = connection.execute(
        "SELECT 1 FROM schema_migrations WHERE id = ?", (migration_id,)
    ).fetchone()
    if applied is not None:
        return

    connection.execute(
        "UPDATE teacher_accounts SET role = 'super_admin' WHERE employee_no = '04170'"
    )
    connection.execute(
        "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
        (migration_id, datetime.now(UTC).isoformat()),
    )


def _apply_flow_owner_migration(connection: sqlite3.Connection) -> None:
    migration_id = "20260714_assign_legacy_flows_to_super_admin"
    applied = connection.execute(
        "SELECT 1 FROM schema_migrations WHERE id = ?", (migration_id,)
    ).fetchone()
    if applied is not None:
        return

    connection.execute(
        """
        UPDATE flows
        SET owner_id = CAST(
            (SELECT id FROM teacher_accounts WHERE employee_no = '04170') AS TEXT
        )
        WHERE owner_id = 'teacher-local'
          AND EXISTS (
              SELECT 1 FROM teacher_accounts WHERE employee_no = '04170'
          )
        """
    )
    connection.execute(
        "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
        (migration_id, datetime.now(UTC).isoformat()),
    )


def _apply_share_token_value_migration(connection: sqlite3.Connection) -> None:
    migration_id = "20260714_add_recoverable_share_tokens"
    columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(share_tokens)").fetchall()
    }
    if "token_value" not in columns:
        connection.execute("ALTER TABLE share_tokens ADD COLUMN token_value TEXT")

    applied = connection.execute(
        "SELECT 1 FROM schema_migrations WHERE id = ?", (migration_id,)
    ).fetchone()
    if applied is not None:
        return

    legacy_rows = connection.execute(
        "SELECT id FROM share_tokens WHERE status = 'active' AND token_value IS NULL"
    ).fetchall()
    for row in legacy_rows:
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        connection.execute(
            "UPDATE share_tokens SET token_hash = ?, token_value = ? WHERE id = ?",
            (token_hash, token, row["id"]),
        )
    connection.execute(
        "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
        (migration_id, datetime.now(UTC).isoformat()),
    )


def _apply_audit_script_metadata_migration(connection: sqlite3.Connection) -> None:
    migration_id = "20260717_add_audit_script_metadata"
    columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(audit_scripts)").fetchall()
    }
    if "description" not in columns:
        connection.execute(
            "ALTER TABLE audit_scripts ADD COLUMN description TEXT NOT NULL DEFAULT ''"
        )
    if "updated_at" not in columns:
        connection.execute("ALTER TABLE audit_scripts ADD COLUMN updated_at TEXT")
    connection.execute("UPDATE audit_scripts SET updated_at = created_at WHERE updated_at IS NULL")

    applied = connection.execute(
        "SELECT 1 FROM schema_migrations WHERE id = ?", (migration_id,)
    ).fetchone()
    if applied is None:
        connection.execute(
            "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
            (migration_id, datetime.now(UTC).isoformat()),
        )
