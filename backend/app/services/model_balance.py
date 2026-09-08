"""Documented account balances; never forward a card key to another origin."""
import json
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

ENDPOINTS = {
    ("deepseek", "https://api.deepseek.com"): "https://api.deepseek.com/user/balance",
    ("deepseek", "https://api.deepseek.com/v1"): "https://api.deepseek.com/user/balance",
    ("moonshot", "https://api.moonshot.cn/v1"): "https://api.moonshot.cn/v1/users/me/balance",
    ("moonshot", "https://api.moonshot.ai/v1"): "https://api.moonshot.ai/v1/users/me/balance",
}


def balance_capability(vendor: str, api_url: str, has_billing: bool = False) -> dict:
    if vendor == "doubao":
        return {"supported": has_billing, "reason": "火山云账户余额，不代表单模型配额。" if has_billing else "请在编辑配置中填写财务 AK/SK。"}
    if vendor == "zhipu":
        return {"supported": has_billing, "reason": "通过智谱控制台会话查询；Token 过期后需更新。" if has_billing else "请在编辑配置中填写智谱控制台 Token。"}
    supported = (vendor, api_url.rstrip("/")) in ENDPOINTS
    reason = {
        "openai": "暂未接入：官方 Usage / Costs 查询的是用量与费用，不是剩余余额。",
        "qwen": "暂未接入：阿里云账户余额需独立的云账户财务鉴权。",
        "doubao": "暂未接入：火山引擎账户余额需独立的云账户财务鉴权。",
    }.get(vendor, "此地址未接入官方余额查询接口。")
    return {"supported": supported, "reason": "查询账户余额，同账户模型共享。" if supported else reason}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _amount(value: object) -> str:
    if not isinstance(value, (str, int, float, Decimal)) or isinstance(value, bool):
        raise ValueError("invalid amount")
    number = Decimal(str(value))
    if not number.is_finite() or abs(number.adjusted()) > 100:
        raise ValueError("invalid amount")
    return format(number, "f")


def fetch_balance(vendor: str, api_url: str, api_key: str) -> dict:
    endpoint = ENDPOINTS[(vendor, api_url.rstrip("/"))]
    request = Request(endpoint, headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"})
    try:
        with build_opener(NoRedirect()).open(request, timeout=10) as response:
            body = response.read(65537)
            if len(body) > 65536:
                raise ValueError("oversized response")
            payload = json.loads(body, parse_float=Decimal)
        if vendor == "deepseek":
            available = payload["is_available"]
            if not isinstance(available, bool):
                raise ValueError("invalid availability")
            balances = [{"currency": item["currency"], "available": _amount(item["total_balance"]),
                         "credit": _amount(item["granted_balance"]), "cash": _amount(item["topped_up_balance"])}
                        for item in payload["balance_infos"]]
            if not balances or any(item["currency"] not in {"CNY", "USD"} for item in balances):
                raise ValueError("invalid currency")
        else:
            if payload["code"] != 0 or payload["status"] is not True:
                raise ValueError("provider rejected request")
            item = payload["data"]
            total = _amount(item["available_balance"])
            available = Decimal(total) > 0
            balances = [{"currency": "CNY" if "moonshot.cn/" in endpoint else "账户计价单位",
                         "available": total, "credit": _amount(item["voucher_balance"]),
                         "cash": _amount(item["cash_balance"])}]
    except HTTPError as exc:
        code = exc.code
        exc.close()
        reason = {401: "API Key 无效或与平台不匹配", 403: "API Key 无权查询余额", 429: "查询过于频繁，请稍后重试"}.get(code, "厂商余额接口暂不可用")
        raise RuntimeError(reason) from None
    except (URLError, TimeoutError, OSError):
        raise RuntimeError("余额查询连接失败或超时，请稍后重试") from None
    except (ValueError, KeyError, TypeError, InvalidOperation):
        raise RuntimeError("厂商返回的余额数据无效，请稍后重试") from None
    return {"available": available, "balances": balances, "checkedAt": datetime.now(UTC).isoformat()}
