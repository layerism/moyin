# Database Viewport Scrolling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将数据库管理页限制在一个视口内，左侧导航与右侧表格分别内部滚动。

**Architecture:** 只调整现有 CSS 容器的 Grid/Flex 高度传递与 overflow 边界，不增加 JavaScript 尺寸计算或新组件。

**Tech Stack:** React 18、CSS Grid、CSS Flexbox。

## Global Constraints

- 不修改数据库 API 与 React 业务逻辑。
- 不运行测试、构建或浏览器验证。
- 保留 760 px 以下的横向导航模式。

---

### Task 1: 固定桌面端视口

**Files:**
- Modify: `frontend/src/styles.css`

- [x] **Step 1:** 将 `.database-admin-page` 改为 `height: 100dvh` 的两行 Grid，并隐藏页面级溢出。
- [x] **Step 2:** 为 `.database-admin-layout`、`.database-table-nav` 和 `.database-table-main` 补齐 `min-height: 0` 及独立 overflow 边界。
- [x] **Step 3:** 使 `.database-grid-scroll` 占用右侧剩余高度，取消基于视口的脆弱 `max-height` 计算。

### Task 2: 保持移动端布局

**Files:**
- Modify: `frontend/src/styles.css`

- [x] **Step 1:** 在 760 px 媒体查询中将主体切换为“导航自然高度 + 数据区剩余高度”。
- [x] **Step 2:** 将移动端导航限制为横向滚动，避免同时产生纵向导航滚动。

### Task 3: 静态审计与交付

**Files:**
- Modify: `docs/superpowers/specs/2026-07-17-database-viewport-scrolling-design.md`
- Modify: `docs/superpowers/plans/2026-07-17-database-viewport-scrolling.md`

- [x] **Step 1:** 审计 CSS 高度链路、滚动所有权、窄屏覆盖与本次 Git 范围，不执行测试、构建或浏览器。
- [x] **Step 2:** 清理中间缓存，仅提交本次文件，然后重启前后端服务。
