# 流程画布方向键移动节点实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让教师在流程画布选中一个或多个可移动节点后，使用四个方向键按 16px 网格步长移动节点。

**Architecture:** 在现有 `canvasPan.ts` 增加方向键映射和编辑控件判断函数；`FlowNodeCanvas` 注册 `window.keydown` 监听，过滤当前可移动选择集，复用 `constrainCanvasGroupDelta()` 约束边界，并通过现有 `onUpdateNodePositions()` 一次提交整组坐标。

**Tech Stack:** React 18、TypeScript、原生 KeyboardEvent、现有画布坐标工具

## Global Constraints

- 支持 `ArrowUp`、`ArrowDown`、`ArrowLeft`、`ArrowRight` 四个方向。
- 每次移动 16px，与现有画布网格一致。
- 单选移动一个节点，多选保持相对位置整体移动。
- 画布锁定、节点不可移动、编辑控件聚焦或任一修饰键按下时不处理。
- 节点不得越过画布左侧或顶部 16px 最小边界。
- 每次有效按键只调用一次 `onUpdateNodePositions()`。
- 不修改节点、连线、流程快照、后端接口或数据库结构。
- 按项目约定不运行测试或浏览器自动化，只进行静态业务逻辑审计。
- 本计划提交作为实施前检查点；实现过程中不提交，完成后只创建一次结果提交。

---

### Task 1: 增加方向键解析与编辑目标判断

**Files:**
- Modify: `frontend/src/features/academic-flow/canvasPan.ts:1-75`

**Interfaces:**
- Consumes: 键盘 `key: string`、移动步长 `step: number`、事件目标 `EventTarget | null`。
- Produces: `getCanvasArrowKeyDelta(key, step): CanvasPoint | null`；`isCanvasKeyboardEditingTarget(target): boolean`。

- [ ] **Step 1: 增加四向位移解析函数**

在 `CanvasPoint` 类型之后加入：

```ts
const canvasArrowDirections: Record<string, CanvasPoint> = {
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
};

export function getCanvasArrowKeyDelta(key: string, step: number): CanvasPoint | null {
  const direction = canvasArrowDirections[key];
  return direction
    ? { x: direction.x * step, y: direction.y * step }
    : null;
}
```

- [ ] **Step 2: 增加编辑控件目标判断函数**

在方向键解析函数之后加入：

```ts
export function isCanvasKeyboardEditingTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
  ));
}
```

该判断覆盖输入框、多行文本框、下拉框以及启用的可编辑内容区域；普通节点按钮不属于编辑目标。

---

### Task 2: 为已选节点注册四向键盘移动

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:20-33`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:989-1015`
- Reference only: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:1104-1185`

**Interfaces:**
- Consumes: Task 1 的 `getCanvasArrowKeyDelta()`、`isCanvasKeyboardEditingTarget()`，以及现有 `selectedNodeIds`、`layoutNodes`、`canMoveNode()`、`constrainCanvasGroupDelta()`、`onUpdateNodePositions()`。
- Produces: 无新组件属性；每次有效方向键产生一个 `Record<string, CanvasPoint>` 批量位置更新。

- [ ] **Step 1: 导入键盘辅助函数**

在现有 `./canvasPan` 导入列表中加入：

```ts
getCanvasArrowKeyDelta,
isCanvasKeyboardEditingTarget,
```

- [ ] **Step 2: 注册方向键监听**

在现有删除连线的 `useEffect` 之后加入：

```ts
useEffect(() => {
  const moveSelectedNodes = (event: KeyboardEvent) => {
    if (
      locked
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
      || isCanvasKeyboardEditingTarget(event.target)
    ) {
      return;
    }
    const desiredDelta = getCanvasArrowKeyDelta(event.key, canvasGridSize);
    if (!desiredDelta) return;
    const movableNodes = layoutNodes.filter(
      (node) => selectedNodeIds.has(node.id) && canMoveNode(node.id),
    );
    if (movableNodes.length === 0) return;
    event.preventDefault();
    const delta = constrainCanvasGroupDelta(
      movableNodes,
      desiredDelta,
      canvasGridSize,
    );
    if (delta.x === 0 && delta.y === 0) return;
    onUpdateNodePositions(Object.fromEntries(
      movableNodes.map((node) => [node.id, {
        x: node.x + delta.x,
        y: node.y + delta.y,
      }]),
    ));
  };

  window.addEventListener("keydown", moveSelectedNodes);
  return () => window.removeEventListener("keydown", moveSelectedNodes);
}, [canMoveNode, layoutNodes, locked, onUpdateNodePositions, selectedNodeIds]);
```

`layoutNodes` 兼容 `CanvasPoint`，因此可直接传入 `constrainCanvasGroupDelta()`；批量映射只包含当前选择集中仍允许移动的节点。

- [ ] **Step 3: 静态审计键盘链路和现有交互**

运行只读检查：

```bash
git diff -- frontend/src/features/academic-flow/canvasPan.ts frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
git diff --check -- frontend/src/features/academic-flow/canvasPan.ts frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
sed -n '1,125p' frontend/src/features/academic-flow/canvasPan.ts
sed -n '15,40p' frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
sed -n '980,1070p' frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
sed -n '1120,1195p' frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
```

逐项确认：

- 四个方向分别映射到正确的 16px 位移；
- 非方向键、四种修饰键和编辑控件目标均提前返回；
- `locked` 或无可移动选择时不调用 `preventDefault()` 和位置更新；
- 有选择时先 `preventDefault()`，边界位移为零时不提交；
- 多选节点只计算一次统一位移，并只调用一次批量位置更新；
- 现有拖拽继续调用同一个 `constrainCanvasGroupDelta()`；
- 删除连线监听仍只处理 `Backspace` 和 `Delete`，没有快捷键冲突。

- [ ] **Step 4: 清理限定缓存并创建结果提交**

显式跳过 `.venv` 和 `node_modules`，只清理项目源码范围内允许删除的缓存，再提交两个目标文件：

```bash
find backend frontend \( -path backend/.venv -o -path frontend/node_modules \) -prune -o -type d \( -name .pytest_cache -o -name __pycache__ -o -name '*.egg-info' \) -prune -print
find backend frontend \( -path backend/.venv -o -path frontend/node_modules \) -prune -o -type d \( -name .pytest_cache -o -name __pycache__ -o -name '*.egg-info' \) -prune -exec rm -r -- {} +
git status --short
git add frontend/src/features/academic-flow/canvasPan.ts frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
git commit -m "feat: move selected canvas nodes with arrow keys"
```

预期：结果提交只包含 `canvasPan.ts` 和 `AcademicFlowDesigner.tsx`；工作树中的其他已有改动保持原状。

- [ ] **Step 5: 以本地方式重启并核对服务进程**

先使用 `lsof -nP -iTCP:8000 -sTCP:LISTEN` 和 `lsof -nP -iTCP:5173 -sTCP:LISTEN` 识别本项目现有进程，仅终止已确认属于当前项目的进程。然后分别启动：

```bash
cd backend
./.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

```bash
cd frontend
export PATH="$PWD/../.local/node/bin:$PATH"
npm run dev
```

预期：后端日志出现 `Application startup complete`，前端日志出现 `VITE ... ready`；不发送 HTTP 业务请求。
