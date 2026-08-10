# Node Time Settings Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将所有节点的定时设置由主弹窗内联区域改为带本地草稿、取消和确认语义的二级弹窗。

**Architecture:** 在 `AcademicFlowDesigner.tsx` 内增加小型 `NodeTimeSettingsDialog` 组件，组件挂载时从节点复制起止时间并在内部维护草稿。`NodeInspector` 只负责打开、关闭和在确认时一次性更新两个节点字段；现有日期时间选择器及摘要函数继续复用。

**Tech Stack:** React 18、TypeScript、现有 `NodeDateTimePicker`、现有 CSS。

## Global Constraints

- 所有使用共享节点设置弹窗的节点统一生效。
- 取消、关闭、遮罩和 Escape 不保存本次时间修改。
- 确认时一次性写入 `startAt`、`deadlineAt`。
- 不增加重复计划、后端字段或第三方依赖。
- 按项目要求，开发过程不运行测试、构建或浏览器验证，只进行静态业务审计。

---

### Task 1: 实现二级时间弹窗与草稿提交

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`

**Interfaces:**
- Consumes: `AcademicFlowNode`、`NodeDateTimePicker`、`getTimeWindowSummary()`、`onUpdateNode()`。
- Produces: `NodeTimeSettingsDialog` 及只在确认时提交的 `{ startAt, deadlineAt }` 补丁。

- [ ] **Step 1: 替换主弹窗展开状态**

将 `timeSettingsExpanded` 改为 `timeSettingsOpen`；主按钮使用 `aria-haspopup="dialog"` 打开二级弹窗，移除主弹窗中的内联时间区域。

- [ ] **Step 2: 增加时间草稿组件**

新增 `NodeTimeSettingsDialog`，挂载时以 `node.startAt`、`node.deadlineAt` 初始化本地状态。日期确认和清除仅更新本地状态。

- [ ] **Step 3: 实现关闭优先级**

当二级弹窗打开时，节点设置层的 Escape 处理先关闭二级弹窗；二级弹窗遮罩、右上角关闭和“取消”均调用同一关闭函数，不调用 `onUpdateNode`。

- [ ] **Step 4: 实现确认与校验**

当两个时间同时存在且 `new Date(startAt).getTime() >= new Date(deadlineAt).getTime()` 时显示原有错误并禁用“确定”；其他状态点击“确定”一次提交两个字段。

### Task 2: 增加二级弹窗视觉样式并交付

**Files:**
- Modify: `frontend/src/styles.css`
- Review: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`

**Interfaces:**
- Consumes: Task 1 的遮罩、弹窗、标题、内容和底部操作类名。
- Produces: 位于节点设置弹窗上层、与现有白色轻量风格一致的时间弹窗。

- [ ] **Step 1: 定义二级弹窗层级和布局**

新增高于节点设置遮罩、低于日期选择器的弹窗层级；设置紧凑标题栏、双列时间字段、错误提示和“取消 / 确定”底栏。

- [ ] **Step 2: 保留窄屏适配**

在现有断点下将起止时间改为单列，并确保二级弹窗在视口内滚动。

- [ ] **Step 3: 静态审计**

确认主弹窗不再渲染内联时间区域；确认取消路径不调用更新函数，确认路径同时提交两个字段；执行 `git diff --check`。

- [ ] **Step 4: 清理、提交和重启**

清理项目缓存，仅提交本计划涉及文件；本地重启 Vite 与 Uvicorn，并检查 5173、8000 端口及 HTTP 可达性。
