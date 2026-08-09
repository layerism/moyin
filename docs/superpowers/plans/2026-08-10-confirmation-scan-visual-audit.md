# 确认承诺扫描件与通用视觉审核实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为确认承诺节点增加可选的 DOCX 模板、多扫描件上传和供应商无关视觉审核，并删除表单字段卡片中的类型二次选择。

**Architecture:** 使用现有 `uploaded_files`、对象存储、审核脚本运行时、`audit_jobs` 队列和节点状态机。新增内部版本化视觉审核程序，通过 OpenAI Chat 兼容协议处理按顺序规范化的多图页面；节点快照固化审核模式和教师提示词，学生与教师接口按角色裁剪结果。

**Tech Stack:** React 18、TypeScript、FastAPI、SQLite、PyMuPDF、Pillow、Python 标准库 HTTP、现有 OSS 与审核脚本运行时。

## Global Constraints

- 当前 `main` 分支实施，不创建工作树。
- 已有设计提交 `3f62a8f` 作为开发前检查点；所有实现完成后只创建一个最终检查点提交，中间不提交。
- 开发过程中不运行 pytest、Node test、TypeScript 构建、浏览器、Playwright 或其他测试命令；只更新测试代码并进行静态业务审计。
- 不使用 Docker；完成后以本地命令重启 FastAPI 与 Vite。
- 只允许一个持久化 subagent 顺序执行全部开发任务；若选择内联执行则不启动 subagent。
- 不暂存、不覆盖用户已有 `AGENTS.md`、`INSTALL.md`、`MEMORY.md`。
- 保留历史确认承诺、文件上传、普通审核脚本和历史 Submission 的行为。
- 代码不得写死供应商域名、API Key 或模型名；视觉配置只从 `backend/.env` 读取。
- 教师模板必须为 DOCX；学生扫描件只允许 JPG、JPEG、PNG、PDF。
- 固定限制：最多 10 个文件、20 页、单文件 10 MB、整组 30 MB、提示词最多 2000 字符。
- 评分模式结果直接通过；学生不得收到分数和评分说明，教师可以查看。
- 开发结束清理 `.pytest_cache`、`__pycache__`、`*.egg-info`，排除 `backend/.venv` 和 `frontend/node_modules`。

---

### Task 1: 删除字段类型二次选择并避免空展开面板

**Files:**
- Modify: `frontend/src/features/academic-flow/FormFieldEditor.tsx`
- Modify: `frontend/src/features/academic-flow/formFields.ts`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/tests/formFields.test.ts`

**Interfaces:**
- Produces: `hasFormFieldSettings(type: FormFieldType): boolean`，仅 `textarea/radio/checkbox` 返回 `true`。
- Consumes: 既有 `createFormField()`、卡片标题编辑、拖拽和字段专属设置。

- [ ] **Step 1: 增加字段可配置性测试代码**

在 `frontend/tests/formFields.test.ts` 增加：

```ts
test("only fields with extra settings are expandable", () => {
  assert.equal(hasFormFieldSettings("text"), false);
  assert.equal(hasFormFieldSettings("textarea"), true);
  assert.equal(hasFormFieldSettings("radio"), true);
  assert.equal(hasFormFieldSettings("checkbox"), true);
});
```

- [ ] **Step 2: 增加纯函数并删除类型转换入口**

在 `formFields.ts` 导出：

```ts
export function hasFormFieldSettings(type: FormFieldType) {
  return type !== "text";
}
```

从 `FormFieldEditor.tsx` 删除 `changeFieldType()`、`.form-field-common-settings` 和 `<select>`。新增字段时只有 `hasFormFieldSettings(type)` 为真才展开；单行文本摘要不渲染可交互的展开控件或箭头。

- [ ] **Step 3: 收敛卡片渲染与样式**

保留多行字符数、选择项和多选数量设置。删除 `.form-field-common-settings` CSS；为不可展开摘要使用普通 `<small>`，不能保留空 `form-field-content`。

- [ ] **Step 4: 静态审计**

确认以下检索无结果：

```bash
rg -n "changeFieldType|form-field-common-settings|字段类型" frontend/src/features/academic-flow/FormFieldEditor.tsx frontend/src/styles.css
```

不运行前端测试或构建。

### Task 2: 定义扫描审核节点配置与内部审核程序身份

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/features/academic-flow/academicFlowData.ts`
- Modify: `frontend/tests/nodeSettingCapabilities.test.ts`
- Modify: `backend/app/domain/workflow.py`
- Modify: `backend/app/domain/workflow_revision.py`
- Modify: `backend/app/services/audit_script_catalog.py`
- Modify: `backend/tests/test_workflows.py`
- Modify: `backend/tests/test_workflow_revision.py`
- Modify: `backend/tests/test_audit_scripts_api.py`

