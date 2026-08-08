# Node Inspector Escape and Auto-Layout Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Escape follow the existing node-inspector close semantics and remove the complete auto-layout feature from the workflow designer.

**Architecture:** `NodeInspector` reuses its existing `onClose` callback through a scoped window key listener, while the nested date-time picker consumes the first Escape and closes itself. Auto-layout is removed end-to-end from the designer component, canvas props, pure revision helper, and its dedicated test so no hidden dead feature remains.

**Tech Stack:** React 18, TypeScript, native keyboard events, Node `node:test` source cleanup.

## Global Constraints

- Commit `1e4e8f0` is the pre-implementation checkpoint; work on the current branch and create one final implementation commit.
- Do not stage or modify unrelated existing changes in `AGENTS.md`, `docs/05_oa_graph.md`, or `.superpowers/`.
- Escape must use the exact same `onClose` path as the node inspector's `×` and “完成” controls; it must not roll back current working-draft edits.
- When the date-time picker is open, its first Escape closes only the picker without confirming or changing the date; the next Escape closes the inspector.
- Remove the full auto-layout feature, including UI, callback plumbing, pure helper, helper-only type/function, and dedicated test; retain zoom display, pan, zoom, and node dragging.
- Do not add components, state, styles, dependencies, APIs, database fields, or backend logic.
- Do not run automated tests, builds, or browser automation; perform static difference and call-chain review only and leave interaction verification to the user.
- At completion, remove repository-local `.pytest_cache`, `__pycache__`, and `*.egg-info` outside virtual environments, then restart local FastAPI and Vite without Docker.

---

### Task 1: Implement nested Escape close behavior

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:1386-1394`
- Modify: `frontend/src/features/academic-flow/NodeDateTimePicker.tsx:210-216`

**Interfaces:**
- Consumes: `NodeInspector`'s existing `onClose: () => void` and `NodeDateTimePicker`'s existing `closePicker(): void`.
- Produces: outer inspector Escape close and inner-picker-first Escape priority; no new exports.

- [ ] **Step 1: Add the inspector window listener to its existing lifecycle effect**

Extend the body-scroll effect without creating a second lifecycle:

```tsx
useEffect(() => {
  const previousOverflow = document.body.style.overflow;
  const closeOnEscape = (event: globalThis.KeyboardEvent) => {
    if (event.key === "Escape") onClose();
  };
  document.body.style.overflow = "hidden";
  window.addEventListener("keydown", closeOnEscape);
  return () => {
    window.removeEventListener("keydown", closeOnEscape);
    document.body.style.overflow = previousOverflow;
  };
}, [onClose]);
```

This must call `onClose` directly and must not mutate node data, revision state, or draft state.

- [ ] **Step 2: Make the nested picker consume and close on its first Escape**

Change only its current Escape branch:

```tsx
if (event.key === "Escape") {
  event.preventDefault();
  event.stopPropagation();
  closePicker();
  return;
}
```

Retain `stopPropagation()` so the same key event never reaches the outer window listener. `closePicker()` restores focus to the trigger and does not call `onConfirm`.

- [ ] **Step 3: Perform a static keyboard audit**

Confirm from the targeted diff that the outer listener is registered/unregistered with the same function, the effect depends on `onClose`, picker Escape calls `closePicker()` after stopping propagation, and neither path updates fields or dates. Run only `git diff --check` and targeted `git diff`; do not run tests, compilation, build, or browser tools.

### Task 2: Remove auto-layout end-to-end

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Modify: `frontend/src/features/academic-flow/flowRevision.ts:1-5,97-106`
- Modify: `frontend/tests/flowRevision.test.ts:4-14,67-88`

**Interfaces:**
- Removes: `layoutRevisionNodes<T>()`, helper-only `PositionedNode`, `FlowNodeCanvas.onAutoLayout`, `AcademicFlowDesigner.autoLayoutNodes`, and the toolbar action.
- Preserves: `canMoveRevisionNode`, all revision rules, zoom percentage display, canvas pan/zoom, and pointer-based node movement.

- [ ] **Step 1: Remove designer and canvas callback plumbing**

In `AcademicFlowDesigner.tsx`, delete:

- `layoutRevisionNodes` from the `flowRevision` import.
- The complete `autoLayoutNodes` function.
- `onAutoLayout={autoLayoutNodes}` at the `FlowNodeCanvas` call.
- `onAutoLayout` from `FlowNodeCanvas` destructuring and its prop type.
- The local `autoLayout` wrapper.

Do not change `canMoveNode`, `nodeMovementLocked`, pointer handlers, `commitDesignChange`, or any other callback.

- [ ] **Step 2: Remove the toolbar action while retaining zoom**

Reduce the toolbar to:

```tsx
<div className="canvas-toolbar">
  <button type="button">{Math.round(zoom * 100)}%</button>
</div>
```

Do not remove the toolbar container or alter CSS; it continues to position the zoom indicator.

- [ ] **Step 3: Remove the orphaned pure helper and its dedicated test**

In `flowRevision.ts`, delete `PositionedNode`, `layoutRevisionNodes`, and `snapToGrid`; retain `IdentifiedNode` because `filterPublishedRuntimeNodes` still consumes it. In `flowRevision.test.ts`, delete the `layoutRevisionNodes` import and the complete test named `automatic layout merges all node positions in one immutable result`; do not alter other revision tests.

- [ ] **Step 4: Perform a static removal audit**

Run source searches for `自动布局`, `onAutoLayout`, `autoLayoutNodes`, and `layoutRevisionNodes`; every result must be absent outside historical documentation. Confirm `flowRevision.ts` no longer contains `snapToGrid`; retain the separate `AcademicFlowDesigner.tsx` grid-snapping helper because manual node creation and dragging still use it. Review the designer diff to confirm zoom, pan, drag, and revision guards remain unchanged. Do not execute the remaining tests.

### Task 3: Final scope, checkpoint, and service restart

**Files:**
- Add to final commit: `docs/superpowers/plans/2026-08-08-node-inspector-escape-remove-auto-layout.md`
- Add to final commit: the four modified frontend files from Tasks 1-2.

**Interfaces:**
- Consumes: completed Escape behavior and auto-layout removal.
- Produces: one scoped implementation commit and refreshed local services.

- [ ] **Step 1: Confirm scope and cache cleanup**

Use `git status --short`, `git diff --check`, targeted diffs, and the removal searches. Remove only repository-local `.pytest_cache`, `__pycache__`, and `*.egg-info` directories outside `.venv` and `node_modules`.

- [ ] **Step 2: Create the final checkpoint**

Stage only this plan plus `AcademicFlowDesigner.tsx`, `NodeDateTimePicker.tsx`, `flowRevision.ts`, and `flowRevision.test.ts`. Confirm the cached diff and commit:

```bash
git commit -m "feat: close node settings with escape"
```

- [ ] **Step 3: Restart services and hand off manual verification**

Resolve exact repository-owned listeners on ports 8000 and 5173, terminate only those processes, then start the existing Uvicorn and Vite commands without Docker. Verify only `/api/health` and the frontend root return HTTP 200.

Ask the user to manually verify inspector Escape, draft persistence, nested picker priority, absence of auto-layout, and unchanged zoom/pan/drag behavior.
