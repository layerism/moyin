# Flow Publish Button State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将流程发布操作收敛为“提交发布 / 流程修改 / 重新发布”三状态单按钮，并在已发布流程进入修订前锁定设计区。

**Architecture:** 新建纯函数模块集中派生按钮文案、动作、禁用状态和提示，避免 JSX 中重复嵌套判断。`AcademicFlowDesigner` 维护仅存在于当前页面会话的 `revisionEditing`，将系统操作锁与设计区只读锁分开；现有首次发布、修订影响预览和重新发布接口保持不变。

**Tech Stack:** React 18、TypeScript、Node.js test runner、Vite。

## Global Constraints

- 单一按钮只能显示“提交发布”“流程修改”或“重新发布”。
- “流程修改”仅进入前端修订模式，不写数据库、不创建版本。
- 已发布且未进入修订时，组件库、画布和节点设置保持只读。
- “重新发布”仅在存在实际未发布改动且学生名单有效时启用。
- 重新发布成功后退出修订模式并恢复只读。
- 不修改后端接口、数据库结构或连线约束。
- 不提交 `docs/05_oa_graph.md` 与 `.superpowers/sdd/` 下的用户现有内容。

---

### Task 1: 发布按钮状态派生函数

**Files:**
- Create: `frontend/src/features/academic-flow/publishButtonState.ts`
- Create: `frontend/tests/publishButtonState.test.ts`

**Interfaces:**
- Consumes: `published: boolean`、`revisionEditing: boolean`、`hasUnpublishedChanges: boolean`、`rosterActiveCount: number | null`、`operationLocked: boolean`。
- Produces: `getPublishButtonState(input): PublishButtonState`，其中 `action` 为 `"publish" | "begin-revision" | "republish"`。

- [ ] **Step 1: Write the failing state-table tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { getPublishButtonState } from "../src/features/academic-flow/publishButtonState.ts";

test("new draft uses the submit publish action", () => {
  assert.deepEqual(
    getPublishButtonState({
      hasUnpublishedChanges: true,
      operationLocked: false,
      published: false,
      revisionEditing: false,
      rosterActiveCount: 1,
    }),
    { action: "publish", disabled: false, label: "提交发布", title: undefined },
  );
});

test("clean published flow uses the begin revision action", () => {
  assert.deepEqual(
    getPublishButtonState({
      hasUnpublishedChanges: false,
      operationLocked: false,
      published: true,
      revisionEditing: false,
      rosterActiveCount: 1,
    }),
    { action: "begin-revision", disabled: false, label: "流程修改", title: undefined },
  );
});

