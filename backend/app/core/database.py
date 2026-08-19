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
    account_kind TEXT NOT NULL DEFAULT 'normal'
        CHECK (account_kind IN ('normal', 'preview')),
    preview_owner_teacher_id INTEGER REFERENCES teacher_accounts(id),
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

CREATE TABLE IF NOT EXISTS flow_template_assets (
    id TEXT PRIMARY KEY,
    flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    node_key TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    sha256 TEXT NOT NULL,
    etag TEXT NOT NULL,
    created_by INTEGER NOT NULL REFERENCES teacher_accounts(id),
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flow_template_assets_node
    ON flow_template_assets(flow_id, node_key);

CREATE TABLE IF NOT EXISTS flow_version_templates (
    flow_version_id TEXT NOT NULL REFERENCES flow_versions(id) ON DELETE CASCADE,
    node_key TEXT NOT NULL,
    template_asset_id TEXT NOT NULL REFERENCES flow_template_assets(id) ON DELETE RESTRICT,
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

CREATE TABLE IF NOT EXISTS flow_preview_sessions (
    id TEXT PRIMARY KEY,
    teacher_account_id INTEGER NOT NULL UNIQUE REFERENCES teacher_accounts(id),
    preview_student_account_id INTEGER NOT NULL REFERENCES student_accounts(id),
    flow_id TEXT NOT NULL REFERENCES flows(id),
    flow_version_id TEXT NOT NULL UNIQUE REFERENCES flow_versions(id),
    flow_instance_id TEXT NOT NULL UNIQUE REFERENCES flow_instances(id),
    token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('active', 'cleaning')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
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
    page_count INTEGER NOT NULL DEFAULT 1 CHECK(page_count > 0),
    display_order INTEGER NOT NULL DEFAULT 0 CHECK(display_order >= 0),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS template_download_events (
    node_instance_id TEXT NOT NULL REFERENCES node_instances(id) ON DELETE CASCADE,
    template_asset_id TEXT NOT NULL REFERENCES flow_template_assets(id) ON DELETE RESTRICT,
    student_account_id INTEGER NOT NULL REFERENCES student_accounts(id) ON DELETE CASCADE,
    downloaded_at TEXT NOT NULL,
    PRIMARY KEY(node_instance_id, template_asset_id)
);

CREATE INDEX IF NOT EXISTS idx_template_download_events_student
    ON template_download_events(student_account_id, node_instance_id);

CREATE INDEX IF NOT EXISTS idx_uploaded_files_node
    ON uploaded_files(node_instance_id, student_account_id);

CREATE INDEX IF NOT EXISTS idx_uploaded_files_submission
    ON uploaded_files(submission_id);

CREATE TABLE IF NOT EXISTS audit_jobs (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
    node_instance_id TEXT NOT NULL REFERENCES node_instances(id) ON DELETE CASCADE,
    flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    node_key TEXT NOT NULL,
    script_id TEXT NOT NULL,
    script_generation INTEGER NOT NULL CHECK (script_generation > 0),
    script_content_hash TEXT NOT NULL,
    policy_generation INTEGER NOT NULL CHECK (policy_generation > 0),
    policy_hash TEXT NOT NULL,
    effective_params_json TEXT NOT NULL,
    effective_settings_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    result_json TEXT,
    error_message TEXT,
    cancellation_reason TEXT,
    claimed_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_jobs_claim
    ON audit_jobs(status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_audit_jobs_node
    ON audit_jobs(node_instance_id);

CREATE INDEX IF NOT EXISTS idx_audit_jobs_script_status
    ON audit_jobs(script_id, status);

CREATE TABLE IF NOT EXISTS audit_script_runtime_states (
    script_id TEXT PRIMARY KEY,
    generation INTEGER NOT NULL CHECK (generation > 0),
    content_hash TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    max_concurrency INTEGER NOT NULL CHECK (max_concurrency BETWEEN 1 AND 32),
    status TEXT NOT NULL CHECK (status IN ('ready', 'updating', 'error')),
    error_message TEXT,
    updated_by INTEGER REFERENCES teacher_accounts(id),
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS node_audit_policies (
    flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    node_key TEXT NOT NULL,
    script_id TEXT NOT NULL,
    mode TEXT,
    prompt TEXT NOT NULL DEFAULT '',
    params_json TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK (generation > 0),
    policy_hash TEXT NOT NULL,
    updated_by INTEGER NOT NULL REFERENCES teacher_accounts(id),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(flow_id, node_key)
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
        _apply_scan_file_metadata_migration(connection)
        _apply_flow_preview_migration(connection)
        _apply_audit_hot_reload_migration(connection)


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


def _apply_scan_file_metadata_migration(connection: sqlite3.Connection) -> None:
    migration_id = "20260810_add_scan_file_metadata"
    columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(uploaded_files)").fetchall()
    }
    if "page_count" not in columns:
        connection.execute(
            "ALTER TABLE uploaded_files ADD COLUMN page_count INTEGER NOT NULL DEFAULT 1 CHECK(page_count > 0)"
        )
    if "display_order" not in columns:
        connection.execute(
            "ALTER TABLE uploaded_files ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0 CHECK(display_order >= 0)"
        )
    connection.execute(
        "INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)",
        (migration_id, datetime.now(UTC).isoformat()),
    )


def _apply_flow_preview_migration(connection: sqlite3.Connection) -> None:
    migration_id = "20260810_add_flow_preview_scope"
    columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(student_accounts)").fetchall()
    }
    if "account_kind" not in columns:
        connection.execute(
            """
            ALTER TABLE student_accounts
            ADD COLUMN account_kind TEXT NOT NULL DEFAULT 'normal'
            CHECK (account_kind IN ('normal', 'preview'))
            """
        )
    if "preview_owner_teacher_id" not in columns:
        connection.execute(
            """
            ALTER TABLE student_accounts
            ADD COLUMN preview_owner_teacher_id INTEGER REFERENCES teacher_accounts(id)
            """
        )
    connection.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_student_accounts_preview_owner
        ON student_accounts(preview_owner_teacher_id)
        WHERE preview_owner_teacher_id IS NOT NULL
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS flow_preview_sessions (
            id TEXT PRIMARY KEY,
            teacher_account_id INTEGER NOT NULL UNIQUE REFERENCES teacher_accounts(id),
            preview_student_account_id INTEGER NOT NULL REFERENCES student_accounts(id),
            flow_id TEXT NOT NULL REFERENCES flows(id),
            flow_version_id TEXT NOT NULL UNIQUE REFERENCES flow_versions(id),
            flow_instance_id TEXT NOT NULL UNIQUE REFERENCES flow_instances(id),
            token_hash TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL CHECK (status IN ('active', 'cleaning')),
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    connection.execute(
        "INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)",
        (migration_id, datetime.now(UTC).isoformat()),
    )


def _apply_audit_hot_reload_migration(connection: sqlite3.Connection) -> None:
    migration_id = "20260819_audit_script_hot_reload"
    columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(audit_jobs)").fetchall()
    }
    if columns and "script_generation" not in columns:
        connection.execute("ALTER TABLE audit_jobs RENAME TO audit_jobs_legacy")
        connection.executescript(
            """
            CREATE TABLE audit_jobs (
                id TEXT PRIMARY KEY,
                submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
                node_instance_id TEXT NOT NULL REFERENCES node_instances(id) ON DELETE CASCADE,
                flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
                node_key TEXT NOT NULL,
                script_id TEXT NOT NULL,
                script_generation INTEGER NOT NULL CHECK (script_generation > 0),
                script_content_hash TEXT NOT NULL,
                policy_generation INTEGER NOT NULL CHECK (policy_generation > 0),
                policy_hash TEXT NOT NULL,
                effective_params_json TEXT NOT NULL,
                effective_settings_json TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
                attempt_count INTEGER NOT NULL DEFAULT 0,
                next_attempt_at TEXT NOT NULL,
                result_json TEXT,
                error_message TEXT,
                cancellation_reason TEXT,
                claimed_at TEXT,
                finished_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            INSERT INTO audit_jobs
                (id, submission_id, node_instance_id, flow_id, node_key, script_id,
                 script_generation, script_content_hash, policy_generation, policy_hash,
                 effective_params_json, effective_settings_json, status, attempt_count,
                 next_attempt_at, result_json, error_message, cancellation_reason,
                 claimed_at, finished_at, created_at, updated_at)
            SELECT j.id, j.submission_id, j.node_instance_id, v.flow_id, n.node_key,
                   j.script_id, 1, j.script_sha256, 1, '', '{}', '{}',
                   CASE WHEN j.status IN ('pending', 'running') THEN 'cancelled' ELSE j.status END,
                   j.attempt_count, j.next_attempt_at, j.result_json, j.error_message,
                   CASE WHEN j.status IN ('pending', 'running') THEN 'script_updated' END,
                   j.claimed_at,
                   CASE WHEN j.status IN ('pending', 'running') THEN j.updated_at ELSE j.finished_at END,
                   j.created_at, j.updated_at
            FROM audit_jobs_legacy j
            JOIN node_instances n ON n.id = j.node_instance_id
            JOIN flow_instances i ON i.id = n.flow_instance_id
            JOIN flow_versions v ON v.id = i.flow_version_id;
            DROP TABLE audit_jobs_legacy;
            CREATE INDEX idx_audit_jobs_claim ON audit_jobs(status, next_attempt_at, created_at);
            CREATE INDEX idx_audit_jobs_node ON audit_jobs(node_instance_id);
            CREATE INDEX idx_audit_jobs_script_status ON audit_jobs(script_id, status);
            CREATE INDEX idx_audit_jobs_policy_status ON audit_jobs(flow_id, node_key, status);
            """
        )
        connection.execute(
            """
            UPDATE submissions SET status = 'cancelled'
            WHERE id IN (SELECT submission_id FROM audit_jobs WHERE status = 'cancelled')
            """
        )
        connection.execute(
            """
            UPDATE node_instances SET status = 'available', approved_at = NULL
            WHERE status = 'reviewing'
              AND id IN (SELECT node_instance_id FROM audit_jobs WHERE status = 'cancelled')
            """
        )
    connection.execute("DROP TABLE IF EXISTS audit_script_versions")
    connection.execute("DROP TABLE IF EXISTS audit_scripts")
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_audit_jobs_script_status ON audit_jobs(script_id, status)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_audit_jobs_policy_status ON audit_jobs(flow_id, node_key, status)"
    )
    connection.execute(
        "INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)",
        (migration_id, datetime.now(UTC).isoformat()),
    )
