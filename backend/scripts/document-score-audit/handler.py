import json
import math
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from markitdown import MarkItDown
import fitz

MAX_MODEL_RESPONSE_BYTES = 1_048_576

def request_review(
    system: str, user: str, settings: dict[str, object]
) -> dict[str, object]:
    api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    base_url = os.environ.get("DEEPSEEK_API_URL", "").strip().rstrip("/")
    model = os.environ.get("DEEPSEEK_MODEL", "").strip()
    if not api_key or not base_url or not model:
        raise RuntimeError("DOCX LLM 审核服务未配置")
    if len(model) > 200:
        raise RuntimeError("DOCX LLM 审核模型配置无效")
    parsed_url = urlsplit(base_url)
    if (
        parsed_url.scheme not in {"http", "https"}
        or not parsed_url.netloc
        or parsed_url.username is not None
        or parsed_url.password is not None
    ):
        raise RuntimeError("DOCX LLM 审核服务地址无效")
    body: dict[str, object] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "response_format": {"type": "json_object"},
        "temperature": settings["temperature"],
    }
    options = json.loads(os.environ.get("AUDIT_CHAT_OPTIONS", "{}"))
    body.update(options.get("body", {}))
    if options.get("omitTemperature"):
        body.pop("temperature", None)
    request = Request(
        f"{base_url}/chat/completions",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urlopen(request, timeout=float(settings["requestTimeoutSeconds"])) as response:
            raw_response = response.read(MAX_MODEL_RESPONSE_BYTES + 1)
        if len(raw_response) > MAX_MODEL_RESPONSE_BYTES:
            raise ValueError("模型响应过大")
        payload = json.loads(raw_response)
        content = payload["choices"][0]["message"]["content"]
        if not isinstance(content, str):
            raise TypeError("模型响应内容无效")
        value = json.loads(content)
        if not isinstance(value, dict):
            raise TypeError("模型响应内容无效")
        return value
    except (
        HTTPError,
        URLError,
        TimeoutError,
        OSError,
        KeyError,
        IndexError,
        TypeError,
        json.JSONDecodeError,
        UnicodeDecodeError,
        ValueError,
    ) as exc:
        raise RuntimeError("DOCX LLM 审核请求或响应无效") from exc


def run(payload):
    files = payload['files']
    if len(files) != 1:
        raise ValueError('评分需要一个文件')
    item = files[0]
    path = Path(item['path'])
    if item['extension'] == '.pdf':
        with fitz.open(path) as document:
            text = '\n'.join(page.get_text() for page in document)
    elif item['extension'] == '.docx':
        text = MarkItDown(enable_plugins=False).convert_local(path).text_content
    else:
        raise ValueError('评分不支持此文件格式')
    params = payload['context']['scriptParams']
    settings = payload['context']['scriptSettings']
    if not text.strip() or len(text) > settings['maximumInputCharacters']:
        raise ValueError('文档无可读取正文或超出审核长度限制')
    value = request_review(settings['systemPrompt'] + '\n仅返回 JSON：{"score":0到100的数值,"reason":"完整的Markdown评分依据与扣分说明"}。',
        json.dumps({'评分标准':params['scoringPrompt'], '不可信材料':text}, ensure_ascii=False), settings)
    score = value.get('score')
    reason = value.get('reason')
    if isinstance(score, bool) or not isinstance(score, (int,float)) or not math.isfinite(score) or not 0 <= score <= 100:
        raise ValueError('模型评分无效')
    if not isinstance(reason,str) or not reason.strip() or len(reason) > 16000:
        raise ValueError('模型评分说明无效')
    threshold = params['passThreshold']
    return {'schemaVersion':'1.0','passed':score >= threshold,
            'reason': f'**评分：{score:g} / 100 · 通过阈值：{threshold}**\n\n{reason}',
            'details':{'checkedFileCount':1,'issues':[], 'score':score,'threshold':threshold}}

if __name__ == '__main__':
    try:
        print(json.dumps(run(json.load(sys.stdin)), ensure_ascii=False))
    except Exception:
        print('文档评分执行失败', file=sys.stderr)
        sys.exit(1)
