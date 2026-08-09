# 表单字段与选项拖拽排序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用统一 Pointer Events 拖拽手柄替代字段与单选/多选选项的可见上移、下移操作，并支持鼠标、触控和键盘排序。

**Architecture:** 在独立纯函数模块中集中处理插入位置和数组重排，`FormFieldEditor` 只管理瞬时拖拽状态、指针捕获与现有 `onChange` 数据提交。字段与选项复用同一套目标解析规则，通过拖拽类型和所属字段 ID 隔离，避免跨列表放置。

**Tech Stack:** React 18、TypeScript、Pointer Events、现有 CSS；不新增第三方依赖。

## Global Constraints

- 仅拖拽手柄可以启动排序，输入框、复选框、折叠控制和菜单不能启动拖拽。
- 鼠标、触控笔和触屏统一使用 Pointer Events；手柄使用 `touch-action: none`。
- 字段与选项数据结构、校验规则和后端接口保持不变。
- 锁定状态禁用拖拽，但选择字段仍可展开查看。
- 字段和选项“⋯”菜单只保留删除，不再显示上移、下移。
- 按项目规则不运行自动化测试、构建或浏览器自动化；只做静态业务审计和 Vite 模块编译检查，最终由用户手动验证。
- 实现阶段中间不提交；全部实现和审计完成后只提交一次任务文件。

---

### Task 1: 提取拖拽排序纯函数

**Files:**
- Create: `frontend/src/features/academic-flow/reorder.ts`

**Interfaces:**
- Produces: `ReorderPlacement = "before" | "after"`
- Produces: `getReorderPlacement(pointerY, top, height): ReorderPlacement`
- Produces: `getReorderDestination(sourceIndex, targetIndex, placement, itemCount): number | null`
- Produces: `reorderItem<T>(items, sourceIndex, destinationIndex): T[]`

- [ ] **Step 1: 创建纯函数模块并固定索引语义**

```ts
export type ReorderPlacement = "before" | "after";

export function getReorderPlacement(
  pointerY: number,
  top: number,
  height: number,
): ReorderPlacement {
  return pointerY < top + height / 2 ? "before" : "after";
}

export function getReorderDestination(
  sourceIndex: number,
  targetIndex: number,
  placement: ReorderPlacement,
  itemCount: number,
): number | null {
  const rawInsertionIndex = targetIndex + (placement === "after" ? 1 : 0);
  const destinationIndex = rawInsertionIndex > sourceIndex
    ? rawInsertionIndex - 1
    : rawInsertionIndex;
  if (
    sourceIndex < 0
    || sourceIndex >= itemCount
    || destinationIndex < 0
    || destinationIndex >= itemCount
    || destinationIndex === sourceIndex
  ) return null;
  return destinationIndex;
}

export function reorderItem<T>(
  items: T[],
  sourceIndex: number,
  destinationIndex: number,
): T[] {
  const next = [...items];
  const [item] = next.splice(sourceIndex, 1);
  next.splice(destinationIndex, 0, item);
  return next;
}
```

- [ ] **Step 2: 静态核对关键索引案例**

人工逐项核对：`0 -> 2 after` 得到末位、`2 -> 0 before` 得到首位、相邻项放回原位返回 `null`、空列表与越界索引不产生变更。

---

### Task 2: 建立统一拖拽状态机

**Files:**
- Modify: `frontend/src/features/academic-flow/FormFieldEditor.tsx`

**Interfaces:**
- Consumes: Task 1 的四个导出接口
- Produces: `DragState`、`beginPointerReorder`、`updatePointerReorder`、`finishPointerReorder`、`cancelPointerReorder`

- [ ] **Step 1: 定义拖拽列表与状态**

```ts
type DragList =
  | { kind: "field" }
  | { kind: "option"; fieldId: string };

type DragState = {
  active: boolean;
  list: DragList;
  placement: ReorderPlacement;
  pointerId: number;
  sourceIndex: number;
  startX: number;
  startY: number;
  targetIndex: number;
};
```

- [ ] **Step 2: 仅从手柄启动并捕获指针**

`onPointerDown` 在未锁定且主指针按下时记录状态并调用 `setPointerCapture`；移动距离达到 4px 后将 `active` 设为 `true`。字段卡片和选项行不注册启动事件。

- [ ] **Step 3: 解析同列表目标**

字段容器使用 `data-reorder-kind="field"` 和 `data-reorder-index`；选项容器额外使用 `data-reorder-owner={field.id}`。移动时用 `document.elementFromPoint(...).closest("[data-reorder-kind]")` 获取目标，只接受类型及 owner 与来源一致的目标，并调用 `getReorderPlacement`。

- [ ] **Step 4: 放置时一次性更新业务数据**

字段放置：

```ts
onChange(reorderItem(upgradeFormFields(fields), sourceIndex, destinationIndex));
```

选项放置：