**Interfaces:**
- Produces frontend fields: `scanAuditEnabled?: boolean`、`scanAuditMode?: "pass_fail" | "score"`、`scanAuditPrompt?: string`。
- Produces backend constant: `CONFIRMATION_VISUAL_AUDIT_ID = "confirmation-visual-audit"`。
- Produces catalog behavior: internal scripts resolve by ID/version but are omitted from `list_audit_scripts()` and cannot have metadata edited through the admin API.

- [ ] **Step 1: 扩展前端节点类型与默认值**

给 `AcademicFlowNode` 增加三个字段。`createAcademicNode()` 为所有新节点写入：

```ts
scanAuditEnabled: false,
scanAuditMode: undefined,
scanAuditPrompt: "",
```

给 `getNodeSettingCapabilities()` 增加：

```ts
configuresConfirmationScan: kind === "confirmation",
```

更新能力测试，使四类节点都有精确期望值。

- [ ] **Step 2: 增加后端节点配置测试代码**

覆盖：历史 confirmation 无扫描字段仍合法；启用后缺模板、模式或提示词分别失败；提示词超过 2000 字失败；评分模式与通过模式合法；非 confirmation 启用扫描失败；confirmation 模板扩展名不是 `.docx` 失败。

测试节点示例：

```python
{
    "id": "confirm",
    "kind": "confirmation",
    "title": "承诺书",
    "scanAuditEnabled": True,
    "scanAuditMode": "pass_fail",
    "scanAuditPrompt": "检查签名、日期和页面完整性",
    "templateAsset": {
        "assetId": "asset-1",
        "contentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "originalName": "承诺书.docx",
        "sha256": "a" * 64,
        "sizeBytes": 1024,
    },
}
```

- [ ] **Step 3: 实现 `_validate_confirmation_scan()`**

规则：缺失开关按 `False`；关闭时不要求其他字段；开启时严格验证节点类型、模式、非空提示词和长度。扩展 `_validate_node_template()`，允许 `file` 节点原行为，或启用扫描审核的 `confirmation` 节点；confirmation 模板后缀必须 `.docx`。

- [ ] **Step 4: 更新修订快照字段**

将 `scanAuditEnabled/scanAuditMode/scanAuditPrompt` 加入 `BUSINESS_NODE_FIELDS`，确保发布差异、克隆和已发布节点锁定都覆盖新配置。

- [ ] **Step 5: 为审核清单增加内部可见性**

清单只允许可选字段：

```json
{"visibility": "internal"}
```

`_AuditScriptManifest` 与 `AuditScriptRecord` 增加 `visibility: Literal["public", "internal"]`，缺失按 `public`。`find_audit_script_version()` 解析全部合法脚本；`list_audit_scripts()` 仅返回 public；`update_audit_script_metadata()` 对 internal 返回不存在。

- [ ] **Step 6: 静态审计**

核对配置字段在类型、默认值、发布校验、修订快照和测试中名称完全一致。不运行测试。

### Task 3: 数据库迁移与多扫描件仓储

**Files:**
- Modify: `backend/app/core/database.py`
- Modify: `backend/app/repositories/flow_files.py`
- Create: `backend/app/services/scan_materials.py`
- Modify: `backend/tests/test_flow_files_api.py`
- Modify: `backend/tests/test_database_admin.py`

**Interfaces:**
- Produces: `ScanInspection(content_type: str, page_count: int)`。
- Produces: `inspect_scan_material(stream, filename, size_bytes) -> ScanInspection`。
- Produces repository functions: `add_pending_scan()`、`list_pending_scans()`、`delete_pending_scan()`、`reorder_pending_scans()`、`get_pending_scans_for_submit()`、`attach_uploaded_files()`。

