"""Zhipu console balance adapter; uses an independent, expiring login token."""
import json
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener

from app.services.model_balance import NoRedirect, _amount


def fetch_zhipu_balance(token: str) -> dict:
    try:
        request = Request("https://open.bigmodel.cn/api/biz/account/query-customer-account-report",
                          headers={"Authorization": token, "Accept": "application/json"}, method="GET")
        with build_opener(NoRedirect()).open(request, timeout=10) as response:
            body = response.read(65537)
            if len(body) > 65536:
                raise ValueError("oversized response")
            payload = json.loads(body, parse_float=Decimal)
        code = payload.get("code")
        if code is not None and str(code).strip().lower() not in {"0", "200", "success", "ok"}:
            raise RuntimeError("智谱控制台查询被拒绝，请更新登录 Token 或检查账户权限")
        total = _amount(payload["data"]["balance"])
    except HTTPError as exc:
        code = exc.code
        exc.close()
        message = "智谱控制台余额接口暂不可用，请稍后重试"
        if code in {301, 302, 303, 307, 308, 401, 403}:
            message = "智谱控制台登录已失效或无权限，请重新填写 Token"
        elif code == 429:
            message = "查询过于频繁，请稍后重试"
        raise RuntimeError(message) from None
    except (URLError, OSError, TimeoutError, HTTPException):
        raise RuntimeError("智谱余额查询连接失败或超时，请稍后重试") from None
    except (ValueError, KeyError, TypeError, AttributeError, InvalidOperation):
        raise RuntimeError("未收到有效余额，请检查控制台 Token；接口格式也可能已变更") from None
    return {"available": Decimal(total) > 0, "checkedAt": datetime.now(UTC).isoformat(),
            "balances": [{"currency": "CNY", "available": total, "details": []}]}