```ts
const fieldIndex = displayedFields.findIndex((field) => field.id === list.fieldId);
const options = displayedFields[fieldIndex]?.options ?? [];
updateField(fieldIndex, {
  options: reorderItem(options, sourceIndex, destinationIndex),
});
```

无有效目标或目标位置不变时只清理状态，不调用 `onChange`。

- [ ] **Step 5: 覆盖取消与锁定清理**

处理 `pointercancel`、`disabled` 变化、项目删除和组件卸载，确保拖拽状态清空；释放指针捕获失败时不得抛出业务错误。

---

### Task 3: 接入字段与选项拖拽手柄

**Files:**
- Modify: `frontend/src/features/academic-flow/FormFieldEditor.tsx`

**Interfaces:**
- Consumes: Task 2 的拖拽状态与事件处理函数
- Produces: 同文件 `ReorderHandle` 小组件

- [ ] **Step 1: 添加六点拖拽手柄组件**

按钮固定 `type="button"`，设置 `aria-label`、`aria-pressed={dragging}`、`disabled` 和 Pointer Events 回调。手柄只转发事件，不直接修改字段数据。

- [ ] **Step 2: 为所有字段接入手柄和目标属性**

文本字段手柄位于标题栏左侧；选择字段手柄位于折叠摘要栏最左侧。字段 `<section>` 添加索引数据属性和拖动/插入位置 class，字段 ID 继续作为 React key。

- [ ] **Step 3: 为单选/多选选项接入手柄和目标属性**

选项行左侧改为“六点手柄 + 自动序号”，添加选项所属字段 ID 与索引数据属性。输入框及“⋯”菜单不绑定拖拽启动逻辑。

- [ ] **Step 4: 菜单只保留删除**

字段菜单和选项菜单移除“上移”“下移”，保留当前删除回调和危险色样式。

- [ ] **Step 5: 添加键盘排序**

手柄 `onKeyDown` 仅响应 `Alt + ArrowUp/ArrowDown`，调用现有 `moveField` 或 `moveOption`；边界不移动，成功移动时阻止默认滚动。

---

### Task 4: 添加紧凑拖拽视觉反馈

**Files:**
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: `.form-field-reorder-handle`、`.is-dragging`、`.drop-before`、`.drop-after`、`.selection-option-order`

- [ ] **Step 1: 设计手柄状态**

手柄宽度 28px，默认灰色、悬停和聚焦蓝色；设置 `cursor: grab`、拖动中 `grabbing`、`touch-action: none` 与 `user-select: none`。

- [ ] **Step 2: 添加拖动项和插入线**

`.is-dragging` 降低透明度并显示浅蓝轮廓；`.drop-before::before` 与 `.drop-after::after` 使用绝对定位 2px 蓝线，不改变项目高度。

- [ ] **Step 3: 调整网格**

字段摘要增加手柄列，标题仍占剩余宽度；选项行保持“手柄/序号、输入、菜单”三列。移动端不得遮挡标题、必填或菜单。

---

### Task 5: 静态审计、清理、提交与重启

**Files:**
- Audit: `frontend/src/features/academic-flow/reorder.ts`
- Audit: `frontend/src/features/academic-flow/FormFieldEditor.tsx`
- Audit: `frontend/src/styles.css`

- [ ] **Step 1: 运行静态差异检查**

```bash
git diff --check -- frontend/src/features/academic-flow/reorder.ts \
  frontend/src/features/academic-flow/FormFieldEditor.tsx frontend/src/styles.css
```

- [ ] **Step 2: 审计业务边界**

使用 `rg` 确认菜单无上移/下移、字段与选项均有专用手柄、四类 Pointer Events 齐全、`Alt + ArrowUp/ArrowDown` 存在、锁定状态传入手柄，并确认 `formFields.ts`、`types.ts` 与 `backend/` 无差异。

- [ ] **Step 3: 请求 Vite 实时编译目标模块**

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  http://localhost:5173/src/features/academic-flow/FormFieldEditor.tsx
```

预期 HTTP 200；不运行构建或浏览器自动化。

- [ ] **Step 4: 清理缓存**

查找并清理源代码目录的 `.pytest_cache`、`__pycache__`、`*.egg-info`，排除 `node_modules` 与 `.venv`。

- [ ] **Step 5: 仅暂存任务文件并创建完成提交**

```bash
git add frontend/src/features/academic-flow/reorder.ts \
  frontend/src/features/academic-flow/FormFieldEditor.tsx frontend/src/styles.css
git commit -m "feat: drag to reorder form fields"
```

- [ ] **Step 6: 本地重启并验证服务**

精确识别当前项目监听 5173/8000 的 PID 与 cwd，停止后分别从 `frontend/` 运行 `npm run dev`、从 `backend/` 运行 `./.venv/bin/python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`。确认前端根页面与 `/api/health` 均返回 HTTP 200。
