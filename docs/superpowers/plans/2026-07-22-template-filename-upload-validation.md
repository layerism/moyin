# Template Filename Upload Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在学生文件写入 OSS 前校验其文件名是否与教师模板一致，并在成功上传后统一使用模板文件名。

**Architecture:** 在现有 `FileUploadContext` 中携带发布版本绑定的模板资产 ID 和原始文件名；上传路由先调用领域层文件名比较函数，再读取文件内容、计算哈希和写入 OSS。校验失败直接返回 422，成功时将模板文件名作为 OSS 对象键和 `uploaded_files.original_name` 的权威名称。

**Tech Stack:** Python 3.11、FastAPI、SQLite、Aliyun OSS、Unicode NFC。

## Global Constraints

- 只做文件名一致性校验，不实现内容、哈希或结构指纹比对。
- 校验必须发生在完整文件读取、哈希计算和 OSS 写入之前。
- 主文件名大小写敏感，扩展名大小写不敏感。
- 比较前去除路径、转换为 Unicode NFC，并去除文件名前后空白。
- 校验失败不得覆盖数据库记录、草稿或此前尚未提交的 OSS 文件。
- 无模板节点保持现有逻辑，历史已提交文件不追溯处理。
- 不新增依赖，不修改数据库结构，不修改前端数据结构。
- 遵循项目约束：实施期间不运行自动化测试、构建或浏览器测试；仅做静态业务审计，交由用户手测。
- 实施开始创建一次空检查点，全部代码完成后只创建一次完成提交，中间不提交。

---

## File Map

- Modify: `backend/app/domain/workflow_runtime.py` — 提供文件名清理、规范化和模板名称校验函数。
- Modify: `backend/app/repositories/flow_files.py` — 从发布版本模板绑定中返回权威模板元数据。
- Modify: `backend/app/api/routes/student_flows.py` — 在读取上传内容和写入 OSS 前执行校验，并使用权威文件名。
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx` — 上传失败时显示浏览器原生警告弹窗，避免错误横幅被节点弹窗遮挡。

### Task 1: 创建实施前检查点

**Files:**
- No source changes.

- [ ] **Step 1: 确认工作树并保护用户改动**

Run:

```bash
git status --short
git log -3 --oneline
```

Expected: 识别并保留用户已有的 `AGENTS.md`、`docs/05_oa_graph.md` 和 `.superpowers/` 改动，不暂存这些文件。

- [ ] **Step 2: 创建空检查点**

Run:

```bash
git commit --allow-empty -m "chore: checkpoint before template filename upload validation"
```

Expected: 当前分支新增一个不包含用户文件的检查点提交。

### Task 2: 实现权威文件名比较函数

**Files:**
- Modify: `backend/app/domain/workflow_runtime.py:1-5,80-100`

**Interfaces:**
- Produces: `validate_template_filename(uploaded_filename: str, template_filename: str) -> str`。
- Returns: 匹配时返回数据库提供的 `template_filename`，供 OSS 和元数据统一命名。
- Raises: 不匹配时抛出 `ValueError`，错误文字包含权威模板文件名。

- [ ] **Step 1: 增加标准库导入和规范化函数**

在 `workflow_runtime.py` 中加入：

```python
import unicodedata
from pathlib import PurePosixPath


def _filename_identity(value: str) -> tuple[str, str]:
    filename = PurePosixPath(str(value).replace("\\", "/")).name.strip()
    normalized = unicodedata.normalize("NFC", filename)
    path = PurePosixPath(normalized)
    return path.stem, path.suffix.lower()
```

- [ ] **Step 2: 增加模板文件名校验函数**

```python
def validate_template_filename(uploaded_filename: str, template_filename: str) -> str:
    if _filename_identity(uploaded_filename) != _filename_identity(template_filename):
        raise ValueError(
            f"文件名与模板不一致，请将文件重命名为“{template_filename}”后重新上传。"
        )
    return template_filename
```

该函数不得读取文件内容，也不得执行模糊匹配。`A.DOCX` 与 `A.docx` 匹配，`a.docx`、`A .docx` 和 `B.docx` 均不匹配。

### Task 3: 将模板元数据加入上传上下文

**Files:**
- Modify: `backend/app/repositories/flow_files.py:18-80`

**Interfaces:**
- Produces: `FileUploadContext.template_asset_id: str | None`。
- Produces: `FileUploadContext.template_original_name: str | None`。
- Preserves: 现有权限、名单、节点状态、截止时间和模板下载记录校验。

- [ ] **Step 1: 扩展上下文模型**

```python
@dataclass(frozen=True)
class FileUploadContext:
    node_instance_id: str
    flow_instance_id: str
    flow_version_id: str
    flow_id: str
    node_key: str
    status: str
    config_node: dict[str, Any]
    template_asset_id: str | None
    template_original_name: str | None
```

- [ ] **Step 2: 查询发布版本绑定的模板名称**

在现有 SQL 中增加模板资产连接：

```sql
LEFT JOIN flow_version_templates t
  ON t.flow_version_id = v.id AND t.node_key = n.node_key
LEFT JOIN flow_template_assets a
  ON a.id = t.template_asset_id
