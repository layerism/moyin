"""Publisher model cards; credentials never enter published snapshots."""
import json
import uuid
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

from cryptography.fernet import Fernet

from app.core.config import settings
from app.core.database import get_connection
from app.services.model_balance import balance_capability

ENV_NAMES = {
    "document": ("DEEPSEEK_API_URL", "DEEPSEEK_API_KEY", "DEEPSEEK_MODEL"),
    "vision": ("VISION_API_BASE_URL", "VISION_API_KEY", "VISION_MODEL"),
}
SCRIPT_PROVIDERS = {
    "docx-markdown-completion-audit": "document",
    "document-score-audit": "document",
    "image-visual-audit": "vision",
    "image-visual-score-audit": "vision",
    "docx-layout-visual-audit": "vision",
}
SCRIPT_NAMES = {
    "docx-markdown-completion-audit": "DOCX 完成性审核",
    "document-score-audit": "DOCX/PDF AI 评分",
    "image-visual-audit": "图片视觉审核",
    "image-visual-score-audit": "图片视觉打分",
    "docx-layout-visual-audit": "DOCX 视觉排版审核",
}


class ModelConfigConflict(ValueError):
    pass


class PublisherModelNotConfigured(RuntimeError):
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
                           ("moonshot.ai", "moonshot"), ("minimax.cn", "minimax"),
                           ("minimax.io", "minimax"), ("minimaxi.com", "minimax")]:
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
        defaults = {
            "document": (settings.deepseek_api_url, settings.deepseek_api_key, settings.deepseek_model),
            "vision": (settings.vision_api_base_url, settings.vision_api_key, ""),
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


def list_model_connections(owner_id: int) -> dict[str, object]:
    from app.services.model_thinking import thinking_profile
    with get_connection() as connection:
        connection.execute("BEGIN")
        cards = connection.execute("SELECT * FROM audit_model_cards WHERE owner_teacher_id = ? ORDER BY name, id", (owner_id,)).fetchall()
        from app.services.node_models import model_node_usages
        usages = model_node_usages(connection, owner_id)
    return {
        "cards": [{"id": row["id"], "vendor": row["vendor"], "name": row["name"],
                   "apiUrl": row["api_url"], "hasApiKey": bool(row["encrypted_api_key"]),
                   "model": row["model"], "revision": row["revision"],
                   "thinking": json.loads(row["thinking_json"]),
                   "thinkingProfile": thinking_profile(row["vendor"], row["model"]),
                   "hasBillingCredentials": bool(row["encrypted_billing_credentials"]),
                   "balanceCapability": balance_capability(row["vendor"], row["api_url"], bool(row["encrypted_billing_credentials"]))} for row in cards],
        "scripts": [{"id": key, "name": name} for key, name in SCRIPT_NAMES.items()],
        "usages": usages,
    }


def save_model_card(card_id: str | None, *, owner_id: int, vendor: str, name: str, api_url: str,
                    api_key: str | None, model: str, revision: int, thinking: dict[str, object],
                    billing_access_key: str = "", billing_secret_key: str = "", billing_console_token: str = "",
                    billing_cookie: str = "", billing_group_id: str = "", clear_billing: bool = False) -> None:
    from app.services.model_thinking import validate_thinking
    thinking_json = json.dumps(validate_thinking(vendor, model, thinking))
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        encrypted = ""
        billing = ""
        if card_id is not None:
            row = connection.execute("SELECT * FROM audit_model_cards WHERE id = ? AND owner_teacher_id = ?", (card_id, owner_id)).fetchone()
            if row is None or row["revision"] != revision:
                raise ModelConfigConflict("模型卡已被修改或删除，请重新读取")
            encrypted = row["encrypted_api_key"]
            billing = row["encrypted_billing_credentials"] if row["vendor"] == vendor else ""
        if vendor not in {"doubao", "zhipu", "minimax"} or clear_billing:
            billing = ""
        if billing_access_key or billing_secret_key:
            if vendor != "doubao" or clear_billing or not (billing_access_key and billing_secret_key):
                raise ValueError("财务凭据须同时填写 AK 和 SK，且不能同时选择清除")
            billing = _cipher().encrypt(json.dumps({"ak": billing_access_key, "sk": billing_secret_key}).encode()).decode()
        if billing_console_token:
            if vendor != "zhipu" or clear_billing:
                raise ValueError("控制台 Token 仅用于智谱，且不能同时选择清除")
            if not billing_console_token.isascii() or any(char.isspace() for char in billing_console_token) or ";" in billing_console_token:
                raise ValueError("请仅填写控制台 Token 原始值，不要包含 Bearer、完整 Cookie 或空白字符")
            billing = _cipher().encrypt(json.dumps({"token": billing_console_token}).encode()).decode()
        if billing_cookie or billing_group_id:
            if vendor != "minimax" or clear_billing or not (billing_cookie and billing_group_id):
                raise ValueError("MiniMax 财务凭据须同时填写 Cookie 和 Group ID，且不能同时选择清除")
            if "=" not in billing_cookie or any(ord(char) < 32 or ord(char) >= 127 for char in billing_cookie):
                raise ValueError("请填写 Cookie 请求头的完整值，不要包含换行或非 ASCII 字符")
            if not billing_group_id.isascii() or not billing_group_id.isdecimal():
                raise ValueError("请填写 X-Group-Id 请求头中的数字 Group ID")
            billing = _cipher().encrypt(json.dumps({"cookie": billing_cookie, "groupId": billing_group_id}).encode()).decode()
        if api_key:
            encrypted = _cipher().encrypt(api_key.encode()).decode()
        if not encrypted:
            raise ValueError("请填写 API Key")
        now = datetime.now(UTC).isoformat()
        if card_id is None:
            connection.execute(
                "INSERT INTO audit_model_cards (id, vendor, name, api_url, encrypted_api_key, model, updated_at, thinking_json, encrypted_billing_credentials, owner_teacher_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (uuid.uuid4().hex, vendor, name, api_url, encrypted, model, now, thinking_json, billing, owner_id),
            )
        else:
            connection.execute(
                "UPDATE audit_model_cards SET vendor = ?, name = ?, api_url = ?, encrypted_api_key = ?, model = ?, revision = revision + 1, updated_at = ?, thinking_json = ?, encrypted_billing_credentials = ? WHERE id = ?",
                (vendor, name, api_url, encrypted, model, now, thinking_json, billing, card_id),
            )


def delete_model_card(card_id: str, revision: int, owner_id: int) -> None:
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT revision FROM audit_model_cards WHERE id = ? AND owner_teacher_id = ?", (card_id, owner_id)).fetchone()
        if row is None or row["revision"] != revision:
            raise ModelConfigConflict("模型卡已被修改或删除，请重新读取")
        from app.services.node_models import model_node_usages
        if any(usage["cardId"] == card_id for usage in model_node_usages(connection, owner_id)):
            raise ModelConfigConflict("模型卡正在被流程节点使用，请先在节点中更换模型")
        connection.execute("DELETE FROM audit_model_cards WHERE id = ?", (card_id,))


def model_environment(script_id: str, flow_id: str, node_key: str, card_id: str | None = None) -> dict[str, str]:
    kind = SCRIPT_PROVIDERS.get(script_id)
    if kind is None:
        return {}
    with get_connection() as connection:
        row = connection.execute(
            """SELECT c.* FROM flows f
               JOIN node_audit_policies p ON p.flow_id = f.id
               JOIN audit_model_cards c ON c.id = p.model_card_id AND CAST(c.owner_teacher_id AS TEXT) = f.owner_id
               WHERE f.id = ? AND p.node_key = ? AND p.script_id = ?""",
            (flow_id, node_key, script_id),
        ).fetchone()
        if card_id:
            row = connection.execute("""SELECT c.* FROM flows f JOIN audit_model_cards c
                ON CAST(c.owner_teacher_id AS TEXT) = f.owner_id WHERE f.id = ? AND c.id = ?""",
                (flow_id, card_id)).fetchone()
    if row is None or not row["encrypted_api_key"] or not row["api_url"] or not row["model"]:
        raise PublisherModelNotConfigured("当前节点尚未配置发布者自己的审核模型，请联系发布者配置后重试")
    return _card_environment(kind, row)


def test_model_environment(script_id: str, card_id: str | None, owner_id: int) -> dict[str, str]:
    kind = SCRIPT_PROVIDERS.get(script_id)
    if kind is None:
        return {}
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM audit_model_cards WHERE id = ? AND owner_teacher_id = ?",
            (card_id, owner_id),
        ).fetchone()
    if row is None or not row["encrypted_api_key"] or not row["api_url"] or not row["model"]:
        raise PublisherModelNotConfigured("请先选择你自己的可用审核模型卡")
    return _card_environment(kind, row)


