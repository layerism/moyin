# Student Node Action Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一学生节点弹窗底部暂存与提交操作的对齐和视觉重量。

**Architecture:** 仅修改 `runtime-node-actions`、`runtime-submit-control` 与按钮状态 CSS。保留现有 JSX、文案、禁用条件和动作顺序，使提示文案独立于按钮高度。

**Tech Stack:** CSS。

## Global Constraints

- 不修改提交、暂存、上传或审核逻辑。
- 两个操作按钮高度固定为 40px，操作区顶部对齐。
- 禁用提交保留“请先上传文件”原因。
- 不运行自动化测试、构建或浏览器测试；仅执行 CSS 与 Git 范围静态审计。

---

### Task 1: 对齐操作区并收敛按钮视觉

**Files:**
- Modify: `frontend/src/styles.css:3995-4025`

- [x] **Step 1:** 为 `.runtime-node-actions` 设置 `align-items: flex-start`，阻止提示文案拉伸暂存按钮。
- [x] **Step 2:** 为操作区按钮统一 `min-height: 40px`、收敛圆角和字号，并为主按钮定义蓝色填充、轻阴影、悬停和禁用态。
- [x] **Step 3:** 为 `.runtime-submit-control` 固定提示最小行高并保持右侧对齐，使按钮基线稳定。

### Task 2: 静态审计与交付

**Files:**
- Modify: `docs/superpowers/plans/2026-07-18-student-node-action-alignment.md`

- [x] **Step 1:** 检查操作区 CSS 选择器与禁用提示规则，不修改 JSX。
- [x] **Step 2:** 执行 `git diff --check` 与任务文件范围审计；不运行测试、构建或浏览器验证。
- [x] **Step 3:** 清理本项目的 `.pytest_cache`、`__pycache__` 和 `*.egg-info` 中间目录（若存在），仅提交本次文件，并重启前后端服务。
