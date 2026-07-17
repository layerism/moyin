import hashlib
import json
import os
import re
import selectors
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from zipfile import BadZipFile, ZipFile

from app.core.config import settings
from app.services.audit_script_runtime import AuditScriptRuntimeDescriptor
from app.services.object_storage import get_object_storage


ALLOWED_EXTENSIONS = frozenset({".docx", ".xlsx", ".pdf", ".pptx", ".jpeg", ".jpg", ".png"})


class AuditScriptExecutionError(RuntimeError):
    pass


@dataclass(frozen=True)
class AuditMaterial:
    id: str
    name: str
    storage_key: str
    content_type: str
    size: int
    sha256: str


def stage_audit_materials(
    materials: list[AuditMaterial], destination: Path, storage: Any
) -> list[dict[str, object]]:
    destination = destination.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    staged: list[dict[str, object]] = []
    seen_ids: set[str] = set()
    for material in materials:
        extension = Path(material.name).suffix.lower()
        if (
            extension not in ALLOWED_EXTENSIONS
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", material.id)
            or material.id in seen_ids
        ):
            raise AuditScriptExecutionError("审核材料格式或标识无效")
        seen_ids.add(material.id)
        path = (destination / f"{material.id}{extension}").resolve()
        if not path.is_relative_to(destination):
            raise AuditScriptExecutionError("审核材料路径无效")
        try:
            storage.download_to_file(material.storage_key, path)
            _validate_download(path, extension, material)
        except AuditScriptExecutionError:
            raise
        except Exception:
            raise AuditScriptExecutionError("审核材料下载失败") from None
        staged.append(
            {
                "id": material.id,
                "name": material.name,
                "extension": extension,
                "mimeType": material.content_type,
                "path": str(path),
                "size": material.size,
                "sha256": material.sha256,
            }
        )
    return staged


def execute_audit_script(
    descriptor: AuditScriptRuntimeDescriptor,
    materials: list[AuditMaterial],
    context: dict[str, object],
    *,
    storage: Any | None = None,
) -> dict[str, object]:
    if not materials:
        raise AuditScriptExecutionError("审核材料不能为空")
    temp_root = Path(settings.audit_temp_root).resolve() if settings.audit_temp_root else None
    if temp_root:
        temp_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="audit-", dir=temp_root) as temporary:
        execution_root = Path(temporary).resolve()
        staged = stage_audit_materials(
            materials, execution_root / "files", storage or get_object_storage()
        )
        payload = _build_payload(str(uuid.uuid4()), staged, context, execution_root / "files")
        output = _run_process(descriptor, payload, execution_root)
        return _validate_result(output, materials)


def _build_payload(
    execution_id: str,
    files: list[dict[str, object]],
    context: dict[str, object],
    files_root: Path,
) -> dict[str, object]:
    if not files:
        raise AuditScriptExecutionError("审核材料不能为空")
    root = files_root.resolve()
    for item in files:
        path = Path(str(item.get("path", ""))).resolve()
        if not path.is_file() or not path.is_relative_to(root):
            raise AuditScriptExecutionError("审核材料路径无效")
    return {
        "schemaVersion": "1.0",
        "executionId": execution_id,
        "files": files,
        "context": context,
    }