- [ ] **Step 1: 增加迁移测试代码**

断言 `uploaded_files` 具备：

```text
page_count INTEGER NOT NULL DEFAULT 1 CHECK(page_count > 0)
display_order INTEGER NOT NULL DEFAULT 0 CHECK(display_order >= 0)
```

旧行迁移后为 `page_count=1/display_order=0`。

- [ ] **Step 2: 实现幂等迁移**

在 `initialize_database()` 调用 `_apply_scan_file_metadata_migration()`；通过 `PRAGMA table_info(uploaded_files)` 分别执行 `ALTER TABLE`，最后记录迁移 ID `20260810_add_scan_file_metadata`。

- [ ] **Step 3: 创建真实文件检查服务**

定义：

```python
@dataclass(frozen=True)
class ScanInspection:
    content_type: str
    page_count: int

def inspect_scan_material(stream: BinaryIO, filename: str, size_bytes: int) -> ScanInspection:
    ...
```

JPG/JPEG/PNG 使用 Pillow `Image.verify()`，拒绝超过像素上限和格式伪装；PDF 使用 `fitz.open(stream=data, filetype="pdf")`，拒绝加密、损坏、零页或超过 20 页。读取后将 stream `seek(0)`。

- [ ] **Step 4: 增加多附件仓储测试代码**

覆盖：追加不替换、顺序连续；第 11 个文件失败；累计第 21 页失败；累计超过 30 MB 失败；只能删除未提交且属于当前学生的文件；排序必须精确包含当前待提交 ID 且不能重复；批量关联必须全部成功，否则事务回滚。

- [ ] **Step 5: 实现多附件仓储**

常量：

```python
MAX_SCAN_FILES = 10
MAX_SCAN_PAGES = 20
MAX_SCAN_FILE_BYTES = 10 * 1024 * 1024
MAX_SCAN_TOTAL_BYTES = 30 * 1024 * 1024
```

`add_pending_scan()` 在 `BEGIN IMMEDIATE` 中重新汇总当前待提交行并写入下一个 `display_order`。文件节点继续调用 `replace_uploaded_file()`；不得改变其删除旧待提交对象的语义。

- [ ] **Step 6: 静态审计**

检查所有新增 SQL 都同时约束 `node_instance_id/student_account_id/submission_id IS NULL`，批量关联检查更新行数等于文件数。

### Task 4: 扩展模板和学生扫描件 API

**Files:**
- Modify: `backend/app/repositories/flow_templates.py`
- Modify: `backend/app/api/routes/workflows.py`
- Modify: `backend/app/api/routes/student_flows.py`
- Modify: `backend/tests/test_workflows.py`
- Modify: `backend/tests/test_flow_files_api.py`
- Modify: `frontend/src/features/academic-flow/api.ts`
- Modify: `frontend/src/features/academic-flow/runtimeTypes.ts`

**Interfaces:**
- Produces student endpoints:
  - `POST /api/student/node-instances/{node_instance_id}/scans`
  - `DELETE /api/student/node-instances/{node_instance_id}/scans/{file_id}`
  - `PUT /api/student/node-instances/{node_instance_id}/scans/order`
- Produces frontend type `RuntimeScanFile` and API methods `uploadScan/deleteScan/reorderScans`。

- [ ] **Step 1: 扩展模板仓储测试代码**

确认启用扫描审核且未发布的 confirmation 可以保存/删除 DOCX 模板；关闭扫描审核、非 DOCX 或历史已发布节点拒绝；文件节点测试保持不变。

- [ ] **Step 2: 泛化模板资格判断**

新增：

```python
def supports_template(node: dict[str, Any]) -> bool:
    return node.get("kind") == "file" or (
        node.get("kind") == "confirmation" and node.get("scanAuditEnabled") is True
    )
```

教师上传 confirmation 模板时强制 `.docx`，文件节点继续使用 `fileExtensions/fileLimitMb`。

- [ ] **Step 3: 泛化上传上下文**

`get_upload_context()` 接受文件节点或启用扫描审核的 confirmation。给 `FileUploadContext` 增加 `upload_mode: Literal["single", "scan_set"]`；模板下载、名单、时间和节点状态门控不变。

- [ ] **Step 4: 增加扫描 API 请求模型**