```

并在 `SELECT` 中返回：

```sql
t.template_asset_id,
a.original_name AS template_original_name
```

- [ ] **Step 3: 拒绝损坏的模板绑定并返回上下文**

在模板下载记录判断前加入：

```python
if row["template_asset_id"] and not row["template_original_name"]:
    raise FileContextError("当前节点模板配置异常，请联系教师")
```

构造 `FileUploadContext` 时加入：

```python
template_asset_id=row["template_asset_id"],
template_original_name=row["template_original_name"],
```

### Task 4: 在上传阶段校验并统一文件名

**Files:**
- Modify: `backend/app/api/routes/student_flows.py:1-4,99-152`
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx:155-177`

**Interfaces:**
- Consumes: `validate_template_filename(uploaded_filename, template_filename) -> str`。
- Consumes: `FileUploadContext.template_original_name`。
- Preserves: `replace_uploaded_file(...)` 事务及 OSS 写入失败补偿逻辑。

- [ ] **Step 1: 导入校验函数**

```python
from app.domain.workflow_runtime import validate_file_metadata, validate_template_filename
```

- [ ] **Step 2: 在读取文件前确定权威名称**

紧接空文件名检查后加入：

```python
authoritative_filename = filename
if context.template_original_name:
    try:
        authoritative_filename = validate_template_filename(
            filename, context.template_original_name
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
```

该代码必须位于 `hashlib.sha256()` 和文件读取循环之前，保证名称不匹配时不读取完整文件、不写入 OSS。

- [ ] **Step 3: 后续链路全部使用权威名称**

将以下三处 `filename` 替换为 `authoritative_filename`：

```python
validate_file_metadata(context.config_node, authoritative_filename, size_bytes)
timestamped_object_name(authoritative_filename, sha256)
original_name=authoritative_filename
```

`content_type`、`size_bytes`、`sha256` 和实际文件字节不得替换为模板信息。

- [ ] **Step 4: 在文件上传错误分支显示警告弹窗**

将 `StudentRuntimePage.uploadFile` 的错误分支改为：

```tsx
} catch (reason) {
  const message = reason instanceof Error ? reason.message : "文件上传失败";
  setNotice("");
  window.alert(message);
} finally {
  setBusyNodeId(null);
}
```

`setDrafts` 仍仅位于成功分支。错误分支不改变当前草稿，并清除弹窗背后的全局错误横幅。

### Task 5: 静态审计、提交与本地重启

**Files:**
- Verify: three modified backend files and `frontend/src/features/academic-flow/StudentRuntimePage.tsx`.

- [ ] **Step 1: 检查差异和调用链**

Run:

```bash
git diff --check
git diff -- backend/app/domain/workflow_runtime.py backend/app/repositories/flow_files.py backend/app/api/routes/student_flows.py frontend/src/features/academic-flow/StudentRuntimePage.tsx
rg -n "validate_template_filename|template_original_name|authoritative_filename" backend/app
```

Expected: 无空白错误；名称校验发生在上传文件读取和 OSS 写入之前；所有成功路径统一使用模板名称。

- [ ] **Step 2: 检查并清理项目缓存**

仅检查源码树，排除 `.venv` 和 `node_modules`：

```bash
find backend frontend -path '*/.venv' -prune -o -path '*/node_modules' -prune -o \( -name '.pytest_cache' -o -name '__pycache__' -o -name '*.egg-info' \) -print
```

若有输出，只删除列出的项目缓存目录；不得删除虚拟环境或用户文件。

- [ ] **Step 3: 只暂存计划内源码并创建完成提交**

```bash
git add backend/app/domain/workflow_runtime.py backend/app/repositories/flow_files.py backend/app/api/routes/student_flows.py frontend/src/features/academic-flow/StudentRuntimePage.tsx docs/superpowers/specs/2026-07-22-template-filename-upload-validation-design.md docs/superpowers/plans/2026-07-22-template-filename-upload-validation.md
git diff --cached --check
git diff --cached --name-only
git commit -m "fix: validate student template filenames on upload"
```

Expected: 完成提交只包含三个后端文件、一个前端文件和两份本功能文档。

- [ ] **Step 4: 本地重启服务**

停止当前确认占用 `127.0.0.1:8000` 和 `127.0.0.1:5173` 的开发进程，然后运行：

```bash
cd backend
.venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

```bash
cd frontend
npm run dev -- --host 127.0.0.1
```

不得使用 Docker。

- [ ] **Step 5: 仅检查服务可用性**

```bash
curl -s -o /dev/null -w 'backend:%{http_code}\n' http://127.0.0.1:8000/docs
curl -s -o /dev/null -w 'frontend:%{http_code}\n' http://127.0.0.1:5173/
```

Expected: 两项均为 HTTP 200。该检查不代表业务功能已经通过浏览器验证。

## User Manual Verification

实施完成后由用户手测：

1. 模板 `A.docx` 上传 `B.docx`，立即看到指定重命名提示。
2. 检测失败后刷新节点，原有尚未提交文件仍存在。
3. 上传 `A.DOCX` 可以通过，成功后显示名称为模板的 `A.docx`。
4. 上传 `a.docx` 和 `A .docx` 均被拒绝。
5. 无模板节点仍保留学生原文件名并正常上传。
