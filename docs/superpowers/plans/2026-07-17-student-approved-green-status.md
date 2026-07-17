# Student Approved Green Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将学生流程拓扑中的 `approved` 节点统一呈现为绿色成功状态。

**Architecture:** 保持 `StudentFlowTopology` 的状态映射与渲染逻辑不变，仅替换 `frontend/src/styles.css` 内 `.student-topology-*` 的已通过颜色值。相同状态的图例、节点、标签和连线复用一组现有成功色，待开放节点继续沿用灰色规则。

**Tech Stack:** React 18、CSS。

## Global Constraints

- 不修改 API、运行时状态、节点点击权限或 React 组件逻辑。
- 不新增依赖、设计变量或组件。
- 不运行自动化测试、构建或浏览器测试；仅执行静态 CSS 与 Git 范围审计。
- 仅提交本次 CSS 与开发文档，不纳入已有未提交文件。

---

### Task 1: 统一已通过的视觉语义

**Files:**
- Modify: `frontend/src/styles.css:3373-3563`

**Interfaces:**
- Consumes: `StudentFlowTopology.tsx` 输出的 `approved` 与 `locked` CSS 状态类。
- Produces: `approved` 使用绿色成功视觉，`locked` 保持灰色视觉。

- [x] **Step 1:** 将 `.student-topology-legend .approved::before` 的背景改为 `#16a34a`。
- [x] **Step 2:** 将 `.student-topology-edges g.approved path` 与 `polygon` 的颜色改为 `#16a34a`。
- [x] **Step 3:** 将 `.student-topology-node.approved` 改为 `border-color: #86efac`、`background: #f0fdf4`、`color: #166534`，保持 `.locked` 的灰色规则不变。
- [x] **Step 4:** 将仅属于 `.student-topology-node.approved` 的序号、类型和状态标签改为绿色；从与 `.locked` 共用的灰色选择器中拆出 `approved`，使其不再继承灰色值。

### Task 2: 静态审计与交付

**Files:**
- Modify: `frontend/src/styles.css`
- Modify: `docs/superpowers/plans/2026-07-17-student-approved-green-status.md`

- [x] **Step 1:** 审计 `approved`、`locked`、图例与连线选择器，确认已通过为绿色且待开放保留灰色。
- [x] **Step 2:** 运行 `git diff --check`，检查本次暂存范围；不运行测试、构建或浏览器验证。
- [x] **Step 3:** 清理本项目的 `.pytest_cache`、`__pycache__` 和 `*.egg-info` 中间目录（若存在）。
- [x] **Step 4:** 仅提交本次文件，并重启前后端服务。