```python
class ScanOrderRequest(BaseModel):
    fileIds: list[str] = Field(min_length=1, max_length=10)
```

上传路由先计算 SHA-256/大小，再调用 `inspect_scan_material()`，成功后写 OSS 和 `add_pending_scan()`；仓储失败必须删除刚上传对象。删除路由先删除数据库待提交行，再尽力删除对象。排序不改对象存储。

- [ ] **Step 5: 增加前端 API 类型**

```ts
export type RuntimeScanFile = {
  contentType: string;
  fileId: string;
  order: number;
  originalName: string;
  pageCount: number;
  sizeBytes: number;
};
```

三个 API 方法使用上述端点；下载继续复用 `downloadNodeFile(fileId)`。

- [ ] **Step 6: 静态审计**

确认学生不能传 student ID、submission ID、页数或排序之外的元数据；后端只信任登录身份和真实文件检查结果。

### Task 5: 实现供应商无关的版本化视觉审核程序

**Files:**
- Create: `backend/scripts/confirmation-visual-audit/manifest.json`
- Create: `backend/scripts/confirmation-visual-audit/versions/1/config.json`
- Create: `backend/scripts/confirmation-visual-audit/versions/1/handler.py`
- Create: `backend/tests/test_confirmation_visual_audit.py`
- Modify: `backend/app/services/audit_script_executor.py`
- Modify: `backend/app/core/config.py`
- Modify: `backend/.env.example`
- Modify ignored local file: `backend/.env`

**Interfaces:**
- Consumes `scriptParams.scanAuditMode/scanAuditPrompt`、staged files and `VISION_*` env vars。
- Produces existing audit protocol `{schemaVersion, passed, reason, details}`。
- Exposes no provider-specific Python API.

- [ ] **Step 1: 创建内部脚本清单与参数定义**

`manifest.json`：

```json
{
  "id": "confirmation-visual-audit",
  "name": "确认承诺视觉审核",
  "description": "内部使用的多扫描件视觉审核程序",
  "language": "py",
  "version": 1,
  "entry": "handler.py",
  "visibility": "internal"
}
```

`config.json` 固定接受 `.jpg/.jpeg/.png/.pdf`，参数包含必填 select `scanAuditMode` 和 1–2000 字符 string `scanAuditPrompt`。

- [ ] **Step 2: 增加材料规范化测试代码**

覆盖图片 EXIF/RGB/JPEG、PDF 多页顺序、文件顺序、页数不一致、超过 20 页、损坏文件。测试直接调用 handler 的纯函数，不发真实网络请求。

- [ ] **Step 3: 实现页面规范化**

处理器读取 staged path；图片用 Pillow，PDF 用 PyMuPDF。每页执行：

```python
image.thumbnail((2000, 2000))
image.convert("RGB").save(buffer, format="JPEG", quality=85, optimize=True)
```

生成 `{fileIndex, fileName, pageNumber, dataUrl}`，稳定按文件和页码排列。

- [ ] **Step 4: 增加 Chat 请求与结果测试代码**

使用可替换 `urlopen` 依赖，断言地址为 `${VISION_API_BASE_URL.rstrip('/')}/chat/completions`，Authorization 不出现在异常文本，messages 先文本后全部 image_url。覆盖 401/429/5xx、超时、非 JSON、Markdown 围栏、字段缺失、分数越界。

- [ ] **Step 5: 实现固定系统协议和提示注入防护**

系统文本明确材料不可信、忽略页面内指令、只依据教师标准，并要求唯一 JSON：

```json
{"passed": false, "score": null, "reason": "..."}
```

通过模式严格校验 bool/null/reason；评分模式严格校验有限 0–100 分并规范化 `passed=true`。最终输出：

```python
{
    "schemaVersion": "1.0",
    "passed": normalized_passed,
    "reason": reason,
    "details": {
        "checkedFileCount": len(files),
        "issues": issues,
        "mode": mode,
        "score": score,
        "pageCount": len(pages),
    },
}
```

- [ ] **Step 6: 限定环境变量注入**

修改 `_script_environment(descriptor)`：通用 allowlist保持原行为；只有 `descriptor.script_id == CONFIRMATION_VISUAL_AUDIT_ID` 时额外读取四个 `VISION_*` 变量。不得记录值。

