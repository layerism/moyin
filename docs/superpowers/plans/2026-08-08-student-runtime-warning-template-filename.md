# Student Runtime Warning and Template Filename Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许学生使用“模板主名 + 可为空任意后缀 + `.docx`”上传文件，并把学生端节点操作失败统一展示为项目风格警告弹窗。

**Architecture:** 后端继续以 `validate_template_filename()` 作为唯一模板文件名校验入口，将完全相等判断改为规范化后的主名前缀判断，并返回学生实际文件名供 OSS、数据库、草稿和审核链路使用。前端在 `StudentRuntimePage.tsx` 内提取轻量 `RuntimeWarningDialog`，由页面级 `actionWarning` 和节点级 `uploadWarning` 共同复用，成功与进度信息继续走现有 `notice`。

**Tech Stack:** Python 3.11、FastAPI、React、TypeScript、CSS、SQLite、Aliyun OSS。

## Global Constraints

- 学生文件名必须符合 `<template_stem><optional_suffix>.docx`，其中 `<optional_suffix>` 可以为空。
- 模板主名必须完整位于学生文件主名开头；模板主名大小写敏感，`.docx` 扩展名大小写不敏感。
- 比较前清除客户端路径、去除文件名前后空白并执行 Unicode NFC 规范化。
- 上传成功后保留学生实际文件名，不改写为模板原名。
- 校验必须发生在完整文件读取、哈希计算和 OSS 写入之前。
- 校验失败不得修改 OSS、数据库、草稿、节点状态或旧上传文件。
- 暂存、提交、重新审核和模板下载失败使用确认式警告弹窗；成功、进度和后台状态刷新失败继续使用页内提示。
- 不新增数据库字段、API 响应字段、第三方依赖或独立组件目录。
- 无模板节点、历史上传文件和初次页面加载失败行为保持不变。
- 保护用户已有的 `AGENTS.md`、`docs/05_oa_graph.md` 和 `.superpowers/` 工作树内容。
- 按项目约定不运行自动化测试、构建或浏览器测试；只执行静态业务审计并交由用户手测。
- 当前 `e454428` 为实施前设计检查点；全部代码完成后只创建一次完成提交，中间不提交。

---

## File Map

- Modify: `backend/app/domain/workflow_runtime.py` — 规范化文件名、校验模板主名前缀并返回学生实际文件名。
- Modify: `backend/app/api/routes/student_flows.py` — 将学生实际文件名传入后续元数据、OSS 和审核链路。
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx` — 增加页面级操作警告状态并提取复用警告弹窗。
- Modify: `frontend/src/styles.css` — 将上传专用警告选择器泛化为运行时警告选择器，视觉不变。
- Create: `docs/superpowers/plans/2026-08-08-student-runtime-warning-template-filename.md` — 本实施计划。

### Task 1: 放宽模板文件名校验并保留学生文件名

**Files:**
- Modify: `backend/app/domain/workflow_runtime.py:105-117`
- Modify: `backend/app/api/routes/student_flows.py:111-160`

**Interfaces:**
- Produces: `validate_template_filename(uploaded_filename: str, template_filename: str) -> str`。
- Returns: 规范化且已去除客户端路径的学生实际文件名。
- Raises: 不匹配时抛出 `ValueError("文件名必须以“<模板主名>”开头，并使用 .docx 格式。")`。
- Preserves: `upload_node_file()` 的权限、文件大小、哈希、OSS 补偿和旧对象删除逻辑。

- [ ] **Step 1: 将文件名规范化集中为单一函数**

在 `workflow_runtime.py` 中把 `_filename_identity()` 改为复用 `_normalized_filename()`：

```python
def _normalized_filename(value: str) -> str:
    filename = PurePosixPath(str(value).replace("\\", "/")).name.strip()
    return unicodedata.normalize("NFC", filename)