test("revision without changes keeps republish disabled", () => {
  assert.deepEqual(
    getPublishButtonState({
      hasUnpublishedChanges: false,
      operationLocked: false,
      published: true,
      revisionEditing: true,
      rosterActiveCount: 1,
    }),
    {
      action: "republish",
      disabled: true,
      label: "重新发布",
      title: "当前没有待发布的修订",
    },
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd frontend && node --experimental-strip-types --test tests/publishButtonState.test.ts`

Expected: FAIL because `publishButtonState.ts` does not exist.

- [ ] **Step 3: Implement the pure state function**

```ts
export type PublishButtonAction = "publish" | "begin-revision" | "republish";

export type PublishButtonState = {
  action: PublishButtonAction;
  disabled: boolean;
  label: "提交发布" | "流程修改" | "重新发布";
  title: string | undefined;
};

export function getPublishButtonState(input: {
  hasUnpublishedChanges: boolean;
  operationLocked: boolean;
  published: boolean;
  revisionEditing: boolean;
  rosterActiveCount: number | null;
}): PublishButtonState {
  if (input.published && !input.revisionEditing) {
    return {
      action: "begin-revision",
      disabled: input.operationLocked,
      label: "流程修改",
      title: undefined,
    };
  }

  const action = input.published ? "republish" : "publish";
  const label = input.published ? "重新发布" : "提交发布";
  const title = input.operationLocked
    ? undefined
    : input.rosterActiveCount === null
      ? "正在读取学生名单"
      : input.rosterActiveCount === 0
        ? "请先导入学生名单"
        : input.published && !input.hasUnpublishedChanges
          ? "当前没有待发布的修订"
          : undefined;

  return {
    action,
    disabled: input.operationLocked || title !== undefined,
    label,
    title,
  };
}
```

- [ ] **Step 4: Add roster and operation-lock cases, then verify GREEN**

```ts
test("publish explains roster and operation locks", () => {
  const base = {
    hasUnpublishedChanges: true,
    operationLocked: false,
    published: false,
    revisionEditing: false,
  };

  assert.deepEqual(getPublishButtonState({ ...base, rosterActiveCount: null }), {
    action: "publish",
    disabled: true,
    label: "提交发布",
    title: "正在读取学生名单",
  });
  assert.deepEqual(getPublishButtonState({ ...base, rosterActiveCount: 0 }), {
    action: "publish",
    disabled: true,
    label: "提交发布",
    title: "请先导入学生名单",
  });
  assert.equal(
    getPublishButtonState({
      ...base,
      operationLocked: true,
      rosterActiveCount: 1,
    }).disabled,
    true,
  );
});
```

Run: `cd frontend && node --experimental-strip-types --test tests/publishButtonState.test.ts`

Expected: all state-table tests PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add frontend/src/features/academic-flow/publishButtonState.ts frontend/tests/publishButtonState.test.ts
git commit -m "Add flow publish button state model"
```

---

### Task 2: 接入单按钮修订状态机

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:68-365`
- Test: `frontend/tests/publishButtonState.test.ts`

**Interfaces:**
- Consumes: `getPublishButtonState` 与 `PublishButtonAction`。
- Produces: 页面级 `revisionEditing`，派生的 `editorLocked`，以及统一按钮点击入口 `handlePublishButtonClick()`。

- [ ] **Step 1: Extend the failing tests for initialization and post-publish intent**

Add and export this helper from `publishButtonState.ts` only after the test fails:

```ts
test("published draft changes restore revision editing on load", () => {
  assert.equal(getInitialRevisionEditing(true, true), true);
  assert.equal(getInitialRevisionEditing(true, false), false);
  assert.equal(getInitialRevisionEditing(false, true), false);
});
```

Run: `cd frontend && node --experimental-strip-types --test tests/publishButtonState.test.ts`

Expected: FAIL because `getInitialRevisionEditing` is not exported.

- [ ] **Step 2: Implement revision initialization**

```ts
export function getInitialRevisionEditing(
  published: boolean,
  hasUnpublishedChanges: boolean,
) {
  return published && hasUnpublishedChanges;
}
```

Run: `cd frontend && node --experimental-strip-types --test tests/publishButtonState.test.ts`

Expected: all focused tests PASS.

- [ ] **Step 3: Separate operation locking from editor locking**

In `AcademicFlowDesigner`, replace the current lock derivation with:

```ts
const [revisionEditing, setRevisionEditing] = useState(() =>
  getInitialRevisionEditing(process.published, process.hasUnpublishedChanges),
);
const operationLocked = saving || revisionImpact !== null;
const editorLocked = operationLocked || (process.published && !revisionEditing);
```

Replace every existing mutation guard that currently reads `designLocked` with `editorLocked`: `commitDesignChange`, `addNode`, `updateNode`, `connectNodes`, `deleteEdge`, `moveNode`, `deleteNode`, `autoLayoutNodes`, `ComponentPalette.locked`, `FlowNodeCanvas.locked`, `NodeInspector.editingLocked`, “保存修订/保存草稿” and “保存并退出”. Use `operationLocked` only when deriving the unified publish button so “流程修改” remains available while the canvas is read-only.

- [ ] **Step 4: Derive and render the unified button**

```ts
const publishButtonState = getPublishButtonState({
  hasUnpublishedChanges: process.hasUnpublishedChanges,
  operationLocked,
  published: process.published,
  revisionEditing,
  rosterActiveCount,
});

const handlePublishButtonClick = () => {
  if (publishButtonState.action === "begin-revision") {
    setRevisionEditing(true);
    return;
  }
  void preparePublish();
};
```

Replace the existing publish JSX with exactly one button:

```tsx
<button
  disabled={publishButtonState.disabled}
  onClick={handlePublishButtonClick}
  title={publishButtonState.title}
>
  {publishButtonState.label}
</button>
```

- [ ] **Step 5: Reset editing only after successful publish**

Immediately after `onProcessChange(nextProcess)` in the successful branch of `publishProcess`, add:

```ts
setRevisionEditing(false);
```

Do not reset `revisionEditing` in error, conflict or cancellation branches. This preserves the teacher's revision session after failures.

- [ ] **Step 6: Run focused tests and compile**

Run: `cd frontend && node --experimental-strip-types --test tests/publishButtonState.test.ts tests/flowRevision.test.ts`

Expected: all focused tests PASS.

Run: `cd frontend && npm run build`

Expected: TypeScript and Vite build exit 0.

- [ ] **Step 7: Commit Task 2**

```bash
git add frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/features/academic-flow/publishButtonState.ts frontend/tests/publishButtonState.test.ts
git commit -m "Unify flow publish button states"
```

---

### Task 3: 全量验证与浏览器交互检查

**Files:**
- Verify only; no committed screenshot or report artifacts.

**Interfaces:**
- Consumes: completed Task 1 and Task 2 implementation.
- Produces: test, build and rendered-interaction evidence.

- [ ] **Step 1: Run all frontend unit tests**

Run: `cd frontend && node --experimental-strip-types --test tests/*.test.ts`

Expected: zero failures.

- [ ] **Step 2: Run production build and whitespace validation**

Run: `cd frontend && npm run build`

Expected: TypeScript and Vite build exit 0.

Run: `git diff --check`

Expected: exit 0 with no output.

- [ ] **Step 3: Restart the frontend development server**

Stop the existing Vite process and run `npm run dev` from `frontend/`. Confirm the served module contains `getPublishButtonState` before browser validation because this workspace's file watcher can retain stale modules.

- [ ] **Step 4: Validate the rendered state transition in an isolated browser tab**

The flow under test is: published flow page → “流程修改” → edit one node → “重新发布” becomes enabled.

Verify:

1. Page title and meaningful DOM content render without a framework overlay.
2. The initial published-clean state shows one “流程修改” button and no “提交发布” or “重新发布” button.
3. Before clicking “流程修改”, component palette and canvas editing controls are disabled.
4. Clicking “流程修改” changes the same button to “重新发布” without navigation or an API write.
5. Before any design change, “重新发布” is disabled with title “当前没有待发布的修订”.
6. After one reversible design change in the isolated test tab, “重新发布” becomes enabled.
7. Browser console contains no relevant error or warning.

- [ ] **Step 5: Preserve the user tab and report remaining risk**

Close the isolated validation tab, keep the user's original flow tab, and report that the actual publish-confirm action was not executed during UI QA to avoid creating a new production-like flow version.
