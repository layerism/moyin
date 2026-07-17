# Audit Script Template Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Python/JavaScript 审核模板升级为支持七类、多文件输入的 ZIP 模板包，并为后端提供固定依赖、临时材料目录和统一 JSON 脚本执行入口。

**Architecture:** 模板服务使用 Python 标准库 `zipfile` 在内存中生成两个 ZIP 包；后端镜像统一安装 Python 文档库与 Node.js Runtime 依赖，上传脚本不得安装依赖。执行服务复用现有不可变脚本解析器，把 OSS 材料下载到独立临时目录，通过 stdin/stdout JSON 协议调用 Python 或 JavaScript，并在返回前校验结果和清理目录。

**Tech Stack:** FastAPI、Python 3.12、Python stdlib `zipfile/subprocess/tempfile`、Node.js 24 LTS、React 18、TypeScript、`python-docx/openpyxl/PyMuPDF/python-pptx/Pillow`、`mammoth/xlsx/pdf-parse/jszip/fast-xml-parser/sharp`。

## Global Constraints

- 只允许 `.docx`、`.xlsx`、`.pdf`、`.pptx`、`.jpeg`、`.jpg`、`.png`，扩展名比较不区分大小写。
- 后端同时校验扩展名、文件头与 OOXML 包结构，不能只信任浏览器 MIME 或文件名。
- Python 与 JavaScript 入口都从 stdin 接收 `schemaVersion = "1.0"` 的 JSON，并向 stdout 输出唯一 JSON。
- 默认单次执行超时 60 秒、stdout 最大 1 MiB、stderr 最大 256 KiB。
- 脚本环境变量采用白名单，不继承 OSS Key 或完整项目 `.env`。
- 继续使用 `script_id + version + sha256` 解析固定脚本版本。
- 不改变现有流程节点的版本固定策略；本计划只提供可被审核阶段调用的 Runner，不改变当前提交状态机。
- 遵循项目约束：当前分支开发；实现期间不创建中间提交；全部实现完成、缓存清理并重启服务后只创建一个完成提交。
- 不提交现有无关改动：`AGENTS.md`、`docs/05_oa_graph.md`、`.superpowers/brainstorm/`、`.superpowers/sdd/`。

---

### Task 1: 生成多文件审核模板 ZIP 包

**Files:**

- Modify: `backend/app/services/audit_script_templates.py`
- Modify: `backend/app/api/routes/workflow_admin.py`
- Modify: `backend/tests/test_audit_scripts_api.py`

**Interfaces:**

- Produces: `get_template_archive(language: str) -> tuple[bytes, str]`
- Produces: ZIP 内固定文件 `handler.py|handler.js`、`input.example.json`、`output.example.json`、`README.md`
- Consumes: 现有 `GET /api/workflow-admin/audit-scripts/templates/{language}` 权限边界

- [ ] **Step 1: 写失败测试，固定 ZIP 文件名和包内容**

在 `backend/tests/test_audit_scripts_api.py` 中将原单文件模板测试替换为：

```python
from io import BytesIO
from zipfile import ZipFile

from app.services.audit_script_templates import get_template_archive


@pytest.mark.parametrize(
    ("language", "filename", "entry"),
    [
        ("python", "audit-script-python-template.zip", "handler.py"),
        ("javascript", "audit-script-javascript-template.zip", "handler.js"),
    ],
)
def test_template_archive_contains_contract_files(language, filename, entry):
    content, actual_filename = get_template_archive(language)
    assert actual_filename == filename
    with ZipFile(BytesIO(content)) as archive:
        assert set(archive.namelist()) == {
            entry,
            "input.example.json",
            "output.example.json",
            "README.md",
        }
        source = archive.read(entry).decode("utf-8")
        assert '"schemaVersion"' in archive.read("input.example.json").decode("utf-8")
        assert '"checkedFileCount"' in archive.read("output.example.json").decode("utf-8")
        assert ".docx" in source and ".png" in source
```

再增加接口断言：响应 `Content-Type` 为 `application/zip`，`Content-Disposition` 中为 ZIP 文件名，普通教师仍为 `403`。

