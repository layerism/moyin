"""Run a teacher's unsaved review configuration without creating a submission."""
import hashlib
import json
import tempfile
import uuid
from pathlib import Path, PurePosixPath

from fastapi import UploadFile

from app.services.audit_model_connections import test_model_config
from app.services.audit_script_catalog import AuditScriptCatalogError, find_audit_script
from app.services.audit_script_executor import (
    ALLOWED_EXTENSIONS,
    AuditMaterial,
    AuditScriptExecutionError,
    execute_staged_audit_script,
    validate_audit_material,
)
from app.services.audit_script_parameters import default_script_settings, validate_script_params
from app.services.audit_script_runtime import resolve_audit_script
from app.services.scan_materials import inspect_scan_material


def run_audit_script_test(
    script_id: str,
    params: dict[str, str | int | float | bool],
    model_card_id: str | None,
    owner_id: int,
    uploads: list[UploadFile],
    *, allow_internal: bool = False,
) -> dict[str, object]:
    # Teachers use public scripts; the management page also allows internal scripts.
    if find_audit_script(script_id).visibility != "public" and not allow_internal:
        raise AuditScriptCatalogError("审核脚本不可测试")
    descriptor = resolve_audit_script(script_id)
    parameters = validate_script_params(descriptor.config, params)
    runtime_settings = default_script_settings(descriptor.config)
    model_configuration = test_model_config(script_id, model_card_id, owner_id)
    scans = script_id in {"image-visual-audit", "image-visual-score-audit"}
    if not 1 <= len(uploads) <= (10 if scans else 1):
        raise ValueError("扫描审核请选择 1–10 个文件" if scans else "文档审核请选择一个文件")
    single_limit = (10 if scans else 50) * 1024 * 1024
    total_limit = (30 if scans else 50) * 1024 * 1024
    total_size = 0
    total_pages = 0
    accepted_extensions = descriptor.config.accepted_extensions or ALLOWED_EXTENSIONS
    with tempfile.TemporaryDirectory(prefix="audit-test-", dir="/tmp") as temporary:
        execution_root = Path(temporary)
        files_root = execution_root / "files"
        files_root.mkdir()
        trace_directory = execution_root / "requests"
        trace_directory.mkdir()
        materials: list[AuditMaterial] = []
        staged: list[dict[str, object]] = []
        for upload in uploads:
            name = PurePosixPath((upload.filename or "").replace("\\", "/")).name
            extension = Path(name).suffix.lower()
            if extension not in accepted_extensions:
                raise ValueError("测试文件类型不符合所选脚本要求")
            file_id = uuid.uuid4().hex
            path = files_root / f"{file_id}{extension}"
            digest = hashlib.sha256()
            size = 0
            upload.file.seek(0)
            with path.open("wb") as destination:
                while chunk := upload.file.read(65_536):
                    size += len(chunk)
                    total_size += len(chunk)
                    if size > single_limit or total_size > total_limit:
                        raise ValueError("扫描审核限单文件 10 MB、合计 30 MB" if scans else "测试文件不能超过 50 MB")
                    digest.update(chunk)
                    destination.write(chunk)
            if not size:
                raise ValueError("测试文件不能为空")
            content_type = upload.content_type or "application/octet-stream"
            page_count = 1
            if scans:
                with path.open("rb") as source:
                    inspection = inspect_scan_material(source, name, size)
                content_type, page_count = inspection.content_type, inspection.page_count
                total_pages += page_count
                if total_pages > 20:
                    raise ValueError("扫描审核合计不能超过 20 页")
            material = AuditMaterial(file_id, name, "", content_type, size, digest.hexdigest(), page_count)
            validate_audit_material(path, extension, material)
            materials.append(material)
            staged.append({
                "id": file_id, "name": name, "extension": extension,
                "mimeType": content_type, "path": str(path), "size": size,
                "sha256": material.sha256, "pageCount": page_count,
            })
        result = None
        error = None
        try:
            result = execute_staged_audit_script(
                descriptor, materials, staged,
                {"scriptParams": parameters, "scriptSettings": runtime_settings, "stepModelCardId": model_card_id},
                execution_root, model_configuration={**model_configuration, "requestTraceDirectory": str(trace_directory)},
            )
        except AuditScriptExecutionError as exc:
            error = str(exc)
        requests = [json.loads(path.read_text(encoding="utf-8")) for path in sorted(trace_directory.glob("*.json"))]
        return {"result": result, "requests": requests, "error": error}