def _filename_identity(value: str) -> tuple[str, str]:
    path = PurePosixPath(_normalized_filename(value))
    return path.stem, path.suffix.lower()
```

- [ ] **Step 2: 将完全相等判断改为模板主名前缀判断**

用以下逻辑替换 `validate_template_filename()`：

```python
def validate_template_filename(uploaded_filename: str, template_filename: str) -> str:
    uploaded_stem, uploaded_suffix = _filename_identity(uploaded_filename)
    template_stem, template_suffix = _filename_identity(template_filename)
    if not template_stem or template_suffix != ".docx":
        raise ValueError("当前节点模板配置异常，请联系教师")
    if uploaded_suffix != ".docx" or not uploaded_stem.startswith(template_stem):
        raise ValueError(
            f"文件名必须以“{template_stem}”开头，并使用 .docx 格式。"
        )
    return _normalized_filename(uploaded_filename)
```

该实现必须满足：

```text
模板：个人承诺书.docx
通过：个人承诺书.docx
通过：个人承诺书-张三.docx
通过：个人承诺书_2020208764417.DOCX
拒绝：张三-个人承诺书.docx
拒绝：个人承诺.docx
拒绝：个人承诺书-张三.pdf
```

- [ ] **Step 3: 让上传路由继续使用函数返回值作为权威名称**

保留现有调用结构：

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

确认以下三处继续使用 `authoritative_filename`：

```python
validate_file_metadata(context.config_node, authoritative_filename, size_bytes)
timestamped_object_name(authoritative_filename, sha256)
original_name=authoritative_filename
```

不得把 `authoritative_filename` 改回 `context.template_original_name`。

- [ ] **Step 4: 静态检查后端执行顺序**

Run:

```bash
git diff --check -- backend/app/domain/workflow_runtime.py backend/app/api/routes/student_flows.py
rg -n "validate_template_filename|authoritative_filename|file\.file\.read|put_object" backend/app/domain/workflow_runtime.py backend/app/api/routes/student_flows.py
```

Expected:

- `validate_template_filename()` 返回 `_normalized_filename(uploaded_filename)`；
- 空模板主名或非 `.docx` 模板返回配置错误，不退化为任意文件前缀；
- 模板名称校验位于 `file.file.read()` 和 `put_object()` 之前；
- OSS 对象键和 `uploaded_files.original_name` 使用学生实际文件名；
- 无空白错误。

### Task 2: 将节点操作失败接入通用警告弹窗

**Files:**
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx:30-330,370-654`
- Modify: `frontend/src/styles.css:4174-4265`

**Interfaces:**
- Produces: `RuntimeWarningDialog({ category, idPrefix, message, onClose, title })`。
- Consumes: 页面级 `actionWarning: string` 与节点级 `uploadWarning: string`。
- Preserves: `notice` 继续承载成功、进度和后台审核状态刷新失败信息。

- [ ] **Step 1: 增加页面级操作警告状态**

在 `StudentRuntimePage` 的其他状态旁增加：

```tsx
const [actionWarning, setActionWarning] = useState("");
```

每次开始暂存、提交、重新审核或模板下载时先调用：

```tsx
setActionWarning("");
```

- [ ] **Step 2: 将指定操作的失败分支改为警告弹窗状态**

将四个操作的 `catch` 分支改为显式写入 `actionWarning`：

```tsx
setActionWarning(reason instanceof Error ? reason.message : "暂存失败");
```

```tsx
setActionWarning(reason instanceof Error ? reason.message : "提交失败");
```

```tsx
setActionWarning(reason instanceof Error ? reason.message : "重新审核失败");
```

```tsx
setActionWarning(reason instanceof Error ? reason.message : "模板下载失败");
```

提交失败时继续保留现有 `ApiError.fieldErrors` 写入逻辑；弹窗关闭后字段错误仍在表单中显示。不得修改上传错误的异常上抛链路。

- [ ] **Step 3: 提取同文件内通用警告组件**

