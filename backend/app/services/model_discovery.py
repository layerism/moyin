"""User-triggered OpenAI-compatible model discovery."""
import json
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener

from app.services.model_balance import NoRedirect


def fetch_models(api_url: str, api_key: str) -> list[str]:
    request = Request(api_url.rstrip("/") + "/models",
                      headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"})
    try:
        with build_opener(NoRedirect()).open(request, timeout=15) as response:
            raw = response.read(1048577)
        if len(raw) > 1048576:
            raise ValueError()
        data = json.loads(raw)["data"]
        if not isinstance(data, list) or any(not isinstance(item, dict) or not isinstance(item.get("id"), str) for item in data):
            raise ValueError()
        return sorted({item["id"] for item in data if item["id"].strip() and len(item["id"]) <= 200})
    except HTTPError as exc:
        code = exc.code
        exc.close()
        message = {401: "API Key 无效，请检查密钥。", 403: "无权获取模型列表。", 404: "此接口不支持模型列表，请手动输入型号。",
                   429: "请求受限，请稍后重试。"}.get(code, f"获取模型列表失败（HTTP {code}）。")
        raise RuntimeError(message) from None
    except (URLError, OSError, TimeoutError, HTTPException):
        raise RuntimeError("获取模型列表连接失败或超时，请检查地址和网络。") from None
    except (ValueError, KeyError, TypeError):
        raise RuntimeError("接口未返回有效模型列表，请手动输入型号。") from None
