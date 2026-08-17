# Confirmation Scan Filename Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 阻止确认承诺节点提交名称不以模板主文件名开头的扫描件，确保全部文件名合规后才创建提交并进入审核。

**Architecture:** 后端领域层提供纯文件名校验函数，提交事务从发布版本模板绑定读取权威名称，并在创建 submission 和 audit job 前校验全部待提交扫描件。前端使用等价纯函数生成即时阻断提示，但后端始终作为最终约束层。

**Tech Stack:** Python 3.11、FastAPI、SQLite、React 18、TypeScript、Node.js 24.18.0。

## Global Constraints

- 仅影响配置 DOCX 模板并要求扫描件的确认承诺节点。
- 模板和扫描件名称先做 Unicode NFC 规范化，再执行区分大小写的严格前缀匹配。
- 扫描件主文件名允许等于模板主文件名，也允许在模板名后追加任意字符。
- 扫描件扩展名仍限定为 `.jpg`、`.jpeg` 或 `.png`，比较时扩展名不区分大小写。
- 任一文件名失败时不得创建 submission、audit job，不得关联扫描件或更新节点状态。
- 不在上传、替换、排序、删除或暂存阶段阻断。
- 不修改普通文件节点、审核脚本、节点解锁和下游推进语义。
- 依据项目 `AGENTS.md`，实施过程中只编写测试源和做业务逻辑审计，不执行测试、构建或浏览器自动化；计划中的测试命令仅供后续人工验证。
- 当前任务只允许实施前和完成后各一个任务范围提交，不创建中间提交。

---

### Task 1: 后端纯文件名规则

**Files:**
- Modify: `backend/tests/test_flow_runtime.py`
- Modify: `backend/app/domain/workflow_runtime.py`

**Interfaces:**
- Produces: `validate_confirmation_scan_filenames(uploaded_filenames: list[str], template_filename: str) -> None`
- Raises: `ValueError`，模板异常或首个扫描件不符合规则时携带面向学生的中文提示。

- [ ] **Step 1: 先写规则测试源**

在 `backend/tests/test_flow_runtime.py` 增加表格化用例，使用手工字面量覆盖：

```python
@pytest.mark.parametrize(
    "uploaded",
    ["安全责任书.jpg", "安全责任书第1页.png", "安全责任书(1).jpeg"],
)
def test_confirmation_scan_filename_accepts_template_prefix(uploaded: str) -> None:
    validate_confirmation_scan_filenames([uploaded], "安全责任书.docx")


@pytest.mark.parametrize("uploaded", ["我的安全责任书.jpg", "安全责任.jpg"])
def test_confirmation_scan_filename_rejects_wrong_prefix(uploaded: str) -> None:
    with pytest.raises(ValueError, match="请改为以“安全责任书”开头"):
        validate_confirmation_scan_filenames([uploaded], "安全责任书.docx")
```

另加一个多文件用例，确认列表中后续文件不合规时也会失败；增加 NFC 等价字符用例，确认规范化后匹配。

- [ ] **Step 2: 记录未来 RED 验证命令，本环境不执行**

```bash
cd backend
./.venv/bin/pytest tests/test_flow_runtime.py -k confirmation_scan_filename -v
```

预期在实现前因缺少 `validate_confirmation_scan_filenames` 而失败。

- [ ] **Step 3: 实现最小后端纯函数**

复用 `_normalized_filename()` 和 `_filename_identity()`：

```python
def validate_confirmation_scan_filenames(
    uploaded_filenames: list[str], template_filename: str
) -> None:
    template_stem, template_suffix = _filename_identity(template_filename)
    if not template_stem or template_suffix != ".docx":
        raise ValueError("当前节点模板配置异常，请联系教师")
    for uploaded_filename in uploaded_filenames:
        uploaded_stem, uploaded_suffix = _filename_identity(uploaded_filename)
        if uploaded_suffix not in {".jpg", ".jpeg", ".png"} or not uploaded_stem.startswith(template_stem):
            normalized = _normalized_filename(uploaded_filename)
            raise ValueError(
                f"文件“{normalized}”名称不符合要求，请改为以“{template_stem}”开头后重新上传。"
            )
```

