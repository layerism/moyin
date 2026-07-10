import sqlite3
from pathlib import Path

from app.core.config import settings


SCHEMA = """
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
    status TEXT NOT NULL DEFAULT 'active',
    expires_at TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
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