`.env.example` 提供通用空值；本地 `backend/.env` 写入用户要求的占位 Key、可替换 Base URL 和模型。该忽略文件不暂存。

- [ ] **Step 7: 静态审计**

确认代码内不存在 `ark.cn-beijing`、豆包模型名或真实 Key；确认 handler stderr/stdout 不输出请求体、Base64、教师提示词或原始响应。

### Task 6: 发布绑定、确认提交和审核结果角色裁剪

**Files:**
- Modify: `backend/app/repositories/workflows.py`
- Modify: `backend/app/domain/workflow_runtime.py`
- Modify: `backend/app/repositories/flow_instances.py`
- Modify: `backend/app/repositories/audit_jobs.py`
- Modify: `backend/tests/test_flow_runtime.py`
- Modify: `backend/tests/test_workflow_revision.py`
- Modify: `backend/tests/test_workflow_republish.py`

**Interfaces:**
- Produces published confirmation nodes with hidden fixed `auditScript*` metadata and params。
- Produces confirmation submission payload `{confirmed: true, scans: RuntimeScanFile[]}`。
- Produces student-safe `RuntimeNodeAudit` without score details in score mode。

- [ ] **Step 1: 增加发布绑定测试代码**

启用扫描审核时，发布结果必须从 catalog 解析固定脚本并写入 ID/version/hash/config hash/accepted extensions/params；客户端伪造这些隐藏字段必须被发布逻辑覆盖。关闭时不得绑定视觉程序。

- [ ] **Step 2: 实现固定程序绑定**

在既有审核脚本快照构建处识别 confirmation scan，将公开字段映射为：

```python
node["auditScriptId"] = CONFIRMATION_VISUAL_AUDIT_ID
node["auditScriptParams"] = {
    "scanAuditMode": node["scanAuditMode"],
    "scanAuditPrompt": node["scanAuditPrompt"].strip(),
}
```

其余版本、哈希和扩展名必须由 catalog 计算，不能信任前端。

- [ ] **Step 3: 增加提交事务测试代码**

覆盖：未确认、无扫描件、扫描 ID 不完整或越权失败；合法提交按顺序快照全部扫描件、批量关联、创建一个审核任务并进入 reviewing；重复 idempotencyKey 不重复关联；事务任一步失败全部回滚。

- [ ] **Step 4: 泛化 `submit_node()` 审核条件**

允许 `file` 节点或 `confirmation + scanAuditEnabled` 使用审核程序。confirmation 从仓储读取全部当前待提交扫描件，不接受 payload 提供的页数和文件名；构建服务器可信 `scans` 数组后调用 `attach_uploaded_files()`。

- [ ] **Step 5: 调整服务恢复与任务材料**

`recover_audit_jobs()` 对带固定视觉程序、存在关联扫描件的 reviewing confirmation 补建任务。`claim_next_audit_job()` 继续按 `display_order, created_at, id` 取材料。

- [ ] **Step 6: 实现学生结果裁剪**

`_audit_summary()` 读取快照模式：

- `score`：学生响应 `reason=null/details=null`；
- `pass_fail + rejected`：返回原因，不返回 score；
- `audit_error`：继续固定脱敏提示；
- 普通文件审核保持现有 reason/details 行为。

- [ ] **Step 7: 静态审计**

沿 `submit_node -> audit_jobs -> complete_audit_job -> advance_downstream` 检查评分合法结果必然通过、通过模式 false 必然 rejected，且学生响应无评分泄露。

### Task 7: 教师提交详情 API

**Files:**
- Modify: `backend/app/repositories/flow_instances.py`
- Modify: `backend/app/api/routes/workflow_admin.py`
- Modify: `backend/tests/test_flow_runtime.py`
- Modify: `backend/tests/test_role_auth.py`
- Modify: `frontend/src/features/academic-flow/runtimeTypes.ts`
- Modify: `frontend/src/features/academic-flow/api.ts`

**Interfaces:**
- Produces: `GET /api/workflow-admin/node-instances/{node_instance_id}/submission-detail`。
- Produces type `TeacherSubmissionDetail` containing node, student, audit mode/result, and scan download metadata。

- [ ] **Step 1: 增加教师权限测试代码**