def _card_environment(kind: str, row) -> dict[str, str]:
    url_name, key_name, model_name = ENV_NAMES[kind]
    key = _cipher().decrypt(row["encrypted_api_key"].encode()).decode() if row["encrypted_api_key"] else ""
    from app.services.model_thinking import request_thinking_options
    options = request_thinking_options(row["vendor"], row["model"], json.loads(row["thinking_json"]))
    return {url_name: row["api_url"], key_name: key, model_name: row["model"],
            "AUDIT_CHAT_OPTIONS": json.dumps(options)}


def initialize_model_thinking() -> None:
    from app.services.model_thinking import thinking_profile
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(audit_model_cards)")}
        if "thinking_json" in columns:
            return
        connection.execute("ALTER TABLE audit_model_cards ADD COLUMN thinking_json TEXT NOT NULL DEFAULT '{\"mode\":\"default\",\"effort\":\"default\",\"budget\":null}'")
        for card in connection.execute("SELECT * FROM audit_model_cards").fetchall():
            modes = set()
            for binding in connection.execute("SELECT script_id FROM audit_model_bindings WHERE card_id = ?", (card["id"],)):
                config_path = Path(settings.audit_scripts_root) / binding["script_id"] / "config.json"
                if config_path.exists():
                    config = json.loads(config_path.read_text(encoding="utf-8"))
                    modes.update("on" if item["value"] else "off" for item in config.get("runtimeSettings", []) if item["key"] == "thinkingEnabled")
            mode = next(iter(modes)) if len(modes) == 1 else "default"
            if mode not in thinking_profile(card["vendor"], card["model"])["modes"]:
                mode = "default"
            connection.execute("UPDATE audit_model_cards SET thinking_json = ? WHERE id = ?", (
                json.dumps({"mode": mode, "effort": "default", "budget": None}), card["id"],
            ))