- [ ] **Step 2: 运行定向测试，确认 RED**

Run: `cd backend && pytest -q tests/test_audit_scripts_api.py -k template`

Expected: FAIL，`get_template_archive` 尚不存在，原接口仍返回文本脚本。

- [ ] **Step 3: 用标准库生成 ZIP**

在 `audit_script_templates.py` 中保留模板常量但改为完整多文件骨架，并实现：

```python
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile


def get_template_archive(language: str) -> tuple[bytes, str]:
    if language == "python":
        entry_name = "handler.py"
        entry_source = PYTHON_TEMPLATE
        filename = "audit-script-python-template.zip"
    elif language == "javascript":
        entry_name = "handler.js"
        entry_source = JAVASCRIPT_TEMPLATE
        filename = "audit-script-javascript-template.zip"
    else:
        raise ValueError("仅支持 Python 或 JavaScript 模板")

    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr(entry_name, entry_source)
        archive.writestr("input.example.json", INPUT_EXAMPLE)
        archive.writestr("output.example.json", OUTPUT_EXAMPLE)
        archive.writestr("README.md", README_BY_LANGUAGE[language])
    return output.getvalue(), filename
```

Python 模板在模块顶层导入 `fitz`、`openpyxl`、`docx`、`PIL.Image`、`pptx.Presentation`；JavaScript 模板导入 `mammoth`、`xlsx`、`PDFParse`、`JSZip`、`XMLParser`、`sharp`。两种入口都必须：

```text
validate payload -> iterate files -> parse by extension -> collect per-file issues
-> return {schemaVersion, passed, reason, details:{checkedFileCount, issues}}
```

JavaScript PDF 使用 `pdf-parse` v2 API：

```javascript
const { PDFParse } = require("pdf-parse");
const parser = new PDFParse({ data: await readFile(file.path) });
try {
  return await parser.getText();
} finally {
  await parser.destroy();
}
```

- [ ] **Step 4: 修改模板下载响应**

`workflow_admin.py` 调用 `get_template_archive()`，并返回：

```python
return Response(
    content=content,
    media_type="application/zip",
    headers={"Content-Disposition": f'attachment; filename="{filename}"'},
)
```

- [ ] **Step 5: 运行 Task 1 测试，确认 GREEN**

Run: `cd backend && pytest -q tests/test_audit_scripts_api.py -k template`

Expected: PASS，Python/JavaScript ZIP 均包含四个固定文件，权限测试保持通过。

---

### Task 2: 让前端按 ZIP 类型保存模板

**Files:**

- Modify: `frontend/src/features/academic-flow/AuditScriptManagerDialog.tsx`
- Modify: `frontend/src/features/academic-flow/auditScriptManager.ts`
- Modify: `frontend/tests/auditScriptManager.test.ts`

**Interfaces:**

- Consumes: Task 1 返回的 ZIP Blob
- Produces: Python 建议文件名 `audit-script-python-template.zip`
- Produces: JavaScript 建议文件名 `audit-script-javascript-template.zip`

- [ ] **Step 1: 写失败测试固定 ZIP 保存参数**

将模板下载测试中的文件名改为 ZIP，并断言文件选择器类型：

```typescript
assert.equal(options.suggestedName, "audit-script-python-template.zip");
assert.deepEqual(options.types[0]?.accept, { "application/zip": [".zip"] });
```

JavaScript 回退测试断言 `audit-script-javascript-template.zip`。

- [ ] **Step 2: 运行定向测试，确认 RED**

Run: `cd frontend && node --experimental-strip-types --test tests/auditScriptManager.test.ts`

Expected: FAIL，当前建议名称与 MIME 仍为 `.py` 或 `.js`。

- [ ] **Step 3: 最小修改下载配置**

`AuditScriptManagerDialog.tsx` 传入 ZIP 文件名；`downloadAuditScriptTemplate()` 固定：

```typescript
types: [{
  accept: { "application/zip": [".zip"] },
  description: "审核脚本模板包",
}]
```

