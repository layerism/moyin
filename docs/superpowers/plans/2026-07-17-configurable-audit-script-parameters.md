# Configurable Audit Script Parameters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每个审核脚本版本提供通用标量参数表单，并新增可配置最低字数的 DOCX 审核脚本。

**Architecture:** 脚本版本目录的可选 `config.json` 由后端目录服务严格解析并生成独立配置哈希；管理员选择脚本时把参数默认值、配置哈希和扩展名约束固化到节点，发布时再次校验。审核 worker 从固定流程快照读取参数并通过 `context.scriptParams` 传给脚本，字数脚本使用 `python-docx` 返回现有审核协议结果。

**Tech Stack:** Python 3.11、FastAPI、python-docx、React 18、TypeScript、原生 CSS。

## Global Constraints

- 参数类型仅支持 `integer`、`number`、`string`、`boolean`、`select`，不实现数组、嵌套对象或字段联动。
- 每个版本最多 20 个参数，参数 JSON 最大 16 KiB。
- DOCX 字数脚本默认最低字数 1000，范围 1–1,000,000。
- 统计正文段落和去重后的正文表格单元格，忽略页眉页脚；中文字符逐字计数，连续 ASCII 字母数字串计 1。
- 无 `config.json` 的现有脚本继续工作。
- 不新增数据库表、表单库、JSON Schema 库或前端状态库。
- 当前分支实施，中间不提交，结束时只创建一个功能检查点。
- 按项目规则不运行自动化测试、构建或浏览器验证，仅做静态业务逻辑审计。
- 保留并排除用户已有 `AGENTS.md`、`docs/05_oa_graph.md` 和 `.superpowers/` 变更。
- 完成后清理缓存并重启前后端服务。

---

### Task 1: 版本化脚本配置解析与参数校验

**Files:**
- Create: `backend/app/services/audit_script_parameters.py`
- Modify: `backend/app/services/audit_script_catalog.py`

**Interfaces:**
- Produces: `AuditScriptVersionConfig(accepted_extensions, parameters, sha256)`。
- Produces: `load_audit_script_version_config(version_dir: Path) -> AuditScriptVersionConfig`。
- Produces: `validate_script_params(config, params) -> dict[str, str | int | float | bool]`。
- Extends: `AuditScriptRecord.config_sha256`、`accepted_extensions`、`parameters`。

- [ ] 严格解析可选 `config.json`，拒绝越界路径、符号链接、未知字段、重复 key、非法默认值、非有限数字和无效扩展名；无文件时返回规范空配置。
- [ ] 对规范 JSON 使用现有 canonical JSON 规则计算 SHA-256。
- [ ] 实现五种标量值校验、必填与额外字段拒绝、20 项和 16 KiB 上限。
- [ ] 将版本配置字段加入脚本列表 API 和固定版本解析结果。
- [ ] 使用 `rg` 静态核对 API 字段与 dataclass 命名一致。

### Task 2: 流程快照、发布校验与 worker 参数传递

**Files:**
- Modify: `backend/app/repositories/workflows.py`
- Modify: `backend/app/domain/workflow_revision.py`
- Modify: `backend/app/repositories/flow_instances.py`
- Modify: `backend/app/repositories/audit_jobs.py`

**Interfaces:**
- Consumes: `find_audit_script_version()` 的版本配置和 `validate_script_params()`。
- Node fields: `auditScriptConfigHash?: string`、`auditScriptParams?: Record<string, scalar>`、`auditScriptAcceptedExtensions?: string[]`。
- Produces: `ClaimedAuditJob.context.scriptParams`。

- [ ] 在发布和修订影响预览中逐节点解析固定脚本，校验代码哈希、配置哈希、参数值、文件节点类型和扩展名严格一致；未启用脚本时拒绝残留参数字段。
- [ ] 将配置哈希、参数和扩展名约束加入 `BUSINESS_NODE_FIELDS`，使参数修改触发节点及下游失效。
- [ ] 提交时把配置哈希纳入完整脚本配置校验，避免部分字段静默绕过。
- [ ] 任务领取时读取固定流程快照中的当前节点，复核四个脚本身份字段并把规范参数加入 `context.scriptParams`；无参数脚本传空对象。
- [ ] 用 `rg` 检查学生请求没有可覆盖 `scriptParams` 的入口。

### Task 3: 管理员通用动态参数表单

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/features/academic-flow/auditScripts.ts`
- Modify: `frontend/src/features/academic-flow/AuditScriptSelector.tsx`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Extends: `AuditScriptSummary` with `configSha256`、`acceptedExtensions`、`parameters`。
- Produces: `resolveAuditScriptSelection()` defaults and `validateAuditScriptParameterValue()`。

- [ ] 定义五种判别联合参数类型和节点参数字段。
- [ ] 选择脚本时复制配置哈希、扩展名约束、默认参数，并在切换脚本时清空旧值；取消时删除这些字段但保留当前格式文本。
- [ ] 在 `AuditScriptSelector` 按参数类型渲染 number/text/checkbox/select，说明文字和 HTML 边界属性来自 schema，所有更新合并到 `auditScriptParams`。
- [ ] 当节点存在非空 `auditScriptAcceptedExtensions` 时禁用文件格式预设与自定义输入，并显示“由审核脚本固定”。
- [ ] 增加最小表单布局，复用现有 inspector 控件，不引入依赖。

### Task 4: DOCX 字数审核脚本

**Files:**
- Create: `backend/scripts/docx-word-count-check/manifest.json`
- Create: `backend/scripts/docx-word-count-check/versions/1/config.json`
- Create: `backend/scripts/docx-word-count-check/versions/1/handler.py`

**Interfaces:**
- Consumes: `payload.files[0].path/id` and `payload.context.scriptParams.minimumWordCount`。
- Produces: existing `schemaVersion=1.0` audit result with `wordCount` and `minimumWordCount`。

- [ ] 创建脚本 manifest 和版本配置，固定 `.docx` 与最低字数定义。
- [ ] 使用 `python-docx` 读取正文段落和表格，以 `_tc` 身份去重表格单元格，不读取 header/footer。
- [ ] 使用正则分别匹配 CJK 字符和 `[A-Za-z0-9]+`，返回两者 token 数之和。
- [ ] 字数不足返回 `WORD_COUNT_BELOW_MINIMUM`；协议、参数、文件数量、扩展名或 DOCX 读取错误抛出技术异常。
- [ ] 保证 issue 含 `fileId/code/message`，满足现有 executor 输出校验。

### Task 5: 静态交付、提交与服务重启

**Files:**
- Review: all files above

**Interfaces:**
- Produces: 功能提交和供用户手动验收的运行中服务。

- [ ] 对照设计逐项审查配置版本化、标量类型、扩展名锁定、发布校验、修订影响、worker 参数来源和脚本输出协议。
- [ ] 运行 `git diff --check` 和目标 `rg` 检查；按项目规则不执行测试、构建或浏览器。
- [ ] 清理 `.pytest_cache`、`__pycache__`、`*.egg-info`。
- [ ] 仅暂存本计划文件和功能文件，提交 `feat: add configurable audit script parameters`。
- [ ] 停止残留 Uvicorn/Vite 进程并重启；确认启动日志无 schema/import/lifespan 错误，保留服务供用户手动验证。