def query_model_balance(card_id: str, revision: int, owner_id: int) -> dict:
    from cryptography.fernet import InvalidToken
    from app.services.model_balance import fetch_balance
    with get_connection() as connection:
        row = connection.execute("SELECT * FROM audit_model_cards WHERE id = ? AND owner_teacher_id = ?", (card_id, owner_id)).fetchone()
    if row is None or row["revision"] != revision:
        raise ModelConfigConflict("模型卡已被修改或删除，请刷新后重试")
    capability = balance_capability(row["vendor"], row["api_url"], bool(row["encrypted_billing_credentials"]))
    if not capability["supported"]:
        raise ValueError(capability["reason"])
    if row["vendor"] in {"doubao", "zhipu", "minimax"}:
        from app.services.volc_billing import fetch_volc_balance
        from app.services.zhipu_billing import fetch_zhipu_balance
        from app.services.minimax_billing import fetch_minimax_balance
        try:
            credentials = json.loads(_cipher().decrypt(row["encrypted_billing_credentials"].encode()).decode())
        except (InvalidToken, ValueError, UnicodeError):
            raise RuntimeError("财务凭据无法解密，请重新保存") from None
        if row["vendor"] == "zhipu":
            return fetch_zhipu_balance(credentials["token"])
        if row["vendor"] == "minimax":
            return fetch_minimax_balance(credentials["cookie"], credentials["groupId"])
        return fetch_volc_balance(credentials["ak"], credentials["sk"])
    if not row["encrypted_api_key"]:
        raise ValueError("请先配置 API Key")
    try:
        key = _cipher().decrypt(row["encrypted_api_key"].encode()).decode()
    except (InvalidToken, UnicodeError):
        raise RuntimeError("模型密钥无法解密，请重新保存 API Key") from None
    return fetch_balance(row["vendor"], row["api_url"], key)


def initialize_model_billing() -> None:
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(audit_model_cards)")}
        if "encrypted_billing_credentials" not in columns:
            connection.execute("ALTER TABLE audit_model_cards ADD COLUMN encrypted_billing_credentials TEXT NOT NULL DEFAULT ''")


def test_model_connection(card_id: str, revision: int, owner_id: int) -> dict:
    from cryptography.fernet import InvalidToken
    from app.services.model_diagnostics import probe_model
    with get_connection() as connection:
        row = connection.execute("SELECT * FROM audit_model_cards WHERE id = ? AND owner_teacher_id = ?", (card_id, owner_id)).fetchone()
    if row is None or row["revision"] != revision:
        raise ModelConfigConflict("模型卡已被修改或删除，请刷新后重试")
    if not row["encrypted_api_key"] or not row["model"]:
        raise ValueError("请先完善模型及 API Key 配置")
    try:
        key = _cipher().decrypt(row["encrypted_api_key"].encode()).decode()
    except (InvalidToken, UnicodeError):
        raise RuntimeError("模型密钥无法解密，请重新保存 API Key") from None
    return probe_model(row["vendor"], row["api_url"], row["model"], key, json.loads(row["thinking_json"]))


def discover_models(card_id: str | None, revision: int, vendor: str, api_url: str, api_key: str, owner_id: int) -> list[str]:
    from cryptography.fernet import InvalidToken
    from app.services.model_discovery import fetch_models
    key = api_key.strip()
    if card_id:
        with get_connection() as connection:
            row = connection.execute("SELECT * FROM audit_model_cards WHERE id = ? AND owner_teacher_id = ?", (card_id, owner_id)).fetchone()
        if row is None or row["revision"] != revision:
            raise ModelConfigConflict("模型卡已被修改或删除，请刷新后重试")
        if not key:
            if row["vendor"] != vendor or row["api_url"].rstrip("/") != api_url:
                raise ValueError("厂商或地址已变化，请填写用于此连接的 API Key。")
            try:
                key = _cipher().decrypt(row["encrypted_api_key"].encode()).decode() if row["encrypted_api_key"] else ""
            except (InvalidToken, UnicodeError):
                raise RuntimeError("模型密钥无法解密，请重新填写 API Key。") from None
    if not key:
        raise ValueError("请先填写 API Key，再获取模型列表。")
    return fetch_models(api_url, key)