不增加新的下载组件或浏览器兼容层；继续复用现有 `showSaveFilePicker` 和普通下载回退。

- [ ] **Step 4: 运行 Task 2 测试，确认 GREEN**

Run: `cd frontend && node --experimental-strip-types --test tests/auditScriptManager.test.ts`

Expected: PASS。

---

### Task 3: 固定 Python 与 JavaScript 审核依赖环境

**Files:**

- Modify: `backend/pyproject.toml`
- Create: `backend/runtime/javascript/package.json`
- Create: `backend/runtime/javascript/package-lock.json`
- Modify: `backend/Dockerfile`
- Modify: `backend/app/core/config.py`
- Modify: `backend/tests/test_audit_script_runtime.py`

**Interfaces:**

- Produces: `settings.audit_node_executable`
- Produces: `settings.audit_node_modules_path`
- Consumes: 模板中的固定 imports/requires

- [ ] **Step 1: 写运行环境配置失败测试**

在 `test_audit_script_runtime.py` 增加：

```python
def test_audit_runtime_has_explicit_node_configuration():
    assert settings.audit_node_executable
    assert Path(settings.audit_node_modules_path).name == "node_modules"
```

在模板测试中断言 Python 和 JavaScript 的每个固定依赖导入均存在，确保依赖清单与模板不漂移。

- [ ] **Step 2: 运行测试，确认 RED**

Run: `cd backend && pytest -q tests/test_audit_script_runtime.py tests/test_audit_scripts_api.py -k "configuration or imports"`

Expected: FAIL，Settings 尚无 Node Runtime 字段。

- [ ] **Step 3: 增加正式依赖**

`backend/pyproject.toml` 增加 Python 文档依赖。新增 `backend/runtime/javascript/package.json`：

```json
{
  "name": "document-audit-script-runtime",
  "private": true,
  "version": "1.0.0",
  "dependencies": {
    "fast-xml-parser": "^5.2.5",
    "jszip": "^3.10.1",
    "mammoth": "^1.12.0",
    "pdf-parse": "^2.4.5",
    "sharp": "^0.35.3",
    "xlsx": "^0.18.5"
  }
}
```

Run: `cd backend/runtime/javascript && npm install --package-lock-only`

Expected: 生成可复现的 `package-lock.json`。

- [ ] **Step 4: 配置本地与 Docker Runtime**

`Settings` 增加：

```python
audit_node_executable: str = "node"
audit_node_modules_path: str = str(
    Path(__file__).resolve().parents[2] / "runtime" / "javascript" / "node_modules"
)
audit_script_timeout_seconds: int = 60
audit_script_stdout_max_bytes: int = 1_048_576
audit_script_stderr_max_bytes: int = 262_144
audit_temp_root: str = ""
```

`backend/Dockerfile` 使用 `node:24-bookworm-slim` 构建阶段执行 `npm ci --omit=dev`，最终 Python 镜像复制 Node 可执行文件及 `/opt/audit-runtime/node_modules`，设置 `NODE_PATH=/opt/audit-runtime/node_modules`。Python 依赖继续由 `pip install --no-cache-dir .` 安装。

- [ ] **Step 5: 安装本地 Runtime 依赖**

Run: `cd backend && python -m pip install -e .`

Run: `cd backend/runtime/javascript && npm ci --omit=dev`

Expected: Python 五类解析库可 import；Node 六类解析库可 require。

- [ ] **Step 6: 运行 Runtime 配置测试，确认 GREEN**

Run: `cd backend && pytest -q tests/test_audit_script_runtime.py tests/test_audit_scripts_api.py -k "configuration or imports"`

Expected: PASS。

---

### Task 4: 增加材料真实性校验与 OSS 临时落盘

**Files:**

- Modify: `backend/app/services/object_storage.py`
- Create: `backend/app/services/audit_script_executor.py`
- Modify: `backend/tests/test_object_storage.py`
- Modify: `backend/tests/test_audit_script_runtime.py`

**Interfaces:**

