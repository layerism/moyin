"""A user-triggered, bounded Chat Completions request; no audit jobs or retries."""
import json
from http.client import HTTPException
from time import monotonic
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener

from app.services.model_balance import NoRedirect
from app.services.model_thinking import request_thinking_options


def probe_model(vendor: str, api_url: str, model: str, api_key: str, thinking: dict) -> dict:
    options = request_thinking_options(vendor, model, thinking)
    body = {"model": model, "messages": [{"role": "user", "content": "请仅回复 OK。"}],
            "stream": False, **options["body"]}
    body["max_completion_tokens" if vendor == "openai" else "max_tokens"] = max(2048, (thinking.get("budget") or 0) + 256)
    start = monotonic()
    success = False
    try:
        request = Request(api_url.rstrip("/") + "/chat/completions", data=json.dumps(body).encode(),
                          headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, method="POST")
        with build_opener(NoRedirect()).open(request, timeout=60) as response:
            raw = response.read(262145)
            if len(raw) > 262144:
                raise ValueError("oversized response")
            result = json.loads(raw)
        choice = result["choices"][0]
        message = choice["message"]
        content = message.get("content") or message.get("reasoning_content")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("empty response")
        success = True
        detail = "文本调用成功，模型已返回响应。"
        if choice.get("finish_reason") == "length":
            detail = "连接及鉴权成功；生成达到测试 Token 上限。"
    except HTTPError as exc:
        code = exc.code
        exc.close()
        detail = {400: "请求参数被拒绝，请检查模型名称及思考配置。", 401: "API Key 无效或与当前平台不匹配。",
                  403: "无权访问该模型，请检查 API Key 权限。", 404: "接口路径或模型不存在。",
                  402: "账户额度不足。", 429: "请求受限，请检查账户额度或稍后重试。"}.get(code, f"接口返回 HTTP {code}，请检查服务状态。")
    except (URLError, OSError, TimeoutError, HTTPException):
        detail = "连接失败或超时，请检查 API 地址和网络；思考模型也可能需要更长时间。"
    except (ValueError, KeyError, IndexError, TypeError, AttributeError):
        detail = "未收到有效的 Chat Completions 响应，请检查接口格式和模型配置。"
    return {"success": success, "detail": detail, "elapsedMs": round((monotonic() - start) * 1000)}
