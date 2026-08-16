# 禁止上传 PDF 扫描件实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 确认承诺节点的新上传和替换仅接受 JPG、JPEG、PNG，同时保持普通文件节点与历史 PDF 审核行为不变。

**Architecture:** 浏览器文件选择器负责引导用户，后端 `inspect_scan_material()` 负责不可绕过的最终格式校验。审核脚本和数据存储不改动，因此已发布脚本快照、历史文件和审核任务不受影响。

**Tech Stack:** React 18、TypeScript、FastAPI、Python 3.11、Pillow

## Global Constraints

- 只限制“扫描件提交与审核”能力，不改变普通文件上传节点。
- 不修改 `backend/scripts/confirmation-visual-audit/` 下的任何文件。
- 不迁移、不删除历史文件、提交、审核任务或 OSS 对象。
- 修改过程中不运行测试、不使用浏览器；只执行源代码逻辑审计与 `git diff --check`。
- 只提交本任务相关文件，并在完成后清理限定缓存、重启本地服务。

---

### Task 1: 收紧后端扫描件格式校验

**Files:**
- Modify: `backend/app/services/scan_materials.py:1-55`

**Interfaces:**
- Consumes: `inspect_scan_material(stream: BinaryIO, filename: str, size_bytes: int)` 的现有上传调用。
- Produces: 对 JPG、JPEG、PNG 返回 `ScanInspection`；对 PDF 和其他扩展名抛出 `ScanMaterialError("扫描件仅支持 JPG、JPEG 或 PNG")`。

- [x] **Step 1: 移除 PDF 解析依赖与分支**

删除 `fitz` 导入、`.pdf` 分支和 `fitz.FileDataError` 异常捕获；保留 Pillow 的真实图片格式、像素数、损坏内容校验。

- [x] **Step 2: 更新格式错误文案**

将允许格式文案固定为“扫描件仅支持 JPG、JPEG 或 PNG”，确保 PDF 在 OSS 上传前返回 HTTP 422。

### Task 2: 同步前端文件选择与说明

**Files:**
- Modify: `frontend/src/features/academic-flow/ScanUploadWorkspace.tsx:112-133`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:2048`

**Interfaces:**
- Consumes: 现有 `workflowApi.uploadScan()` 上传路径。
- Produces: 新上传与替换入口的 `accept=".jpg,.jpeg,.png"`，以及仅列出 JPG、JPEG、PNG 的学生端和教师端说明。

- [x] **Step 1: 收紧两个文件选择器**

新上传与替换入口同时移除 `.pdf`，避免两个入口行为不一致；拖拽文件仍交由后端做最终校验。

- [x] **Step 2: 更新两处用户文案**

学生端显示“JPG、JPEG、PNG；最多 10 个文件、20 页”，教师端显示“支持 JPG、JPEG、PNG”。

### Task 3: 静态审计与交付

**Files:**
- Modify: `docs/superpowers/specs/2026-08-16-image-only-confirmation-audit-design.md`
- Create: `docs/superpowers/plans/2026-08-16-disable-pdf-scan-upload.md`

**Interfaces:**
- Consumes: Tasks 1–2 的源代码改动。
- Produces: 前后端一致、审核脚本未变化的结果提交与重新启动的本地服务。

- [x] **Step 1: 审计范围与文本一致性**

使用 `rg` 确认扫描件上传入口不再声明 PDF，并使用 `git diff -- backend/app/services/scan_materials.py frontend/src/features/academic-flow/ScanUploadWorkspace.tsx frontend/src/features/academic-flow/AcademicFlowDesigner.tsx backend/scripts/confirmation-visual-audit` 确认审核脚本无改动。

- [x] **Step 2: 执行静态格式检查**

运行 `git diff --check`。不运行测试、构建或浏览器验证。

- [x] **Step 3: 清理并提交**

仅清理项目产生的 `.pytest_cache`、`__pycache__` 和 `*.egg-info`，然后只提交本计划列出的文件。

- [x] **Step 4: 重启并核对服务**

关闭已确认属于本项目的 5173、8000 端口服务；从 `backend/` 启动 Uvicorn，从 `frontend/` 使用项目 `.local/node` 启动 Vite，并核对两个端口监听。