- Produces: `AuditMaterial(id, name, storage_key, content_type, size, sha256)`
- Produces: `stage_audit_materials(materials, destination, storage) -> list[dict[str, object]]`
- Produces: `ObjectStorage.download_to_file(key: str, destination: Path) -> None`

- [ ] **Step 1: 写失败测试覆盖多文件、伪造格式和路径安全**

测试使用内存 Fake Storage，准备一个最小 PDF 与一个最小 PNG，断言：

```python
staged = stage_audit_materials([pdf_material, png_material], tmp_path, storage)
assert [item["extension"] for item in staged] == [".pdf", ".png"]
assert all(Path(item["path"]).is_relative_to(tmp_path.resolve()) for item in staged)
```

另覆盖：`.exe`、扩展名 `.pdf` 但内容不是 `%PDF-`、OOXML ZIP 缺少对应 `word/`、`xl/` 或 `ppt/` 目录、下载内容 SHA-256 不匹配。异常统一为 `AuditScriptExecutionError`，对外消息不包含本地绝对路径或 OSS Key。

- [ ] **Step 2: 运行定向测试，确认 RED**

Run: `cd backend && pytest -q tests/test_object_storage.py tests/test_audit_script_runtime.py -k "download_to_file or stage_audit"`

Expected: FAIL，新接口尚不存在。

- [ ] **Step 3: 实现对象下载方法**

`ObjectStorage.download_to_file()` 调用 OSS SDK `get_object_to_file`，捕获底层异常并统一抛出 `ObjectStorageError("OSS 下载失败")`，随后用 `_ensure_success()` 校验状态码。测试 Fake Bucket 验证目标文件字节一致。

- [ ] **Step 4: 实现最小材料校验器**

`audit_script_executor.py` 定义：

```python
ALLOWED_EXTENSIONS = frozenset({".docx", ".xlsx", ".pdf", ".pptx", ".jpeg", ".jpg", ".png"})

@dataclass(frozen=True)
class AuditMaterial:
    id: str
    name: str
    storage_key: str
    content_type: str
    size: int
    sha256: str
```

文件名写入规则固定为 `<安全 file_id><规范化扩展名>`。真实性校验使用标准库：PDF `%PDF-`、PNG 八字节签名、JPEG `FFD8FF`；OOXML 使用 `zipfile.ZipFile` 检查 `[Content_Types].xml` 以及 `word/`、`xl/`、`ppt/` 对应目录。最后重新计算 SHA-256。

- [ ] **Step 5: 运行 Task 4 测试，确认 GREEN**

Run: `cd backend && pytest -q tests/test_object_storage.py tests/test_audit_script_runtime.py -k "download_to_file or stage_audit"`

Expected: PASS。

---

### Task 5: 实现统一 JSON 脚本 Runner

**Files:**

- Modify: `backend/app/services/audit_script_executor.py`
- Modify: `backend/tests/test_audit_script_runtime.py`

**Interfaces:**

- Consumes: `AuditScriptRuntimeDescriptor`、`AuditMaterial`、Object Storage
- Produces: `execute_audit_script(descriptor, materials, context, storage=None) -> dict[str, object]`

- [ ] **Step 1: 写 Python 与 JavaScript Runner 失败测试**

测试临时创建遵循协议的 `handler.py` 与 `handler.js`，为两个文件返回：

```json
{
  "schemaVersion": "1.0",
  "passed": true,
  "reason": "",
  "details": {"checkedFileCount": 2, "issues": []}
}
```

断言 Runner 的 stdin 中存在两个文件、context 原样传入、stdout 被解析为字典。另覆盖空材料、超时、非零退出、非 JSON、错误 schemaVersion、错误 checkedFileCount、stdout/stderr 超限，且每个场景结束后临时目录不存在。

- [ ] **Step 2: 运行定向测试，确认 RED**

Run: `cd backend && pytest -q tests/test_audit_script_runtime.py -k execute_audit_script`

Expected: FAIL，执行入口尚不存在。

- [ ] **Step 3: 构造稳定输入协议**

