# Remove Student Progress Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除学生流程详情页顶部的三张进度统计卡片。

**Architecture:** 从 `StudentRuntimePage` 中删除仅用于卡片的 `progress` 统计与渲染区块，并从全局样式中删除对应的卡片与移动端网格规则。流程实例、节点运行时状态与 `StudentFlowTopology` 的输入保持不变。

**Tech Stack:** React 18、TypeScript、CSS。

## Global Constraints

- 保留页头总状态、办理拓扑、节点弹窗、审核轮询与提交流程。
- 不修改 API、运行时类型、状态机或节点权限。
- 不新增组件、依赖或替代汇总展示。
- 不运行自动化测试、构建或浏览器测试；仅执行静态源码、CSS 与 Git 范围审计。
- 仅提交本次源码、样式和开发文档，不纳入已有未提交文件。

---

### Task 1: 删除顶部统计展示及无用计算

**Files:**
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx:194-255`

**Interfaces:**
- Consumes: `RuntimeFlowInstance.nodeInstances` 继续传递给 `StudentFlowTopology`。
- Produces: 学生流程页不再输出 `runtime-progress-grid`。

- [x] **Step 1:** 删除 `progress` 对象，其 `approved`、`available`、`reviewing` 计数仅由进度卡片使用。
- [x] **Step 2:** 删除 `aria-label="流程进度"` 的 `<section className="runtime-progress-grid">` 与内部三张 `<article className="runtime-progress-card">`。
- [x] **Step 3:** 保持其后的 `<StudentFlowTopology>` 参数与页头 `runtime-overall-status` 原样不变。

### Task 2: 删除失效样式并审计

**Files:**
- Modify: `frontend/src/styles.css:3282-3334,4137-4139`
- Modify: `docs/superpowers/plans/2026-07-18-remove-student-progress-cards.md`

- [x] **Step 1:** 删除 `.runtime-progress-grid`、`.runtime-progress-card` 及其状态变体规则。
- [x] **Step 2:** 删除窄屏媒体查询中的 `.runtime-progress-grid` 覆盖规则。
- [x] **Step 3:** 搜索 `runtime-progress` 与 `const progress`，确认没有残留引用。
- [x] **Step 4:** 执行 `git diff --check` 和任务文件范围检查；不运行测试、构建或浏览器验证。
- [x] **Step 5:** 清理本项目的 `.pytest_cache`、`__pycache__` 和 `*.egg-info` 中间目录（若存在），仅提交本次文件，并重启前后端服务。