在 `RuntimeNodeDialog` 之后、`ReadonlySubmission` 之前增加：

```tsx
function RuntimeWarningDialog({
  category,
  idPrefix,
  message,
  onClose,
  title,
}: {
  category: string;
  idPrefix: string;
  message: string;
  onClose: () => void;
  title: string;
}) {
  const messageId = `${idPrefix}-message`;
  const titleId = `${idPrefix}-title`;
  return (
    <div
      className="runtime-warning-backdrop"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <section
        aria-describedby={messageId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="runtime-warning-dialog"
        role="alertdialog"
      >
        <span aria-hidden="true" className="runtime-warning-icon">
          <svg fill="none" viewBox="0 0 24 24">
            <path d="M12 8v5" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
            <path d="M12 16.5h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
            <path d="M10.3 4.4 3.2 17a2 2 0 0 0 1.75 3h14.1a2 2 0 0 0 1.75-3L13.7 4.4a1.95 1.95 0 0 0-3.4 0Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
          </svg>
        </span>
        <div className="runtime-warning-copy">
          <span>{category}</span>
          <h3 id={titleId}>{title}</h3>
          <p id={messageId}>{message}</p>
        </div>
        <footer>
          <button autoFocus onClick={onClose} type="button">我知道了</button>
        </footer>
      </section>
    </div>
  );
}
```

该组件不得给遮罩增加关闭回调。

- [ ] **Step 4: 用通用组件替换上传警告重复 JSX**

将 `RuntimeNodeDialog` 末尾的上传警告块替换为：

```tsx
{uploadWarning ? (
  <RuntimeWarningDialog
    category="文件校验"
    idPrefix="runtime-upload-warning"
    message={uploadWarning}
    onClose={() => setUploadWarning("")}
    title="文件上传未通过"
  />
) : null}
```

组件仍位于 `.runtime-node-dialog-backdrop` 内，使警告关闭后底层节点窗口保持打开。

- [ ] **Step 5: 在页面根部渲染操作警告**

在 `StudentRuntimePage` 返回结构中、节点窗口之后增加：

```tsx
{actionWarning ? (
  <RuntimeWarningDialog
    category="操作提示"
    idPrefix="runtime-action-warning"
    message={actionWarning}
    onClose={() => setActionWarning("")}
    title="操作未完成"
  />
) : null}
```

不得把首次加载失败、成功提示、上传进度或后台审核刷新失败改为 `actionWarning`。

- [ ] **Step 6: 泛化现有 CSS 选择器但保持视觉值不变**

在 `styles.css` 中执行以下一一改名，不修改声明内容：

```text
.runtime-upload-warning-backdrop       -> .runtime-warning-backdrop
.runtime-upload-warning-dialog         -> .runtime-warning-dialog
.runtime-upload-warning-icon           -> .runtime-warning-icon
.runtime-upload-warning-copy           -> .runtime-warning-copy
```

同步修改这些选择器的 `svg`、`> span`、`h3`、`p`、`footer`、`button`、`:hover` 和 `:focus-visible` 后代规则。不得保留旧选择器或复制整段 CSS。

- [ ] **Step 7: 静态检查前端消息分流和弹窗隔离**

Run:

```bash
git diff --check -- frontend/src/features/academic-flow/StudentRuntimePage.tsx frontend/src/styles.css
rg -n "actionWarning|uploadWarning|RuntimeWarningDialog|setNotice\(|runtime-warning" frontend/src/features/academic-flow/StudentRuntimePage.tsx frontend/src/styles.css
rg -n "runtime-upload-warning-(backdrop|dialog|icon|copy)" frontend/src || true
```

Expected:

- 四类操作失败进入 `actionWarning`；
- 上传失败仍进入 `uploadWarning`；
- 成功、进度、轮询失败和初次加载失败仍进入 `notice`；
- 两类警告共用唯一 `RuntimeWarningDialog`；
- 警告遮罩没有点击关闭逻辑；
- 旧上传专用 CSS 类不存在；
- 无空白错误。

