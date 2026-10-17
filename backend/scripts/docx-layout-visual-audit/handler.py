"""DOCX -> LibreOffice PDF -> ordered page images -> visual pass/fail audit."""
import base64
import html
import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import pymupdf as fitz

from app.services.audit_llm_client import AuditLLMClient, AuditLLMError
from app.services.audit_prompt import render_audit_messages


class LayoutAuditError(RuntimeError):
    """Application-authored diagnostics without filenames or provider content."""


def remaining(deadline: float, limit: float) -> float:
    seconds = min(limit, deadline - time.monotonic())
    if seconds <= 0:
        raise LayoutAuditError("文档视觉审核超过总时限")
    return seconds


def render_pdf(source: Path, folder: Path, timeout: float) -> Path:
    folder.mkdir()
    profile = folder / "profile"
    # Separate profiles prevent parallel soffice jobs sharing a running instance.
    command = [
        "soffice", f"-env:UserInstallation={profile.resolve().as_uri()}",
        "--headless", "--norestore", "--nodefault", "--nofirststartwizard",
        "--convert-to", "pdf:writer_pdf_Export", "--outdir", str(folder), str(source),
    ]
    try:
        with (folder / "conversion.log").open("wb") as log:
            subprocess.run(command, stdout=log, stderr=log, timeout=timeout, check=True)
    except subprocess.TimeoutExpired:
        raise LayoutAuditError(f"DOCX 转 PDF 超时，限时 {timeout:.0f} 秒") from None
    except FileNotFoundError:
        raise LayoutAuditError("DOCX 转 PDF 失败，LibreOffice 转换程序不可用") from None
    except subprocess.CalledProcessError:
        raise LayoutAuditError("DOCX 转 PDF 失败，LibreOffice 异常退出") from None
    result = folder / f"{source.stem}.pdf"
    if not result.is_file() or result.stat().st_size == 0:
        raise LayoutAuditError("DOCX 转换未生成有效 PDF")
    return result


def page_image(document, page_number: int, maximum_side: int, folder: Path) -> str:
    page = document[page_number - 1]
    scale = maximum_side / max(page.rect.width, page.rect.height)
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csRGB, alpha=False)
    path = folder / f"page-{page_number}.png"
    pixmap.save(str(path))
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def parse_result(value: dict, reviewed_pages: list[int]) -> list[dict]:
    if not isinstance(value, dict) or set(value) != {"passed", "readable", "reviewedPages", "issues"}:
        raise ValueError("视觉模型返回字段无效")
    if type(value['passed']) is not bool or type(value['readable']) is not bool:
        raise ValueError("视觉模型返回状态无效")
    if not value['readable']:
        raise ValueError("模型无法清晰辨认页面，审核未完成")
    pages = value['reviewedPages']
    if not isinstance(pages, list) or any(type(page) is not int for page in pages) or sorted(pages) != reviewed_pages:
        raise ValueError("视觉模型未完整审核指定页面")
    issues = value['issues']
    if not isinstance(issues, list) or len(issues) > 100 or value['passed'] != (len(issues) == 0):
        raise ValueError("视觉模型结论与问题列表不一致")
    for issue in issues:
        if not isinstance(issue, dict) or set(issue) != {'page', 'location', 'problem', 'suggestion'}:
            raise ValueError("排版问题字段无效")
        if type(issue['page']) is not int or issue['page'] not in reviewed_pages:
            raise ValueError("排版问题页码无效")
        for key in ('location', 'problem', 'suggestion'):
            if not isinstance(issue[key], str) or not 1 <= len(issue[key].strip()) <= 1000:
                raise ValueError("排版问题缺少具体位置、现象或修改建议")
            issue[key] = issue[key].strip()
    return issues


def request_audit(images: list[tuple[int, str]], reviewed_pages: list[int], prompt: str,
                  settings: dict, timeout: float, client: AuditLLMClient) -> list[dict]:
    content = [{"type": "text", "text": f"教师排版要求：\n{prompt}\n全文审核页码：{reviewed_pages}"}]
    for page, data_url in images:
        content.extend([
            {"type": "text", "text": f"实际第 {page} 页"},
            {"type": "image_url", "image_url": {"url": data_url}},
        ])
    messages = render_audit_messages(__file__, content)
    value = client.request_json(messages=messages, temperature=float(settings['temperature']), timeout=timeout)
    try:
        return parse_result(value, reviewed_pages)
    except ValueError as error:
        raise LayoutAuditError(str(error)) from None