流程所有者可以查看；其他教师、学生和未登录请求拒绝；不存在返回 404。评分模式返回 score/reason，通过模式返回 passed/reason；响应不包含 storage_key、API 配置或原始模型响应。

- [ ] **Step 2: 实现仓储查询**

`get_teacher_submission_detail(node_instance_id: str, teacher_id: int)` 联结 flow owner、学生、当前 submission、audit job 和 uploaded files，文件按 display_order 返回。只解析经过验证的 `result_json`。

- [ ] **Step 3: 生成教师文件下载入口**

路由验证所有权后，为每个扫描件调用现有短期签名 URL；返回：

```json
{
  "nodeInstanceId": "...",
  "mode": "score",
  "status": "approved",
  "passed": true,
  "score": 82,
  "reason": "...",
  "scans": [{"fileId": "...", "originalName": "...", "url": "..."}]
}
```

- [ ] **Step 4: 增加前端类型与请求方法**

`workflowApi.getSubmissionDetail(nodeInstanceId)` 返回 `TeacherSubmissionDetail`，不把详情塞入全量进度响应。

- [ ] **Step 5: 静态审计**

确认接口按 flow owner 授权，而不是仅凭任意教师登录；确认签名 URL 短期有效。

### Task 8: 教师节点设置界面

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Modify: `frontend/src/features/academic-flow/academicFlowData.ts`
- Modify: `frontend/src/features/academic-flow/publishButtonState.ts`
- Modify: `frontend/tests/publishButtonState.test.ts`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes Task 2 节点字段、既有模板上传 API。
- Produces教师可配置 scan toggle/mode/prompt/template，且不显示供应商配置。

- [ ] **Step 1: 增加发布按钮状态测试代码**

启用扫描时缺 DOCX 模板、模式、提示词分别阻止发布；关闭扫描不阻止；完整配置允许发布。

- [ ] **Step 2: 增加聚焦组件 `ConfirmationScanSettings`**

可在 `AcademicFlowDesigner.tsx` 同文件定义，接收：

```ts
{
  disabled: boolean;
  node: AcademicFlowNode;
  onDeleteTemplate: () => void;
  onUpdate: (patch: Partial<AcademicFlowNode>) => void;
  onUploadTemplate: (file: File) => void;
}
```

开关关闭时清空 mode/prompt 但保留已有模板需明确删除；开关开启后显示 DOCX 模板、模式 radio 和最多 2000 字提示词 textarea。文件 accept 固定 `.docx`。

- [ ] **Step 3: 接入 NodeInspector**

仅 `configuresConfirmationScan` 渲染。文件节点原“限制/模板/审核脚本”区不改。提示区固定显示 10 文件、20 页、10 MB/文件、30 MB/组。

- [ ] **Step 4: 样式与静态审计**

复用 inspector card、switch、template card，不新增视觉资产。确认 UI 中无“豆包”、Base URL、API Key、模型字段。

### Task 9: 学生多扫描件工作区与隐私展示

