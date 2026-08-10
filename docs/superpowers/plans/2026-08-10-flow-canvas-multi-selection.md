# Flow Canvas Multi-Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在教师流程画布中实现左键拉框多选，并允许拖动任一已选节点时整体平移全部已选节点。

**Architecture:** 使用原生 Pointer Events 扩展现有 `FlowNodeCanvas` 手势状态；选择框和多选集合保留在画布组件内，节点位置仍由父级流程草稿统一管理。矩形命中和整组边界约束使用 `canvasPan.ts` 中的纯函数，父级通过一次批量回调提交所有节点坐标。

**Tech Stack:** React 18、TypeScript、CSS、原生 Pointer Events；不新增依赖。

## Global Constraints

- 左键只在画布空白区域启动框选；与选择框相交的可移动节点即选中。
- 右键平移、Ctrl+滚轮缩放、连接点拖线和双击设置保持现状。
- 整组移动沿用 16px 网格吸附，且所有节点保持相对位置。
- 已发布并锁定的节点不得进入框选集合或参与整体移动。
- 多选状态不写入流程配置、后端、数据库或发布版本。
- 不新增批量删除、复制、对齐或键盘组合选择。
- 遵循仓库要求：开发过程中不运行测试、构建或浏览器插件，只做业务逻辑静态审计。
- 遵循仓库提交约束：设计检查点已提交，实施过程中不创建中间提交，完成后只创建一个功能检查点。
- 不暂存或修改用户现有的 `.gitignore`、`AGENTS.md`、`README.md`、`docker-compose.yml`、`storage/.gitkeep`、`INSTALL.md`、`MEMORY.md` 变更。

---

## File Structure

- Modify: `frontend/src/features/academic-flow/canvasPan.ts` — 提供矩形标准化、相交判断和整组边界位移计算纯函数。
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx` — 增加批量坐标提交、框选状态和整体拖动手势。
- Modify: `frontend/src/styles.css` — 增加选择框层级和框选过程的视觉状态。
- Create: `docs/superpowers/plans/2026-08-10-flow-canvas-multi-selection.md` — 本实施计划。

### Task 1: 画布几何辅助函数

**Files:**
- Modify: `frontend/src/features/academic-flow/canvasPan.ts:1-89`

**Interfaces:**
- Produces: `CanvasPoint`、`CanvasRect`、`normalizeCanvasRect(start, end)`、`canvasRectsIntersect(left, right)`、`constrainCanvasGroupDelta(points, desiredDelta, minimumCoordinate)`。
- Consumes: 无业务数据，只处理数值坐标。

- [ ] **Step 1: 定义共享坐标类型**

在 `canvasPan.ts` 顶部增加：

```ts
export type CanvasPoint = { x: number; y: number };

export type CanvasRect = CanvasPoint & {
  height: number;
  width: number;
};
```

- [ ] **Step 2: 实现选择框标准化和相交判断**

```ts
export function normalizeCanvasRect(start: CanvasPoint, end: CanvasPoint): CanvasRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function canvasRectsIntersect(left: CanvasRect, right: CanvasRect) {
  return (
    left.x <= right.x + right.width &&
    left.x + left.width >= right.x &&
    left.y <= right.y + right.height &&
    left.y + left.height >= right.y
  );
}
```

边界接触也视为相交，以符合“碰到即选中”。

- [ ] **Step 3: 实现整组边界位移约束**

```ts
export function constrainCanvasGroupDelta(
  points: readonly CanvasPoint[],
  desiredDelta: CanvasPoint,
  minimumCoordinate: number,
): CanvasPoint {
  const minimumX = Math.min(...points.map((point) => point.x));
  const minimumY = Math.min(...points.map((point) => point.y));
  return {
    x: Math.max(desiredDelta.x, minimumCoordinate - minimumX),
    y: Math.max(desiredDelta.y, minimumCoordinate - minimumY),
  };
}
```

调用方只在点集合非空时调用，确保不为无节点集合计算 `Math.min`。

- [ ] **Step 4: 静态核对纯函数语义**

人工核对以下输入输出，不执行测试：

- 反向拖动 `(100, 80) -> (20, 10)` 标准化为 `{ x: 20, y: 10, width: 80, height: 70 }`。
- 两矩形仅边界接触时返回相交。
- 节点组最小坐标为 `(32, 48)`、期望位移 `(-32, -64)`、边界 `16` 时，约束位移为 `(-16, -32)`。

### Task 2: 父级批量位置提交

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:363-381`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:560-585`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:777-818`

**Interfaces:**
- Produces: `updateNodePositions(positions: Record<string, CanvasPoint>): void`。
- Passes: `onUpdateNodePositions` 给 `FlowNodeCanvas`。
- Consumes: Task 1 的 `CanvasPoint` 类型和现有 `canMoveRevisionNode` 权限判断。

- [ ] **Step 1: 导入画布几何类型和辅助函数**