def markdown_text(value: str) -> str:
    text = html.escape(' '.join(value.split()), quote=False)
    return re.sub(r'([\\`*_{}\[\]()#+.!|])', r'\\\1', text)


def audit(payload: dict) -> dict:
    files = payload['files']
    client = AuditLLMClient(payload['modelConfig'])
    settings = payload['context']['scriptSettings']
    prompt = payload['context']['scriptParams']['layoutReviewPrompt']
    deadline = time.monotonic() + float(settings['executionTimeoutSeconds']) - 2
    if not files or any(item['extension'].lower() != '.docx' for item in files):
        raise ValueError("视觉排版审核仅支持 DOCX")
    issues = []
    file_reports = []
    reason_lines = []
    total_pages = 0
    # Keep every intermediate under the executor workspace, including on forced termination.
    with tempfile.TemporaryDirectory(prefix='docx-layout-', dir=Path.cwd()) as temporary:
        root = Path(temporary)
        documents = []
        for index, item in enumerate(files):
            folder = root / str(index)
            pdf = render_pdf(Path(item['path']), folder, remaining(deadline, settings['renderTimeoutSeconds']))
            try:
                with fitz.open(pdf) as document:
                    count = len(document)
                    if count == 0 or document.needs_pass:
                        raise LayoutAuditError("PDF 读取失败，转换结果为空或需要密码")
            except LayoutAuditError:
                raise
            except Exception:
                raise LayoutAuditError("PDF 读取失败，转换结果无法解析") from None
            total_pages += count
            if total_pages > settings['maximumPages']:
                raise LayoutAuditError(f"文档共 {total_pages} 页，超过审核上限 {settings['maximumPages']} 页，未完成全文审核")
            documents.append((item, folder, pdf, count))
        for item, folder, pdf, count in documents:
            reviewed_pages = list(range(1, count + 1))
            images = []
            try:
                with fitz.open(pdf) as document:
                    for page in reviewed_pages:
                        remaining(deadline, settings['executionTimeoutSeconds'])
                        try:
                            images.append((page, page_image(document, page, settings['imageMaximumSide'], folder)))
                        except Exception:
                            raise LayoutAuditError(f"第 {page} 页图片生成失败") from None
            except LayoutAuditError:
                raise
            except Exception:
                raise LayoutAuditError("PDF 页面读取失败") from None
            file_issues = request_audit(images, reviewed_pages, prompt, settings,
                remaining(deadline, settings['requestTimeoutSeconds']), client)
            del images
            seen = set()
            for issue in file_issues:
                key = (issue['page'], issue['location'], issue['problem'])
                if key in seen:
                    continue
                seen.add(key)
                message = f"第 {issue['page']} 页，{issue['location']}：{issue['problem']}。建议：{issue['suggestion']}"
                issues.append({"fileId": item['id'], "code": "docx_layout_issue", "message": message, **issue})
                reason_lines.append(f"- {markdown_text(item['name'])} · {markdown_text(message)}")
            file_reports.append({"fileId": item['id'], "pageCount": count, "checkedPageCount": count})
        remaining(deadline, settings['executionTimeoutSeconds'])
    note = "依据服务器 LibreOffice 渲染结果审核，页码为实际页面顺序。"
    reason = ("**不通过**\n\n" + '\n'.join(reason_lines)) if issues else f"通过：已审核全部 {total_pages} 页，未发现违反所设排版要求的明确问题。"
    return {
        "schemaVersion": "1.0", "passed": not issues, "reason": reason + '\n\n' + note,
        "details": {"checkedFileCount": len(files), "issues": issues, "pageCount": total_pages,
                    "checkedPageCount": total_pages, "files": file_reports, "renderer": "LibreOffice"},
    }


if __name__ == '__main__':
    try:
        result = audit(json.load(sys.stdin))
    except Exception as error:
        # Do not put provider responses, paths or credentials in script diagnostics.
        message = str(error) if isinstance(error, (LayoutAuditError, AuditLLMError)) else f"视觉排版材料处理失败（{type(error).__name__}）"
        print(f"LayoutAuditError: {message}", file=sys.stderr)
        sys.exit(1)
    json.dump(result, sys.stdout, ensure_ascii=False)
