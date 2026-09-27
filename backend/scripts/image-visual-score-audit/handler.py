"""Score student-uploaded images and PDF pages with a vision model."""
import json
import math
import sys

from app.services.audit_image_materials import material_images
from app.services.audit_llm_client import AuditLLMClient


def request_score(files, params, settings, client: AuditLLMClient):
    content = [{"type": "text", "text": "教师评分标准：\n" + params["scoringPrompt"]}]
    for file_number, item in enumerate(files, 1):
        for page_number, data_url in enumerate(material_images(item, settings), 1):
            content.extend([
                {"type": "text", "text": f"第 {file_number} 个文件，第 {page_number} 页"},
                {"type": "image_url", "image_url": {"url": data_url}},
            ])
    messages = [
        {"role": "system", "content": settings["systemPrompt"]},
        {"role": "user", "content": content},
    ]
    value = client.request_json(messages=messages, temperature=float(settings["temperature"]),
                                timeout=float(settings["requestTimeoutSeconds"]))
    score = value.get("score")
    reason = value.get("reason")
    if isinstance(score, bool) or not isinstance(score, (int, float)) or not math.isfinite(score) or not 0 <= score <= 100:
        raise ValueError("视觉评分结果无效")
    if not isinstance(reason, str) or not reason.strip():
        raise ValueError("视觉评分说明无效")
    return float(score), reason.strip()


def main():
    payload = json.load(sys.stdin)
    files = payload["files"]
    if not 1 <= len(files) <= 10 or not 1 <= sum(item["pageCount"] for item in files) <= 20:
        raise ValueError("扫描件数量或页数无效")
    context = payload["context"]
    params = context["scriptParams"]
    threshold = params["passThreshold"]
    if isinstance(threshold, bool) or not isinstance(threshold, int) or not 0 <= threshold <= 100:
        raise ValueError("视觉评分阈值无效")
    score, reason = request_score(files, params, context["scriptSettings"], AuditLLMClient(payload["modelConfig"]))
    json.dump({"schemaVersion": "1.0", "passed": score >= threshold,
               "reason": f"**评分：{score:g} / 100 · 通过阈值：{threshold}**\n\n{reason}",
               "details": {"checkedFileCount": len(files), "issues": [], "score": score,
                           "threshold": threshold}}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