实现 `_build_payload()`，输出字段严格为：

```python
{
    "schemaVersion": "1.0",
    "executionId": execution_id,
    "files": staged_files,
    "context": context,
}
```

`files` 非空；所有 path 必须位于本次 `<temp>/files` 下。

- [ ] **Step 4: 实现受限子进程通信**

命令选择：

```python
command = [sys.executable, str(descriptor.entry_path)] if descriptor.language == "py" else [resolved_node, str(descriptor.entry_path)]
```

使用 `subprocess.Popen`、`selectors.DefaultSelector` 与 monotonic deadline 同时读取 stdout/stderr；达到时间或字节上限立即 `kill()`。子进程 `cwd` 设为本次临时目录，env 只包含 `PATH`、`LANG`、`PYTHONUTF8`、`PYTHONNOUSERSITE`、`NODE_PATH`。

- [ ] **Step 5: 校验输出并保证清理**

`_validate_result()` 逐项确认：

```python
result["schemaVersion"] == "1.0"
isinstance(result["passed"], bool)
isinstance(result["reason"], str)
result["details"]["checkedFileCount"] == len(materials)
isinstance(result["details"]["issues"], list)
```

`execute_audit_script()` 使用 `TemporaryDirectory(dir=settings.audit_temp_root or None)`，因此所有成功与异常路径都清理文件。stderr 仅用于内部日志或异常分类，不原样返回 API 调用者。

- [ ] **Step 6: 运行 Task 5 测试，确认 GREEN**

Run: `cd backend && pytest -q tests/test_audit_script_runtime.py -k execute_audit_script`

Expected: PASS。

---

### Task 6: 全量回归、浏览器验证、清理与交付

**Files:**

- Verify: `backend/tests/`
- Verify: `frontend/tests/`
- Verify: `http://localhost:5173/academic-flow`

**Interfaces:**

- Consumes: Tasks 1-5 全部产物
- Produces: 可下载 ZIP、可上传入口脚本、可由后续审核阶段调用的 Runner

- [ ] **Step 1: 运行后端回归**

Run: `cd backend && pytest -q`

Expected: 全部 PASS，无未处理 warning 或资源泄漏。

- [ ] **Step 2: 运行前端回归与构建**

Run: `cd frontend && node --experimental-strip-types --test tests/*.test.ts`

Run: `cd frontend && npm run build`

Expected: 全部测试 PASS，Vite 构建成功。

- [ ] **Step 3: 重启服务**

停止现有单一后端与前端开发进程，再分别启动：

```bash
cd backend && uvicorn app.main:app --host 127.0.0.1 --port 8000
cd frontend && npm run dev -- --host 127.0.0.1
```

Expected: `/api/health` 返回成功，Vite 监听 `127.0.0.1:5173`。

- [ ] **Step 4: 使用 Browser 完成交互验证**

目标流：`/academic-flow` → “审核脚本” → 下载 Python/JavaScript 模板 → 浏览器收到 ZIP 文件。

检查：页面标题与 DOM 正常、无框架错误覆盖层、控制台无相关 error/warn、两个按钮的建议文件名均为 `.zip`，取消保存不会触发重复下载。内嵌浏览器若不支持 `showSaveFilePicker`，验证普通 ZIP 下载回退，不把浏览器能力限制误报为应用错误。

- [ ] **Step 5: 清理开发缓存**

仅删除生成型缓存：

```text
backend/.pytest_cache/
backend/**/__pycache__/
backend/*.egg-info/
backend/**/*.egg-info/
```

保留 `backend/runtime/javascript/node_modules/`，因为它是本地后端 JavaScript Runtime 环境，而不是临时测试缓存。

- [ ] **Step 6: 检查改动范围并创建唯一完成提交**

Run: `git diff --check`

Run: `git status --short`

只暂存本计划列出的代码、测试、Runtime lockfile 和文档，不暂存既有无关改动。最终提交：

```bash
git commit -m "Add multi-file audit script template runtime"
```

Expected: 一个实现提交；服务已重启；工作区仅保留用户原有未提交文件。
