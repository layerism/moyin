# Node Settings Modal Background Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 节点设置弹窗打开期间完全锁定背景页面和流程画布，同时保留弹窗内部滚动，并仅允许通过“×”或“完成”关闭。

**Architecture:** 在现有 `NodeInspector` 生命周期内临时锁定 `document.body` 滚动，卸载时恢复原有内联样式。移除遮罩关闭事件，并在现有弹窗内容滚动容器上隔离滚动边界；不引入新组件、依赖或通用弹窗抽象。

**Tech Stack:** React 18、TypeScript、CSS。

## Global Constraints

- 仅修改教师端“节点设置”弹窗；不修改其他弹窗、后端接口、数据库或流程数据结构。
- 背景页面和画布在弹窗打开期间不能点击、拖动、滚动或缩放。
- 弹窗内部字段、按钮和内容滚动保持可用。
- 仅右上角“×”和底部“完成”关闭弹窗；不新增 Escape 或遮罩关闭入口。
- 不新增依赖或通用抽象。
- 不运行自动化测试、构建或 Browser；只做源码业务逻辑与 Git 范围审计，交由用户手测。
- 实现阶段不创建中间提交；完成审计、缓存清理与服务重启后统一提交。

---

### Task 1: 锁定节点设置弹窗背景交互

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:1349-1403`
- Modify: `frontend/src/styles.css:2185-2193`

**Interfaces:**
- Consumes: 现有 `NodeInspector` 组件、React `useEffect`、`onClose: () => void`。
- Produces: 保持现有 `NodeInspector` props 与调用方式不变；组件挂载时锁定背景滚动，卸载时恢复。

- [x] **Step 1: 在 `NodeInspector` 中增加可恢复的页面滚动锁**

在 `if (!node) return null` 之前增加 effect，确保 hook 调用顺序稳定，并仅在组件挂载周期内修改 `body`：

```tsx
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  if (!node) {
    return null;
  }
```

- [x] **Step 2: 移除遮罩关闭入口与不再需要的事件阻断**

将节点设置 JSX 调整为：

```tsx
    <div className="node-inspector-backdrop">
      <aside
        aria-modal="true"
        className="flow-panel inspector-panel node-inspector-modal"
        role="dialog"
      >
```

保留标题栏“×”和页脚“完成”的 `onClick={onClose}`，不得增加其他关闭事件。

- [x] **Step 3: 隔离弹窗内容区的滚动边界**

在现有 `.node-inspector-fields` 规则中加入：

```css
  overscroll-behavior: contain;
```

- [x] **Step 4: 做业务逻辑静态审计**

逐项检查：

- `NodeInspector` 的 hook 位于条件返回之前。
- `document.body.style.overflow` 在卸载时恢复为挂载前的精确值。
- 遮罩层不存在 `onMouseDown`、`onClick` 或其他关闭回调。
- “×”和“完成”仍调用现有 `onClose`。
- 弹窗字段容器仍为 `overflow: auto`，并增加 `overscroll-behavior: contain`。
- 未修改其他弹窗和画布事件处理函数。

- [x] **Step 5: 执行非测试型范围检查**

运行：

```bash
git diff --check -- frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/styles.css docs/superpowers/plans/2026-07-19-node-settings-modal-background-lock.md
git diff --stat
git diff -- frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/styles.css docs/superpowers/plans/2026-07-19-node-settings-modal-background-lock.md
```

预期：`git diff --check` 无输出且退出码为 0；差异只包含计划文件、节点设置弹窗生命周期/JSX 和对应内容区 CSS。不得运行测试、构建或 Browser。

- [x] **Step 6: 清理缓存、重启本地服务并提交完成检查点**

删除仓库内现存的 `.pytest_cache`、`__pycache__` 和 `*.egg-info` 中间目录，不触碰其他未跟踪文件。按仓库现有本地运行脚本重启前后端服务，不使用 Docker；只将以下文件加入提交：

```bash
git add docs/superpowers/plans/2026-07-19-node-settings-modal-background-lock.md \
  frontend/src/features/academic-flow/AcademicFlowDesigner.tsx \
  frontend/src/styles.css
git commit -m "fix: lock node settings modal background"
```
