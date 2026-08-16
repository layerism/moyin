# 学生运行弹窗横向溢出修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除学生运行弹窗的横向滚动条，并让扫描件操作区在弹窗实际宽度内稳定换行。

**Architecture:** 仅调整 `frontend/src/styles.css`。通过限制弹窗横向溢出、清除嵌套 Grid 的默认最小内容宽度，并将扫描件文件信息与操作区改为上下两行，解决长文件名和多个按钮共同撑宽弹窗的问题。

**Tech Stack:** CSS、React 18 现有 DOM 结构

## Global Constraints

- 不修改 React 组件、后端、接口或业务逻辑。
- 保持现有颜色、边框、圆角、间距、按钮顺序和禁用状态。
- 弹窗只允许纵向滚动，不允许出现横向滚动条。
- 修改过程中不运行测试、不使用浏览器插件，仅做源代码审计和 `git diff --check`。
- 完成后只提交本任务相关文件，清理限定缓存并重启本地服务。

---

### Task 1: 约束弹窗和嵌套网格宽度

**Files:**
- Modify: `frontend/src/styles.css:4844-4852`
- Modify: `frontend/src/styles.css:5501-5524`

**Interfaces:**
- Consumes: `.runtime-node-dialog`、`.runtime-node-form`、`.runtime-template-steps`、`.runtime-template-download`、`.runtime-scan-workspace`、`.runtime-scan-list` 现有 DOM 类名。
- Produces: 弹窗纵向自动滚动、横向隐藏，所有嵌套布局可收缩至父容器宽度。

- [x] **Step 1: 调整弹窗滚动轴**

将 `.runtime-node-dialog` 的 `overflow: auto` 拆分为 `overflow-x: hidden` 和 `overflow-y: auto`，并补充 `min-width: 0`。

- [x] **Step 2: 清除网格最小内容宽度传播**

为弹窗表单、模板步骤、模板下载卡片、扫描件工作区和扫描件列表统一补充 `min-width: 0`，避免长文件名或操作区撑宽祖先网格。

### Task 2: 重排扫描件文件行

**Files:**
- Modify: `frontend/src/styles.css:3361-3387`

**Interfaces:**
- Consumes: `.runtime-scan-list li` 中的文件信息块和 `.runtime-scan-actions` 操作区。
- Produces: 弹窗内文件信息位于第一行，操作区位于第二行右侧并可换行。

- [x] **Step 1: 将弹窗内扫描件列表项改为纵向排列**

新增作用域为 `.runtime-node-dialog` 的规则，将列表项设置为 `align-items: stretch` 和 `flex-direction: column`，避免影响教师配置区域或只读列表。

- [x] **Step 2: 允许弹窗内操作区换行**

新增作用域为 `.runtime-node-dialog` 的规则，为操作区设置 `flex-wrap: wrap`、`justify-content: flex-end` 和 `max-width: 100%`。

### Task 3: 静态审计与交付

**Files:**
- Modify: `frontend/src/styles.css`
- Create: `docs/superpowers/plans/2026-08-17-runtime-dialog-horizontal-overflow.md`

**Interfaces:**
- Consumes: Tasks 1–2 的 CSS 差异。
- Produces: 仅含样式和计划文档的结果提交，以及重新启动的本地服务。

- [x] **Step 1: 审计选择器与范围**

使用 `rg` 确认弹窗为 `overflow-x: hidden`、相关 Grid 容器具有 `min-width: 0`、弹窗内操作区允许换行，并确认 React 与后端没有差异。

- [x] **Step 2: 执行静态格式检查**

运行 `git diff --check`；不运行测试、构建或浏览器验证。

- [x] **Step 3: 清理、提交并重启服务**

清理项目源码产生的 `.pytest_cache`、`__pycache__` 和 `*.egg-info`，仅提交 `frontend/src/styles.css` 与本计划，然后按项目约定重启并核对 5173、8000 端口。
