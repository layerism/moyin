# Published Audit Policy Inline Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已发布节点的审核策略热更新能力合并回原有审核控件，并移除重复的独立编辑区。

**Architecture:** `NodeInspector` 负责加载、暂存、校验和保存已发布节点策略；确认节点与文件节点仍通过现有组件渲染，但分别解耦核心配置锁定和参数编辑锁定。后端继续使用现有策略接口和 generation 乐观并发控制。

**Tech Stack:** React 18、TypeScript、现有 `workflowApi` 与 CSS 视觉体系

**Spec:** `docs/superpowers/specs/2026-08-19-published-scan-audit-prompt-revision-design.md`

## Global Constraints

- 不新增后端接口、数据库表或审核 worker 行为。
- 已发布节点的脚本、审核开关和审核模式保持锁定。
- 参数保存失败时不得关闭节点设置弹窗。
- 不运行测试、构建或浏览器插件，只做静态业务逻辑审计。
- 只提交本任务文件，不夹带工作区中的用户已有改动。

---

### Task 1: 将策略状态接入节点检查器

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`

**Interfaces:**
- Consumes: `workflowApi.getNodeAuditPolicy(flowId, nodeKey)`、`workflowApi.updateNodeAuditPolicy(flowId, nodeKey, payload)`
- Produces: 原位置控件使用的策略覆盖节点，以及保存成功后调用的 `onAuditPolicySaved(params)`

- [x] **Step 1: 将原独立编辑器的策略加载状态提升到 `NodeInspector`**

  以 `flowId`、`node.id` 和 `publishedAuditPolicy` 为依赖加载策略；切换节点时清空旧策略、参数和错误。

- [x] **Step 2: 生成仅用于审核控件显示的节点值**

  用策略参数覆盖 `auditScriptParams`、`scanAuditMode` 和 `scanAuditPrompt`，标题、说明、时间等仍读取流程修订节点。

- [x] **Step 3: 统一关闭入口与策略保存**

  右上角关闭、底部“完成”和 `Escape` 共用异步关闭函数；无变化直接关闭，有变化则校验并携带 `expectedGeneration` 保存，成功后同步父级并关闭，失败时保留弹窗。

- [x] **Step 4: 删除独立编辑器并更新说明文字**

  删除 `PublishedAuditPolicyEditor`、`PublishedAuditPolicyField` 及独立保存按钮；修订提示和底部提示分别说明重新发布字段与即时热更新字段。

### Task 2: 解耦脚本选择与参数编辑锁定

**Files:**
- Modify: `frontend/src/features/academic-flow/AuditScriptSelector.tsx`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`

**Interfaces:**
- Consumes: `NodeAuditPolicy.parameters`、策略覆盖后的 `AcademicFlowNode.auditScriptParams`
- Produces: `parameterDisabled?: boolean`、`parameters?: AuditScriptParameter[]` 两个可选属性

- [x] **Step 1: 扩展 `AuditScriptSelector` 的锁定属性**

  `disabled` 继续只控制脚本选择；`parameterDisabled` 独立控制参数控件，缺省时继承 `disabled`；`parameters` 可由已发布策略提供权威参数定义。

- [x] **Step 2: 绑定文件节点原参数控件**

  已发布节点保持脚本选择禁用；策略加载完成后开放参数控件，参数变化只写入策略暂存状态，不进入流程修订补丁。

- [x] **Step 3: 绑定确认节点原提示词控件**

  审核方式保持禁用；提示词加载完成后可编辑，变化只写入 `scanAuditPrompt` 策略参数。

### Task 3: 收敛样式和静态契约

**Files:**
- Modify: `frontend/src/styles.css`
- Modify: `frontend/tests/publishedPromptRevision.test.ts`

**Interfaces:**
- Consumes: 节点检查器底部的读取、保存和错误状态
- Produces: 与现有视觉一致的底部状态，以及“审核热更新不进入流程修订字段”的静态测试契约

- [x] **Step 1: 删除独立策略卡片样式**

  移除 `.published-audit-policy` 规则，并为底部错误状态复用红色错误语义。

- [x] **Step 2: 更新发布修订过滤测试预期**

  测试明确 `scanAuditPrompt` 与 `scanAuditMode` 均被流程修订补丁丢弃，因为二者由审核策略接口独立保存。

- [x] **Step 3: 静态审计调用链**

  检查草稿节点仍通过 `onUpdateNode` 编辑；已发布节点仅参数走策略接口；脚本、审核模式、模板保持锁定；所有关闭入口均经过同一保存函数。

### Task 4: 收尾

**Files:**
- No production file changes

**Interfaces:**
- Consumes: 完成后的任务文件集合
- Produces: 结果检查点与运行中的本地服务

- [x] **Step 1: 清理限定缓存**

  仅清理项目内 `.pytest_cache`、`__pycache__` 和 `*.egg-info`，不触碰依赖构建目录。

- [ ] **Step 2: 创建结果检查点**

  只暂存并提交本计划列出的任务文件。

- [ ] **Step 3: 非 Docker 重启服务**

  从 `backend/` 启动后端，从 `frontend/` 使用项目 `.local/node` 启动前端，并核对 8000、5173 监听进程及工作目录。
