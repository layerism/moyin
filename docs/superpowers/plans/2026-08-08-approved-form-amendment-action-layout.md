# 已通过表单修改按钮布局实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让已通过表单的“修改内容/继续修改”按钮与弹窗边界保持一致留白，不影响其他节点操作区。

**Architecture:** 保留现有 `.runtime-node-actions` 的通用排列能力，仅在已通过表单的只读分支增加专用修饰类。修饰类只负责弹窗内的水平和底部留白，并通过现有窄屏媒体查询与其他只读内容对齐。

**Tech Stack:** React 18、TypeScript、CSS

## Global Constraints

- 桌面端操作区右侧和底部留白为 `24px`。
- 窄屏操作区左右和底部留白为 `18px`。
- 不修改“暂存/提交”操作区、按钮交互或权限判定。
- 不新增依赖、组件或业务状态。
- 按项目约定不运行测试、构建或浏览器验证，仅做静态审计。

---

### Task 1: 隔离只读表单操作区布局

**Files:**
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx:503-513`
- Modify: `frontend/src/styles.css:4804-4809,5256-5267`

**Interfaces:**
- Consumes: 已通过表单只读分支中的 `.runtime-node-actions` 和现有窄屏媒体查询。
- Produces: `.runtime-node-actions-readonly` 布局修饰类；不产生新的 React 属性或状态。

- [x] **Step 1: 标记只读操作区**

将已通过表单的操作区改为：

```tsx
<div className="runtime-node-actions runtime-node-actions-readonly">
  <button
    className="primary-action"
    onClick={onBeginFormAmendment}
    type="button"
  >
    {Object.keys(runtime.draft).length > 0 ? "继续修改" : "修改内容"}
  </button>
</div>
```

删除原有无语义的 `<span />`。

- [x] **Step 2: 增加桌面端留白**

在 `.runtime-node-actions` 通用规则之后增加：

```css
.runtime-node-actions-readonly {
  margin: 0 24px 24px;
}
```

该规则只改变只读表单操作区的外边距，不与 `.runtime-node-form` 内的操作区叠加。

- [x] **Step 3: 增加窄屏留白**

在现有同一窄屏媒体查询中，紧随 `.runtime-readonly-submission` 规则增加：

```css
.runtime-node-actions-readonly {
  margin-right: 18px;
  margin-bottom: 18px;
  margin-left: 18px;
}
```

- [x] **Step 4: 静态审计**

运行：

```bash
git diff --check -- frontend/src/features/academic-flow/StudentRuntimePage.tsx frontend/src/styles.css
git diff -- frontend/src/features/academic-flow/StudentRuntimePage.tsx frontend/src/styles.css
rg -n "runtime-node-actions-readonly|runtime-node-actions" frontend/src/features/academic-flow/StudentRuntimePage.tsx frontend/src/styles.css
```

确认只读分支使用修饰类，编辑分支仍只使用 `.runtime-node-actions`；无依赖、业务逻辑和其他文件差异。

- [x] **Step 5: 清理、提交并重启**

定位并仅清理源码目录中的 `__pycache__`、`.pytest_cache` 和 `*.egg-info`，排除 `backend/.venv` 与 `frontend/node_modules`。随后只提交本计划和两个实现文件：

```bash
git add docs/superpowers/plans/2026-08-08-approved-form-amendment-action-layout.md frontend/src/features/academic-flow/StudentRuntimePage.tsx frontend/src/styles.css
git commit -m "fix: align approved form amendment action"
```

停止当前 FastAPI 与 Vite 进程，使用现有本地命令重新启动；仅检查后端健康端点和前端 HTTP 响应。
