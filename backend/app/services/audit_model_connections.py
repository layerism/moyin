"""Server-owned model connections, independent of published script snapshots."""
from datetime import UTC, datetime

from cryptography.fernet import Fernet

from app.core.config import settings
from app.core.database import get_connection

ENV_NAMES = {
    "document": ("DEEPSEEK_API_URL", "DEEPSEEK_API_KEY", "DEEPSEEK_MODEL"),
    "vision": ("VISION_API_BASE_URL", "VISION_API_KEY", None),
}
SCRIPT_PROVIDERS = {
    "docx-markdown-completion-audit": "document",
    "confirmation-visual-audit": "vision",
}


def _cipher() -> Fernet:
    if not settings.audit_config_encryption_key:
        raise RuntimeError("请在服务器配置 AUDIT_CONFIG_ENCRYPTION_KEY")
    try:
        return Fernet(settings.audit_config_encryption_key.encode())
    except ValueError as exc:
        raise RuntimeError("服务器加密主密钥格式无效") from exc


def initialize_model_connections() -> None:
    legacy = {
        "document": (settings.deepseek_api_url, settings.deepseek_api_key, settings.deepseek_model),
        "vision": (settings.vision_api_base_url, settings.vision_api_key, ""),
    }
    with get_connection() as connection:
        for provider, (url, key, model) in legacy.items():
            if connection.execute("SELECT 1 FROM audit_model_connections WHERE provider = ?", (provider,)).fetchone():
                continue
            encrypted = _cipher().encrypt(key.encode()).decode() if key else ""
            connection.execute(
                "INSERT INTO audit_model_connections (provider, api_url, encrypted_api_key, model) VALUES (?, ?, ?, ?)",
                (provider, url, encrypted, model),
            )


def list_model_connections() -> list[dict[str, object]]:
    with get_connection() as connection:
        rows = connection.execute("SELECT * FROM audit_model_connections ORDER BY provider").fetchall()
    return [{"provider": row["provider"], "apiUrl": row["api_url"],
             "hasApiKey": bool(row["encrypted_api_key"]), "model": row["model"],
             "revision": row["revision"]} for row in rows]


def update_model_connection(provider: str, api_url: str, api_key: str | None, model: str, revision: int) -> dict[str, object]:
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT * FROM audit_model_connections WHERE provider = ?", (provider,)).fetchone()
        if row is None or row["revision"] != revision:
            raise ValueError("配置已被其他管理员修改，请重新读取")
        encrypted = _cipher().encrypt(api_key.encode()).decode() if api_key else row["encrypted_api_key"]
        if not encrypted:
            raise ValueError("请填写 API Key")
        connection.execute(
            "UPDATE audit_model_connections SET api_url = ?, encrypted_api_key = ?, model = ?, revision = revision + 1, updated_at = ? WHERE provider = ?",
            (api_url, encrypted, model, datetime.now(UTC).isoformat(), provider),
        )
    return {"provider": provider, "apiUrl": api_url, "hasApiKey": True,
            "model": model, "revision": revision + 1}


def model_environment(script_id: str) -> dict[str, str]:
    provider = SCRIPT_PROVIDERS.get(script_id)
    if provider is None:
        return {}
    with get_connection() as connection:
        row = connection.execute("SELECT * FROM audit_model_connections WHERE provider = ?", (provider,)).fetchone()
    if row is None:
        raise RuntimeError("审核模型连接未初始化")
    url_name, key_name, model_name = ENV_NAMES[provider]
    key = _cipher().decrypt(row["encrypted_api_key"].encode()).decode() if row["encrypted_api_key"] else ""
    result = {url_name: row["api_url"], key_name: key}
    if model_name:
        result[model_name] = row["model"]
    return result
