"""Audit student-uploaded images and PDF pages with a vision model."""
import json
import sys

from app.services.audit_image_materials import material_images
from app.services.audit_llm_client import AuditLLMClient


def request_review(files, params, settings, client: AuditLLMClient):
    content = [{"type": "text", "text": "教师审核标准：\n" + params["reviewPrompt"]}]
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
    if not isinstance(value.get("passed"), bool) or not isinstance(value.get("reason"), str) or not value["reason"].strip():
        raise ValueError("视觉审核结果无效")
    return value["passed"], value["reason"].strip()


def main():
    payload = json.load(sys.stdin)
    files = payload["files"]
    if not 1 <= len(files) <= 10 or not 1 <= sum(item["pageCount"] for item in files) <= 20:
        raise ValueError("扫描件数量或页数无效")
    context = payload["context"]
    passed, reason = request_review(files, context["scriptParams"], context["scriptSettings"], AuditLLMClient(payload["modelConfig"]))
    json.dump({"schemaVersion": "1.0", "passed": passed, "reason": reason,
               "details": {"checkedFileCount": len(files), "issues": []}}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