- [ ] **Step 4: 静态核对规则**

人工核对模板扩展名、扫描扩展名、NFC 规范化、严格前缀、多文件短路和错误文案均由同一纯函数覆盖。

---

### Task 2: 后端提交事务强约束

**Files:**
- Modify: `backend/tests/test_flow_files_api.py`
- Modify: `backend/app/repositories/flow_templates.py`
- Modify: `backend/app/repositories/flow_instances.py:456-660`

**Interfaces:**
- Produces: `get_version_template_original_name(connection: Any, flow_version_id: str, node_key: str) -> str | None`
- Consumes: `validate_confirmation_scan_filenames(uploaded_filenames, template_filename)` from Task 1.

- [ ] **Step 1: 先写提交边界测试源**

在 `backend/tests/test_flow_files_api.py` 中建立真实 FastAPI/SQLite 确认承诺流程，沿现有 API 完成：教师创建流程、配置确认承诺、上传 DOCX 模板、导入名单、发布、学生进入、记录模板下载、上传扫描件、提交。

测试不合规的 `扫描件1.jpg` 提交后：

```python
assert response.status_code == 409
assert "请改为以“安全责任书”开头" in response.json()["detail"]
assert connection.execute(
    "SELECT COUNT(*) FROM submissions WHERE node_instance_id = ?", (node_id,)
).fetchone()[0] == 0
assert connection.execute(
    "SELECT COUNT(*) FROM audit_jobs WHERE node_instance_id = ?", (node_id,)
).fetchone()[0] == 0
assert connection.execute(
    "SELECT submission_id FROM uploaded_files WHERE node_instance_id = ?", (node_id,)
).fetchone()[0] is None
```

同一测试再以 `安全责任书第1页.jpg` 替换扫描件并提交，断言状态进入 `reviewing` 且 submission/audit job 各创建一条。

- [ ] **Step 2: 记录未来 RED 验证命令，本环境不执行**

```bash
cd backend
./.venv/bin/pytest tests/test_flow_files_api.py -k confirmation_scan_filename -v
```

预期不合规文件当前仍可进入审核，因而断言失败。

- [ ] **Step 3: 增加发布模板名称查询**

在 `flow_templates.py` 中增加只使用调用方事务连接的查询：

```python
def get_version_template_original_name(
    connection: Any, flow_version_id: str, node_key: str
) -> str | None:
    row = connection.execute(
        """
        SELECT a.original_name
        FROM flow_version_templates t
        JOIN flow_template_assets a ON a.id = t.template_asset_id
        WHERE t.flow_version_id = ? AND t.node_key = ?
        """,
        (flow_version_id, node_key),
    ).fetchone()
    return str(row["original_name"]) if row else None
```

- [ ] **Step 4: 在提交事务写入前执行校验**

在 `confirmation_requires_scans(node)` 分支中，取得 `uploaded_scans` 并确认非空后：

```python
template_filename = get_version_template_original_name(
    connection, str(row["flow_version_id"]), str(row["node_key"])
)
if template_filename is None:
    raise RuntimeConflictError("当前节点模板配置异常，请联系教师")
try:
    validate_confirmation_scan_filenames(
        [str(item["original_name"]) for item in uploaded_scans],
        template_filename,
    )
except ValueError as exc:
    raise RuntimeConflictError(str(exc)) from exc
```

代码位置必须早于 `attempt_no` 计算后的 submission 插入、文件关联、`create_audit_job()` 和节点状态更新。

- [ ] **Step 5: 审计事务副作用顺序**

确认失败分支发生在所有写入前；异常退出 `with get_connection()` 时事务回滚，待提交扫描件仍保持 `submission_id IS NULL`，节点仍可替换文件并重新提交。

---

