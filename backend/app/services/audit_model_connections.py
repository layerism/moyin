"""Model cards and script bindings; credentials never enter published snapshots."""
import json
import uuid
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

from cryptography.fernet import Fernet

from app.core.config import settings
from app.core.database import get_connection

ENV_NAMES = {
    "document": ("DEEPSEEK_API_URL", "DEEPSEEK_API_KEY", "DEEPSEEK_MODEL"),
    "vision": ("VISION_API_BASE_URL", "VISION_API_KEY", "VISION_MODEL"),
}
SCRIPT_PROVIDERS = {
    "docx-markdown-completion-audit": "document",
    "confirmation-visual-audit": "vision",
}
SCRIPT_NAMES = {
    "docx-markdown-completion-audit": "DOCX 完成性审核",
    "confirmation-visual-audit": "确认承诺视觉审核",
}


class ModelConfigConflict(ValueError):
    pass


def _cipher() -> Fernet:
    if not settings.audit_config_encryption_key:
        raise RuntimeError("请在服务器配置 AUDIT_CONFIG_ENCRYPTION_KEY")
    try:
        return Fernet(settings.audit_config_encryption_key.encode())
    except ValueError as exc:
        raise RuntimeError("服务器加密主密钥格式无效") from exc


def _vendor(api_url: str) -> str:
    host = urlsplit(api_url).hostname or ""
    for domain, vendor in [("openai.com", "openai"), ("deepseek.com", "deepseek"),
                           ("aliyuncs.com", "qwen"), ("volces.com", "doubao"),
                           ("bigmodel.cn", "zhipu"), ("moonshot.cn", "moonshot"),
                           ("moonshot.ai", "moonshot")]:
        if host == domain or host.endswith("." + domain):
            return vendor
    return "custom"


def initialize_model_connections() -> None:
    migration_id = "20260908_audit_model_cards"
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        if connection.execute("SELECT 1 FROM schema_migrations WHERE id = ?", (migration_id,)).fetchone():
            return
        old_table = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'audit_model_connections'"
        ).fetchone()
        legacy = {row["provider"]: dict(row) for row in connection.execute(
            "SELECT * FROM audit_model_connections"
        ).fetchall()} if old_table else {}
        config_path = Path(settings.audit_scripts_root) / "confirmation-visual-audit" / "config.json"
        visual_model = ""
        if config_path.exists():
            config = json.loads(config_path.read_text(encoding="utf-8"))
            visual_model = next((item["value"] for item in config.get("runtimeSettings", [])
                                 if item["key"] == "modelName"), "")
        defaults = {
            "document": (settings.deepseek_api_url, settings.deepseek_api_key, settings.deepseek_model),
            "vision": (settings.vision_api_base_url, settings.vision_api_key, visual_model),
        }
        for script_id, kind in SCRIPT_PROVIDERS.items():
            url, key, model = defaults[kind]
            old = legacy.get(kind)
            encrypted = old["encrypted_api_key"] if old else (_cipher().encrypt(key.encode()).decode() if key else "")
            if old:
                url = old["api_url"]
                model = old["model"] or model
            card_id = uuid.uuid4().hex
            connection.execute(
                "INSERT INTO audit_model_cards (id, vendor, name, api_url, encrypted_api_key, model) VALUES (?, ?, ?, ?, ?, ?)",
                (card_id, _vendor(url), "文档审核模型" if kind == "document" else "视觉审核模型", url, encrypted, model),
            )
            connection.execute(
                "INSERT INTO audit_model_bindings (script_id, card_id) VALUES (?, ?)", (script_id, card_id)
            )
        if old_table:
            connection.execute("DROP TABLE audit_model_connections")
        connection.execute("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
                           (migration_id, datetime.now(UTC).isoformat()))


def list_model_connections() -> dict[str, object]:
    with get_connection() as connection:
        connection.execute("BEGIN")
        cards = connection.execute("SELECT * FROM audit_model_cards ORDER BY name, id").fetchall()
        bindings = connection.execute("SELECT * FROM audit_model_bindings ORDER BY script_id").fetchall()
    return {
        "cards": [{"id": row["id"], "vendor": row["vendor"], "name": row["name"],
                   "apiUrl": row["api_url"], "hasApiKey": bool(row["encrypted_api_key"]),
                   "model": row["model"], "revision": row["revision"]} for row in cards],
        "bindings": [{"scriptId": row["script_id"], "name": SCRIPT_NAMES[row["script_id"]],
                      "cardId": row["card_id"], "revision": row["revision"]} for row in bindings],
    }


def save_model_card(card_id: str | None, *, vendor: str, name: str, api_url: str,
                    api_key: str | None, model: str, revision: int) -> None:
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        encrypted = ""
        if card_id is not None:
            row = connection.execute("SELECT * FROM audit_model_cards WHERE id = ?", (card_id,)).fetchone()
            if row is None or row["revision"] != revision:
                raise ModelConfigConflict("模型卡已被修改或删除，请重新读取")
            encrypted = row["encrypted_api_key"]
        if api_key:
            encrypted = _cipher().encrypt(api_key.encode()).decode()
        if not encrypted:
            raise ValueError("请填写 API Key")
        now = datetime.now(UTC).isoformat()
        if card_id is None:
            connection.execute(
                "INSERT INTO audit_model_cards (id, vendor, name, api_url, encrypted_api_key, model, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (uuid.uuid4().hex, vendor, name, api_url, encrypted, model, now),
            )
        else:
            connection.execute(
                "UPDATE audit_model_cards SET vendor = ?, name = ?, api_url = ?, encrypted_api_key = ?, model = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
                (vendor, name, api_url, encrypted, model, now, card_id),
            )


def delete_model_card(card_id: str, revision: int) -> None:
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT revision FROM audit_model_cards WHERE id = ?", (card_id,)).fetchone()
        if row is None or row["revision"] != revision:
            raise ModelConfigConflict("模型卡已被修改或删除，请重新读取")
        if connection.execute("SELECT 1 FROM audit_model_bindings WHERE card_id = ?", (card_id,)).fetchone():
            raise ModelConfigConflict("模型卡正在被审核脚本使用，请先更换脚本的模型")
        connection.execute("DELETE FROM audit_model_cards WHERE id = ?", (card_id,))


def bind_model_card(script_id: str, card_id: str, revision: int) -> None:
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        card = connection.execute("SELECT * FROM audit_model_cards WHERE id = ?", (card_id,)).fetchone()
        if card is None or not card["api_url"] or not card["encrypted_api_key"] or not card["model"]:
            raise ValueError("请选择已完整配置的模型卡")
        result = connection.execute(
            "UPDATE audit_model_bindings SET card_id = ?, revision = revision + 1 WHERE script_id = ? AND revision = ?",
            (card_id, script_id, revision),
        )
        if result.rowcount != 1:
            raise ModelConfigConflict("脚本模型已被其他管理员修改，请重新读取")


def model_environment(script_id: str) -> dict[str, str]:
    kind = SCRIPT_PROVIDERS.get(script_id)
    if kind is None:
        return {}
    with get_connection() as connection:
        row = connection.execute(
            "SELECT c.* FROM audit_model_cards c JOIN audit_model_bindings b ON b.card_id = c.id WHERE b.script_id = ?",
            (script_id,),
        ).fetchone()
    if row is None:
        raise RuntimeError("审核模型未配置")
    url_name, key_name, model_name = ENV_NAMES[kind]
    key = _cipher().decrypt(row["encrypted_api_key"].encode()).decode() if row["encrypted_api_key"] else ""
    return {url_name: row["api_url"], key_name: key, model_name: row["model"]}