**Files:**
- Create: `frontend/src/features/academic-flow/ScanUploadWorkspace.tsx`
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx`
- Modify: `frontend/src/features/academic-flow/runtimeTypes.ts`
- Modify: `frontend/src/styles.css`
- Create: `frontend/tests/scanUploadState.test.ts`

**Interfaces:**
- Consumes `RuntimeScanFile` and Task 4 API methods。
- Produces pure `getScanSubmitBlocker()` for submit gating。
- Produces reusable multi-file workspace with upload/delete/reorder/download callbacks。

- [ ] **Step 1: 增加提交门控测试代码**

覆盖未确认、模板未下载、空扫描件、上传中、API 错误均阻止提交；完整静态扫描列表允许提交。

- [ ] **Step 2: 创建纯状态函数**

```ts
export function getScanSubmitBlocker(input: {
  confirmed: boolean;
  scanAuditEnabled: boolean;
  scans: RuntimeScanFile[];
  templateDownloaded: boolean;
  uploading: boolean;
}): string | null
```

返回稳定中文原因或 `null`。

- [ ] **Step 3: 创建多扫描件工作区**

支持多选 input、拖放多文件、逐个上传、文件列表、页数/大小、下载、删除、替换、上移/下移。排序先乐观更新，API 失败回滚并显示错误。上传串行执行，避免并发总量竞争。

- [ ] **Step 4: 接入确认承诺节点**

启用扫描时展示模板下载和工作区；提交 payload 只发送 `{confirmed: true}`，扫描元数据由后端仓储生成。reviewing/rejected/audit_error/approved 沿用现有轮询和重试。

- [ ] **Step 5: 实现学生结果隐私**

评分模式只显示“视觉审核已完成”；不得渲染 audit details 或 reason。通过模式 rejected 显示 Markdown reason。已提交扫描件在所有只读状态显示下载入口。

- [ ] **Step 6: 样式与静态审计**

检查移动端文件操作不溢出、长文件名截断、排序按钮有 aria-label。检索学生组件不得出现 `score` 渲染路径。

### Task 10: 教师查看评分和扫描件

**Files:**
- Modify: `frontend/src/features/academic-flow/TeacherProgressPanel.tsx`
- Modify: `frontend/src/features/academic-flow/runtimeTypes.ts`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes `workflowApi.getSubmissionDetail()`。
- Produces教师提交详情弹窗，不修改 AI 结果。

- [ ] **Step 1: 在节点进度中增加查看入口**

为 `WorkflowProgressNode` 增加 `nodeInstanceId`，确认承诺扫描节点在存在 Submission 时显示“查看审核”。点击后按需请求详情，不在初始进度表批量生成签名 URL。

- [ ] **Step 2: 实现详情弹窗**

展示学生、节点、提交状态、审核模式；pass_fail 展示通过状态和原因；score 展示 `${score} 分` 与评分说明；文件列表提供下载。无结果时显示审核中/审核异常，不伪造分数。

- [ ] **Step 3: 保持只读和权限语义**

弹窗不提供编辑、重新评分或修改结果按钮。关闭恢复焦点；签名 URL 失效时允许关闭后重新打开以获取新 URL。

- [ ] **Step 4: 样式与静态审计**

复用现有教师进度弹窗层级，检查焦点陷阱、Escape、背景滚动锁和移动端布局。

### Task 11: 全链路静态审计、清理、最终提交与本地重启

**Files:**
- Review: 本计划涉及的全部文件
- Preserve: `AGENTS.md`、`INSTALL.md`、`MEMORY.md`

**Interfaces:**
- Produces: 一个最终实现提交；运行中的 FastAPI 8000 与 Vite 5173 服务。

- [ ] **Step 1: 对照设计逐项审计**

逐项核对 13 条验收标准，重点追踪：

```text
教师配置 -> 发布快照 -> 学生模板下载 -> 多扫描上传
-> submit_node 批量关联 -> audit_jobs -> 内部视觉程序
-> complete_audit_job -> 学生裁剪 / 教师完整详情 -> DAG 推进
```

- [ ] **Step 2: 执行非测试静态检查**

只运行：

```bash
git diff --check
rg -n "ark\.cn-beijing|doubao|VISION_API_KEY=.*[^=]" backend/app backend/scripts frontend/src
rg -n "score" frontend/src/features/academic-flow/StudentRuntimePage.tsx frontend/src/features/academic-flow/ScanUploadWorkspace.tsx
git status --short
```

解释所有命中；不得运行 pytest、npm test、npm build 或浏览器。

- [ ] **Step 3: 清理缓存**

只清理源码目录中的 `.pytest_cache`、`__pycache__`、`*.egg-info`、`.pyc`、`.pyo`，排除 `.git`、`backend/.venv`、`frontend/node_modules`。

- [ ] **Step 4: 暂存精确范围并创建最终提交**

暂存实现、测试代码和本计划；不暂存用户文件及被忽略的 `backend/.env`。提交：

```bash
git commit -m "feat: add confirmation scan visual audit"
```

- [ ] **Step 5: 本地重启服务**

精确停止本项目现有 8000/5173 监听进程，再启动：

```bash
cd /ai/github-repo/moyin/backend
./.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

```bash
cd /ai/github-repo/moyin/frontend
/ai/github-repo/moyin/.local/node/bin/node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 5173
```

- [ ] **Step 6: 验证服务可达性并再次清理缓存**

确认 5173 首页 HTTP 200、`/api/health` HTTP 200、监听进程属于本项目。启动会生成 Python 缓存，最后再清理一次。最终明确报告自动化测试、构建和浏览器验证均未运行。