从 `canvasPan.ts` 导入：

```ts
canvasRectsIntersect,
constrainCanvasGroupDelta,
normalizeCanvasRect,
type CanvasPoint,
type CanvasRect,
```

- [ ] **Step 2: 增加原子批量位置更新函数**

在现有 `updateNode` 后增加：

```ts
const updateNodePositions = (positions: Record<string, CanvasPoint>) => {
  if (editorLocked) return;
  let changed = false;
  const nextNodes = workingProcess.nodes.map((node) => {
    const position = positions[node.id];
    if (!position || !canMoveRevisionNode(node.id, protectedNodeIds)) return node;
    if (node.x === position.x && node.y === position.y) return node;
    changed = true;
    return { ...node, ...position };
  });
  if (!changed) return;
  commitDesignChange({ ...workingProcess, nodes: nextNodes });
};
```

权限在父级再次校验，防止画布局部状态绕过已发布节点保护。

- [ ] **Step 3: 扩展 `FlowNodeCanvas` 属性**

新增精确接口：

```ts
onUpdateNodePositions: (positions: Record<string, CanvasPoint>) => void;
```

从父组件传入 `updateNodePositions`。保留 `onUpdateNode`，供现有单节点设置和其他调用继续使用；节点拖动改为统一调用批量入口。

### Task 3: 框选和整体拖动手势

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:819-951`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:1033-1068`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:1143-1186`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:1213-1464`

**Interfaces:**
- Consumes: Task 1 的纯函数和 Task 2 的 `onUpdateNodePositions`。
- Produces: 画布本地 `selectedNodeIds`、`selectionStart`、`selectionRect`、`draggingNodes` 状态。

- [ ] **Step 1: 定义手势状态类型**

在组件外增加：

```ts
type CanvasSelectionDraft = {
  current: CanvasPoint;
  start: CanvasPoint;
};

type NodeGroupDrag = {
  anchorId: string;
  pointerStart: CanvasPoint;
  startPositions: Record<string, CanvasPoint>;
};
```

在 `FlowNodeCanvas` 内增加：

```ts
const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(
  () => new Set(activeNodeId ? [activeNodeId] : []),
);
const [selectionDraft, setSelectionDraft] = useState<CanvasSelectionDraft | null>(null);
const [draggingNodes, setDraggingNodes] = useState<NodeGroupDrag | null>(null);
```

删除旧的单节点 `draggingNode` 状态。

- [ ] **Step 2: 同步节点变化和锁定状态**

扩展现有节点 ID 清理 effect：

- 多选集合只保留仍存在的节点 ID；
- 框选生成的集合只纳入 `canMoveNode(node.id)` 为真的节点；
- `locked` 变为真时，清空多选、选择框和整组拖动状态；
- 节点删除后自然从集合中移除。

不要把 `activeNodeId` 的每次变化强制覆盖多选集合，否则框选后设置首个活动节点会破坏多选。

- [ ] **Step 3: 实现空白区域左键框选**

把 `startCanvasPan` 扩展为统一的 `startCanvasPointer`：

1. 右键仍按 `shouldStartCanvasPan` 启动画布平移。
2. 左键仅在 `!locked` 且事件目标不位于 `.flow-node`、`.flow-edge-hitbox`、`.flow-edge-delete`、`.node-quick-actions` 内时启动框选。
3. 框选开始时清除连接线选中和节点多选，记录 `getCanvasPoint` 后的起点，并捕获指针。

在 `moveCanvasPointer` 中：

```ts
const nextRect = normalizeCanvasRect(selectionDraft.start, point);
const nextIds = layoutNodes
  .filter((node) => canMoveNode(node.id))
  .filter((node) => canvasRectsIntersect(nextRect, {
    x: node.x,
    y: node.y,
    width: nodeSize.width,
    height: node.renderedHeight,
  }))
  .map((node) => node.id);
```

更新选择框和 `selectedNodeIds`；首个命中节点通过 `onSelectNode` 成为活动节点，但不得因此清空集合。

在 `endCanvasPointer` 和 `cancelCanvasPointer` 中释放捕获并清除选择框草稿；无命中结果即保持空集合。

- [ ] **Step 4: 实现单选与整组拖动快照**

`startNodeDrag` 的规则：

- 非左键、锁定节点或连接点事件直接返回；
- 若按下节点不在多选集合，将集合替换为该节点并调用 `onSelectNode(node.id)`；
- 若节点已在多选集合，保留整组选择并将其设为活动节点；
- 从 `nodeById` 读取所有可移动已选节点的初始坐标，形成 `startPositions`；
- 保存指针起始画布坐标并捕获指针。

节点 `onClick` 只在节点尚未位于集合时切换单选，防止拖动完成后的 click 清空整组选择。

- [ ] **Step 5: 实现按网格整体移动**

`dragNode` 使用锚点节点初始位置和指针位移计算吸附坐标：

