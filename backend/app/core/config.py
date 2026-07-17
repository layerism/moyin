from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Document Autofill API"
    app_env: str = "development"
    storage_root: str = "storage"
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost"]
    database_path: str = "storage/app.db"
    oss_endpoint: str = ""
    oss_bucket: str = ""
    oss_prefix: str = "coze/files"
    oss_access_key_id: str = ""
    oss_access_key_secret: str = ""
    oss_signed_url_expires_seconds: int = 600
    audit_scripts_root: str = str(Path(__file__).resolve().parents[2] / "scripts")
    audit_script_max_bytes: int = 1_048_576
    audit_node_executable: str = "node"
    audit_node_modules_path: str = str(
        Path(__file__).resolve().parents[2] / "runtime" / "javascript" / "node_modules"
    )
    audit_script_timeout_seconds: int = 60
    audit_script_stdout_max_bytes: int = 1_048_576
    audit_script_stderr_max_bytes: int = 262_144
    audit_temp_root: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
