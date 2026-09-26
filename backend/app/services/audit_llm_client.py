"""Task-scoped Chat Completions client, independent of the application runtime."""
import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


MAX_RESPONSE_BYTES = 1_048_576


class AuditLLMError(RuntimeError):
    """Safe diagnostics without credentials or raw provider responses."""


class AuditLLMClient:
    def __init__(self, config: dict[str, object]):
        self._base_url = str(config.get("baseUrl", "")).strip().rstrip("/")
        self._api_key = str(config.get("apiKey", ""))
        self._model = str(config.get("model", "")).strip()
        options = config.get("requestOptions", {})
        if not isinstance(options, dict):
            raise AuditLLMError("审核模型请求参数无效")
        self._options = options
        if not self._base_url or not self._api_key or not self._model:
            raise AuditLLMError("审核模型配置不完整")
        parsed = urlsplit(self._base_url)
        if (parsed.scheme not in {"http", "https"} or not parsed.netloc
                or parsed.username is not None or parsed.password is not None or len(self._model) > 200):
            raise AuditLLMError("审核模型配置无效")

    def request_json(
        self, *, messages: list[dict[str, object]], temperature: float, timeout: float,
    ) -> dict[str, object]:
        body = {
            "model": self._model,
            "messages": messages,
            "response_format": {"type": "json_object"},
            "temperature": temperature,
        }
        body.update(self._options.get("body", {}))
        if self._options.get("omitTemperature"):
            body.pop("temperature", None)
        request = Request(
            self._base_url + "/chat/completions",
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            method="POST",
            headers={"Authorization": "Bearer " + self._api_key, "Content-Type": "application/json"},
        )
        try:
            with urlopen(request, timeout=timeout) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except HTTPError as exc:
            raise AuditLLMError(f"审核模型接口拒绝请求（HTTP {exc.code}）") from None
        except TimeoutError:
            raise AuditLLMError("审核模型请求超时") from None
        except URLError as exc:
            if isinstance(exc.reason, TimeoutError):
                raise AuditLLMError("审核模型请求超时") from None
            raise AuditLLMError("审核模型连接失败") from None
        except OSError:
            raise AuditLLMError("审核模型连接失败") from None
        if len(raw) > MAX_RESPONSE_BYTES:
            raise AuditLLMError("审核模型响应超出大小限制")
        try:
            content = json.loads(raw)["choices"][0]["message"]["content"]
            if not isinstance(content, str):
                raise TypeError()
            # Some compatible providers wrap their JSON in a Markdown code fence.
            content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.I)
            result = json.loads(content)
            if not isinstance(result, dict):
                raise TypeError()
        except (KeyError, IndexError, TypeError, ValueError, UnicodeDecodeError):
            raise AuditLLMError("审核模型返回格式无效，需返回 JSON 对象") from None
        return result