```ts
const desiredAnchor = snapCanvasPoint({
  x: anchorStart.x + point.x - draggingNodes.pointerStart.x,
  y: anchorStart.y + point.y - draggingNodes.pointerStart.y,
});
const constrainedDelta = constrainCanvasGroupDelta(
  Object.values(draggingNodes.startPositions),
  {
    x: desiredAnchor.x - anchorStart.x,
    y: desiredAnchor.y - anchorStart.y,
  },
  canvasGridSize,
);
```

将同一个 `constrainedDelta` 应用于所有初始坐标，再调用一次 `onUpdateNodePositions`。指针抬起或取消时清除拖动快照。

- [ ] **Step 6: 更新节点选中渲染和快捷操作**

- `.flow-node` 的 `selected` 条件改为 `selectedNodeIds.has(node.id)`。
- 多选时仅 `node.id === activeNodeId` 的节点渲染快捷操作。
- 双击设置和连接点事件继续阻止与框选、拖动事件串扰。
- 选择框在 `.canvas-zoom-content` 内渲染为 `div.canvas-selection-box`，样式使用 `selectionRect` 的 `left`、`top`、`width`、`height`。

### Task 4: 选择框视觉层级

**Files:**
- Modify: `frontend/src/styles.css:2071-2102`
- Modify: `frontend/src/styles.css:2195-2232`

**Interfaces:**
- Consumes: Task 3 渲染的 `.canvas-selection-box` 和 `.dag-canvas.is-selecting`。
- Produces: 连线之上、节点之下的半透明选择框。

- [ ] **Step 1: 明确画布层级**

给 `.flow-edge-layer` 增加 `z-index: 1`，保持 `.dag-node-stack` 的 `z-index: 3`。

- [ ] **Step 2: 增加选择框样式**

```css
.canvas-selection-box {
  position: absolute;
  z-index: 2;
  border: 1px solid #2773f6;
  background: rgba(39, 115, 246, 0.12);
  pointer-events: none;
}

.dag-canvas.is-selecting {
  cursor: crosshair;
  touch-action: none;
  user-select: none;
}
```

不要增加工具栏、计数角标或动画。

### Task 5: 静态审计、清理、提交与服务重启

**Files:**
- Audit: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Audit: `frontend/src/features/academic-flow/canvasPan.ts`
- Audit: `frontend/src/styles.css`
- Audit: `docs/superpowers/specs/2026-08-10-flow-canvas-multi-selection-design.md`
- Audit: `docs/superpowers/plans/2026-08-10-flow-canvas-multi-selection.md`

**Interfaces:**
- Consumes: Tasks 1–4 的完整改动。
- Produces: 一个功能检查点和重新启动的本地前后端服务。

- [ ] **Step 1: 业务逻辑静态审计**

逐项检查，不运行测试、构建或浏览器：

- 左键空白框选与右键平移的按键条件互斥；
- 节点、连接点和连接线事件不会冒泡启动框选；
- 选择矩形和节点矩形使用相同未缩放画布坐标；
- 框选仅包含 `canMoveNode` 为真的节点；
- 批量移动只调用一次 `onUpdateNodePositions`；
- 边界约束对整组使用相同位移；
- 锁定、删除、流程切换和指针取消均清理瞬时状态；
- `git diff --check` 无错误。

- [ ] **Step 2: 清理开发缓存**

仅查找并删除源码目录中的 `.pytest_cache`、`__pycache__` 和 `*.egg-info`，不触碰 `backend/.venv` 或 `frontend/node_modules`。

- [ ] **Step 3: 仅暂存本需求文件**

```bash
git add \
  frontend/src/features/academic-flow/AcademicFlowDesigner.tsx \
  frontend/src/features/academic-flow/canvasPan.ts \
  frontend/src/styles.css \
  docs/superpowers/plans/2026-08-10-flow-canvas-multi-selection.md
```

确认用户原有工作区改动仍未暂存。

- [ ] **Step 4: 创建完成检查点**

```bash
git commit -m "feat: add flow canvas multi-selection"
```

- [ ] **Step 5: 本地重启服务**

先停止当前前后端会话，再在同一运行环境中启动：

```bash
(cd backend && ./.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000) &
exec ./.local/node/bin/node frontend/node_modules/vite/bin/vite.js frontend --host 0.0.0.0 --port 5173
```

后端必须以 `/ai/github-repo/moyin/backend` 为工作目录，确保读取 `backend/.env` 和 `backend/storage/app.db`。

- [ ] **Step 6: 检查服务可访问性**

仅检查端口响应，不进行浏览器交互测试：

```bash
curl -sS -o /dev/null -w 'frontend=%{http_code}\n' http://127.0.0.1:5173/
curl -sS -o /dev/null -w 'backend=%{http_code}\n' http://127.0.0.1:8000/docs
```

预期：前端与后端均返回 `200`。