### Task 3: 完整静态审计、清理、完成提交和本地重启

**Files:**
- Verify: `backend/app/domain/workflow_runtime.py`
- Verify: `backend/app/api/routes/student_flows.py`
- Verify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx`
- Verify: `frontend/src/styles.css`
- Verify: `docs/superpowers/specs/2026-08-08-student-runtime-warning-template-filename-design.md`
- Verify: `docs/superpowers/plans/2026-08-08-student-runtime-warning-template-filename.md`

**Interfaces:**
- Consumes: Tasks 1-2 的后端文件名规则和前端通用警告组件。
- Produces: 一次完成提交和可供用户手测的本地 FastAPI/Vite 服务。

- [ ] **Step 1: 对照设计文档审计全部差异**

Run:

```bash
git diff --check
git diff -- backend/app/domain/workflow_runtime.py backend/app/api/routes/student_flows.py frontend/src/features/academic-flow/StudentRuntimePage.tsx frontend/src/styles.css docs/superpowers/plans/2026-08-08-student-runtime-warning-template-filename.md
rg -n "return template_filename|文件名与模板不一致|请将文件重命名" backend/app frontend/src || true
```

Expected:

- 没有空白错误；
- 不再返回模板原名或显示“必须完全重命名”的旧文案；
- 差异仅覆盖本计划文件；
- 未修改数据库模型、迁移、API 类型或其他页面。

- [ ] **Step 2: 清理项目生成缓存**

只清理项目自身缓存，不递归触碰 `backend/.venv` 或 `frontend/node_modules`：

```bash
find backend -path backend/.venv -prune -o -type d \( -name __pycache__ -o -name .pytest_cache -o -name '*.egg-info' \) -prune -exec rm -rf {} +
find frontend -path frontend/node_modules -prune -o -type d \( -name .pytest_cache -o -name '*.egg-info' \) -prune -exec rm -rf {} +
```

Expected: 项目生成缓存被清除，依赖目录保持不变。

- [ ] **Step 3: 创建唯一完成提交**

仅暂存本计划范围文件：

```bash
git add \
  backend/app/domain/workflow_runtime.py \
  backend/app/api/routes/student_flows.py \
  frontend/src/features/academic-flow/StudentRuntimePage.tsx \
  frontend/src/styles.css \
  docs/superpowers/plans/2026-08-08-student-runtime-warning-template-filename.md
git diff --cached --check
git commit -m "fix: improve student file warnings and filename matching"
```

不得暂存 `AGENTS.md`、`docs/05_oa_graph.md` 或 `.superpowers/`。

- [ ] **Step 4: 重启本地非 Docker 服务**

停止当前占用 8000 和 5173 端口的本项目进程，然后分别启动：

```bash
cd backend
./.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

```bash
cd frontend
npm run dev
```

不得使用 Docker，不启动第二组重复服务。

- [ ] **Step 5: 仅做服务可用性检查**

Run:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5173/
curl -s -o /tmp/student-runtime-health.json -w '%{http_code}\n' http://127.0.0.1:8000/api/health
```

Expected: 前端和后端均返回 HTTP 200；后端健康响应为 `{"status":"ok"}`。这只证明服务可访问，不等同于自动化或浏览器验收。

- [ ] **Step 6: 用户手测交付说明**

交付时明确说明未运行自动化测试、构建或浏览器测试，并建议用户手测：

```text
1. 模板原名上传成功。
2. 模板主名后追加中文、学号或符号后缀的 .docx 上传成功并保留实际名称。
3. 错误前缀或非 .docx 文件弹出“文件上传未通过”。
4. 制造“文件不存在、已提交或不属于当前节点”后弹出“操作未完成”。
5. 关闭警告后节点窗口、草稿和已上传文件保持不变。
6. 成功和进度提示仍显示在页面内。
```
