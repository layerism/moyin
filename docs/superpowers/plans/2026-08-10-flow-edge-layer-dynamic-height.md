# 流程连线层动态高度修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让流程画布中逻辑坐标超过 `1000` 的节点连线不再被 SVG 边界裁剪。

**Architecture:** 复用 `FlowNodeCanvas` 已计算的 `canvasSurfaceHeight`，将它同时传递给缩放内容容器与 SVG 连线层，使节点、连线、箭头和命中区域共享同一逻辑画布高度。保留现有路径算法和流程数据结构。

**Tech Stack:** React、TypeScript、SVG、CSS

## Global Constraints

- 不新增依赖。
- 不修改节点、边或端口的数据结构。
- 不修改正交路径、箭头和删除按钮的坐标算法。
- 空画布逻辑高度仍至少为 `1000px`。
- 按项目约束不运行测试、构建或浏览器插件，只做业务逻辑和代码静态审计。
- 完成后清理开发缓存并以本地方式重启服务，不使用 Docker。

---

### Task 1: 同步画布内容层与连线层高度

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:1389-1393`
- Review: `frontend/src/styles.css:2083-2110`

**Interfaces:**
- Consumes: `canvasSurfaceHeight: number`
- Produces: `.canvas-zoom-content` 与 `.flow-edge-layer` 的内联 `height` 均为 `canvasSurfaceHeight`

- [ ] **Step 1: 修改两个逻辑画布层的高度**

在 `canvas-zoom-content` 和 `flow-edge-layer` 上复用同一个动态高度：

```tsx
<div
  className="canvas-zoom-content"
  style={{ height: canvasSurfaceHeight, transform: `scale(${zoom})` }}
>
  <svg className="flow-edge-layer" style={{ height: canvasSurfaceHeight }}>
```

- [ ] **Step 2: 静态审计尺寸关系**

检查以下关系保持一致：

```text
canvas-zoom-surface.height = canvasSurfaceHeight * zoom
canvas-zoom-content.height = canvasSurfaceHeight
flow-edge-layer.height = canvasSurfaceHeight
```

确认 `canvasSurfaceHeight` 仍由以下规则生成：

```ts
Math.max(1000, ...layoutNodes.map((node) => node.y + node.renderedHeight + 80))
```

- [ ] **Step 3: 检查修改范围**

运行只读检查：

```bash
git diff --check -- frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
git diff -- frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
```

预期仅出现两个动态 `height` 属性，不涉及路径、节点或流程数据代码。

- [ ] **Step 4: 清理缓存并提交**

清理 `.pytest_cache`、`__pycache__` 和 `*.egg-info`，只暂存本任务文件，然后提交：

```bash
git add frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
git commit -m "fix: keep flow edge layer aligned with canvas height"
```

- [ ] **Step 5: 本地重启服务**

停止当前项目服务后，从 `backend/` 启动后端，并使用项目本地 Node 启动前端；不得使用 Docker。检查启动日志确认后端监听 `8000`、前端监听 `5173`。