### Task 3: 前端即时阻断提示

**Files:**
- Modify: `frontend/tests/scanUploadState.test.ts`
- Modify: `frontend/src/features/academic-flow/ScanUploadWorkspace.tsx`
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx:483-499`

**Interfaces:**
- Changes: `getScanSubmitBlocker()` input adds `templateFilename: string | null`.
- Consumes: `runtime.template?.originalName` and `RuntimeScanFile.originalName`.

- [ ] **Step 1: 先写前端规则测试源**

扩展测试基线输入：

```typescript
const base = {
  confirmed: true,
  scanRequired: true,
  scans: [scan("安全责任书第1页.jpg")],
  templateDownloaded: true,
  templateFilename: "安全责任书.docx",
  uploading: false,
};
```

断言 `安全责任书.jpg`、`安全责任书第1页.png` 返回 `null`；`扫描件1.jpg` 返回包含文件名和 `安全责任书` 的提示；两张扫描件中第二张不合规时仍返回阻断提示；`scanRequired: false` 继续返回 `null`。

- [ ] **Step 2: 记录未来 RED 验证命令，本环境不执行**

```bash
cd frontend
export PATH="$PWD/../.local/node/bin:$PATH"
npm test -- scanUploadState.test.ts
```

预期实现前因为输入接口和文件名分支缺失而失败。

- [ ] **Step 3: 扩展纯阻断函数**

在既有模板下载、确认、上传中和空列表检查之后，规范化模板名称及每个扫描件名称，并返回与后端一致的首个错误：

```typescript
const templateStem = getFilenameIdentity(input.templateFilename).stem;
const invalid = input.scans.find(({ originalName }) => {
  const scan = getFilenameIdentity(originalName);
  return ![".jpg", ".jpeg", ".png"].includes(scan.suffix)
    || !scan.stem.startsWith(templateStem);
});
```

文件名解析只取路径末段、去除最后一个扩展名并调用 `.normalize("NFC")`，不自动修改学生文件名。

- [ ] **Step 4: 从运行实例传入模板名称**

在 `StudentRuntimePage.tsx` 调用 `getScanSubmitBlocker()` 时增加：

```typescript
templateFilename: runtime.template?.originalName ?? null,
```

沿用现有 `submitDisabled` 和按钮下 `<small>{scanBlocker}</small>`，不新增视觉体系或弹窗。

- [ ] **Step 5: 审计前后端规则一致性**

逐项比较模板扩展名、扫描扩展名、NFC、大小写、前缀、多文件和错误提示；确认前端只改善反馈，后端仍独立读取发布模板绑定并强制校验。

---

### Task 4: 收尾与运行环境恢复

**Files:**
- Review: `docs/superpowers/specs/2026-08-17-confirmation-scan-filename-design.md`
- Review: 本计划列出的全部源文件。

- [ ] **Step 1: 静态检查**

执行 `git diff --check`，搜索旧调用签名和未传入的 `templateFilename`；人工核对所有后端提交路径均经过同一事务分支。不得将此结果表述为测试或运行时验证。

- [ ] **Step 2: 清理限定缓存**

仅清理项目源码范围内新产生的 `.pytest_cache`、`__pycache__` 和 `*.egg-info`，不得清理 `.venv`、`node_modules` 或用户文件。

- [ ] **Step 3: 创建任务结果检查点**

只暂存本计划列出的任务文件和设计/计划文档，避免夹带现有工作树中的其他用户改动；若 `.git` 只读，则记录环境限制并保留工作树。

- [ ] **Step 4: 本地重启并核对进程**

仅终止已确认属于本项目并监听 8000/5173 的 Uvicorn/Vite 进程。后端从 `backend/` 启动；前端使用项目 `.local/node/bin`，然后复核两端口监听和进程工作目录。

- [ ] **Step 5: 明确验证边界**

交付时列出静态检查与服务监听结果，并明确说明依据项目规范未运行测试、构建或浏览器自动化。
