"""MiniMax CN console account balance, authenticated by Cookie and X-Group-Id."""
import json
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener

from app.services.model_balance import NoRedirect, _amount


def fetch_minimax_balance(cookie: str, group_id: str) -> dict:
    try:
        request = Request("https://www.minimax.cn/account/query_balance", headers={
            "Cookie": cookie, "X-Group-Id": group_id, "Accept": "application/json",
        }, method="GET")
        with build_opener(NoRedirect()).open(request, timeout=10) as response:
            body = response.read(65537)
            if len(body) > 65536:
                raise ValueError("oversized response")
            payload = json.loads(body, parse_float=Decimal)
        if payload["base_resp"]["status_code"] != 0:
            raise RuntimeError("MiniMax 控制台查询被拒绝，请更新 Cookie 或检查 Group ID 和账户权限")
        item = payload["data"]
        total = _amount(item["available_amount"])
        details = [{"label": label, "value": _amount(item[key])} for key, label in (
            ("cash_balance", "现金余额"), ("voucher_balance", "代金券余额"),
            ("credit_balance", "信用额度"), ("owed_amount", "欠费金额"),
        ) if item.get(key) is not None]
    except HTTPError as exc:
        code = exc.code
        exc.close()
        message = "MiniMax 控制台余额接口暂不可用，请稍后重试"
        if code in {301, 302, 303, 307, 308, 401, 403}:
            message = "MiniMax 控制台登录已失效或无权限，请更新 Cookie 和 Group ID"
        elif code == 429:
            message = "查询过于频繁，请稍后重试"
        raise RuntimeError(message) from None
    except (URLError, OSError, TimeoutError, HTTPException):
        raise RuntimeError("MiniMax 余额查询连接失败或超时，请稍后重试") from None
    except (ValueError, KeyError, TypeError, AttributeError, InvalidOperation):
        raise RuntimeError("未收到有效余额，请检查 Cookie 和 Group ID；接口格式也可能已变更") from None
    return {"available": Decimal(total) > 0, "checkedAt": datetime.now(UTC).isoformat(),
            "balances": [{"currency": "CNY", "available": total, "details": details}]}
