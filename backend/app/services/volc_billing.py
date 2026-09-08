"""Volcengine Billing OpenAPI with its independent account credentials."""
import hashlib
import hmac
import json
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener

from app.services.model_balance import NoRedirect, _amount


def billing_request(ak: str, sk: str) -> Request:
    # Endpoint/service/region follow the official BillingService; POST follows BILLINGApi.
    host = "billing.volcengineapi.com"
    query = "Action=QueryBalanceAcct&Version=2022-01-01"
    body = b"{}"
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    scope = f"{stamp[:8]}/cn-north-1/billing/request"
    body_hash = hashlib.sha256(body).hexdigest()
    signed = "content-type;host;x-content-sha256;x-date"
    headers = {"Content-Type": "application/json", "Host": host,
               "X-Content-Sha256": body_hash, "X-Date": stamp}
    canonical_headers = "".join(f"{key.lower()}:{value}\n" for key, value in sorted(headers.items()))
    canonical = "\n".join(["POST", "/", query, canonical_headers, signed, body_hash])
    to_sign = "\n".join(["HMAC-SHA256", stamp, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    signing_key = sk.encode()
    for part in (stamp[:8], "cn-north-1", "billing", "request"):
        signing_key = hmac.new(signing_key, part.encode(), hashlib.sha256).digest()
    signature = hmac.new(signing_key, to_sign.encode(), hashlib.sha256).hexdigest()
    headers["Authorization"] = f"HMAC-SHA256 Credential={ak}/{scope}, SignedHeaders={signed}, Signature={signature}"
    return Request(f"https://{host}/?{query}", data=body, headers=headers, method="POST")


def fetch_volc_balance(ak: str, sk: str) -> dict:
    try:
        with build_opener(NoRedirect()).open(billing_request(ak, sk), timeout=10) as response:
            body = response.read(65537)
            if len(body) > 65536:
                raise ValueError("oversized response")
            payload = json.loads(body, parse_float=Decimal)
        if payload.get("ResponseMetadata", {}).get("Error"):
            raise RuntimeError("火山财务查询被拒绝，请检查 AK/SK 和账户余额查询权限")
        item = payload["Result"]
        total = _amount(item["AvailableBalance"])
        details = [{"label": label, "value": _amount(item[key])} for key, label in (
            ("CashBalance", "现金余额"), ("ArrearsBalance", "欠费金额"),
            ("CreditLimit", "信控额度"), ("FreezeAmount", "冻结金额"))]
    except HTTPError as exc:
        code = exc.code
        exc.close()
        message = "火山财务接口暂不可用"
        if code in {400, 401, 403}:
            message = "火山财务鉴权失败，请检查 AK/SK 和账户余额查询权限"
        elif code == 429:
            message = "查询过于频繁，请稍后重试"
        raise RuntimeError(message) from None
    except (URLError, OSError, TimeoutError, HTTPException):
        raise RuntimeError("火山财务查询连接失败或超时，请稍后重试") from None
    except (ValueError, KeyError, TypeError, AttributeError, InvalidOperation):
        raise RuntimeError("火山财务返回数据无效，请检查凭据或稍后重试") from None
    return {"available": Decimal(total) > 0, "checkedAt": datetime.now(UTC).isoformat(),
            "balances": [{"currency": "CNY", "available": total, "details": details}]}
