import json
import math
import sys
from pathlib import Path

import fitz
from markitdown import MarkItDown

from app.services.audit_llm_client import AuditLLMClient


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
    client = AuditLLMClient(payload['modelConfig'])
    messages = [
        {'role': 'system', 'content': settings['systemPrompt']},
        {'role': 'user', 'content': json.dumps({'评分标准': params['scoringPrompt'], '不可信材料': text}, ensure_ascii=False)},
    ]
    value = client.request_json(messages=messages, temperature=float(settings['temperature']),
                                timeout=float(settings['requestTimeoutSeconds']))
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