def _run_process(
    descriptor: AuditScriptRuntimeDescriptor,
    payload: dict[str, object],
    execution_root: Path,
) -> bytes:
    command = _command_for(descriptor)
    try:
        stdin = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    except (TypeError, ValueError):
        raise AuditScriptExecutionError("审核脚本输入协议无效") from None
    environment = {
        "PATH": os.environ.get("PATH", os.defpath),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "PYTHONUTF8": "1",
        "PYTHONNOUSERSITE": "1",
        "NODE_PATH": settings.audit_node_modules_path,
    }
    try:
        process = subprocess.Popen(
            command,
            cwd=execution_root,
            env=environment,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except OSError:
        raise AuditScriptExecutionError("审核脚本启动失败") from None

    selector = selectors.DefaultSelector()
    stdout = bytearray()
    stderr = bytearray()
    deadline = time.monotonic() + settings.audit_script_timeout_seconds
    try:
        assert process.stdin is not None
        assert process.stdout is not None
        assert process.stderr is not None
        try:
            process.stdin.write(stdin)
        except BrokenPipeError:
            pass
        finally:
            process.stdin.close()
        selector.register(
            process.stdout,
            selectors.EVENT_READ,
            (stdout, "标准输出", settings.audit_script_stdout_max_bytes),
        )
        selector.register(
            process.stderr,
            selectors.EVENT_READ,
            (stderr, "标准错误", settings.audit_script_stderr_max_bytes),
        )
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise AuditScriptExecutionError("审核脚本执行超时")
            for key, _ in selector.select(min(remaining, 0.1)):
                buffer, label, limit = key.data
                chunk = os.read(key.fileobj.fileno(), min(65_536, limit - len(buffer) + 1))
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                buffer.extend(chunk)
                if len(buffer) > limit:
                    raise AuditScriptExecutionError(f"审核脚本{label}超限")
        try:
            exit_code = process.wait(timeout=max(0.0, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            raise AuditScriptExecutionError("审核脚本执行超时") from None
        if exit_code != 0:
            raise AuditScriptExecutionError("审核脚本执行失败")
        return bytes(stdout)
    finally:
        selector.close()
        if process.poll() is None:
            process.kill()
            process.wait()
        if process.stdout:
            process.stdout.close()
        if process.stderr:
            process.stderr.close()


def _command_for(descriptor: AuditScriptRuntimeDescriptor) -> list[str]:
    if descriptor.language == "py":
        return [sys.executable, str(descriptor.entry_path)]
    if descriptor.language == "js":
        node = shutil.which(settings.audit_node_executable, path=os.environ.get("PATH"))
        if node:
            return [node, str(descriptor.entry_path)]
    raise AuditScriptExecutionError("审核脚本运行环境不可用")


def _validate_result(output: bytes, materials: list[AuditMaterial]) -> dict[str, object]:
    try:
        result = json.loads(output.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise AuditScriptExecutionError("审核脚本输出协议无效") from None
    if not isinstance(result, dict) or result.get("schemaVersion") != "1.0":
        raise AuditScriptExecutionError("审核脚本输出协议无效")
    if not isinstance(result.get("passed"), bool) or not isinstance(result.get("reason"), str):
        raise AuditScriptExecutionError("审核脚本输出协议无效")
    details = result.get("details")
    if not isinstance(details, dict) or not isinstance(details.get("issues"), list):
        raise AuditScriptExecutionError("审核脚本输出协议无效")
    checked_count = details.get("checkedFileCount")
    if isinstance(checked_count, bool) or checked_count != len(materials):
        raise AuditScriptExecutionError("审核脚本处理文件数量不一致")
    file_ids = {material.id for material in materials}
    if any(
        not isinstance(issue, dict)
        or issue.get("fileId") not in file_ids
        or not isinstance(issue.get("code"), str)
        or not isinstance(issue.get("message"), str)
        for issue in details["issues"]
    ):
        raise AuditScriptExecutionError("审核脚本输出协议无效")
    return result


def _validate_download(path: Path, extension: str, material: AuditMaterial) -> None:
    try:
        actual_size = path.stat().st_size
        actual_hash = _sha256(path)
        if actual_size != material.size or actual_hash.lower() != material.sha256.lower():
            raise AuditScriptExecutionError("审核材料完整性校验失败")
        with path.open("rb") as source:
            signature = source.read(8)
        if extension == ".pdf" and not signature.startswith(b"%PDF-"):
            raise AuditScriptExecutionError("审核材料真实格式与扩展名不一致")
        if extension == ".png" and signature != b"\x89PNG\r\n\x1a\n":
            raise AuditScriptExecutionError("审核材料真实格式与扩展名不一致")
        if extension in {".jpeg", ".jpg"} and not signature.startswith(b"\xff\xd8\xff"):
            raise AuditScriptExecutionError("审核材料真实格式与扩展名不一致")
        if extension in {".docx", ".xlsx", ".pptx"}:
            _validate_ooxml(path, extension)
    except AuditScriptExecutionError:
        raise
    except OSError:
        raise AuditScriptExecutionError("审核材料读取失败") from None


def _validate_ooxml(path: Path, extension: str) -> None:
    expected_folder = {".docx": "word/", ".xlsx": "xl/", ".pptx": "ppt/"}[extension]
    try:
        with ZipFile(path) as archive:
            names = archive.namelist()
            valid = "[Content_Types].xml" in names and any(
                name.startswith(expected_folder) for name in names
            )
    except (BadZipFile, OSError):
        valid = False
    if not valid:
        raise AuditScriptExecutionError("审核材料真实格式与扩展名不一致")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(65_536), b""):
            digest.update(chunk)
    return digest.hexdigest()
