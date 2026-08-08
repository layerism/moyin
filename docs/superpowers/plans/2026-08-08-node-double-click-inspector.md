# Node Double-Click Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a workflow node to open its existing settings panel on double-click only while the designer is editable.

**Architecture:** Reuse `FlowNodeCanvas`'s existing `locked` flag and `onOpenInspector(nodeId)` callback. Add one guarded native `onDoubleClick` handler to the node button; keep all selection, drag, connection, revision-permission, and inspector logic unchanged.

**Tech Stack:** React 18, TypeScript, native DOM mouse events.

## Global Constraints

- Commit `f845c3c` is the pre-implementation checkpoint; work on the current branch and make one final implementation commit.
- Do not stage or modify unrelated existing changes in `AGENTS.md`, `docs/05_oa_graph.md`, or `.superpowers/`.
- Single-click selection, node dragging, port connection, the gear action, and existing revision field restrictions must remain unchanged.
- When `locked` is true, double-click must do nothing and must not unlock revision editing.
- Double-clicking a `.connection-port` must not open the inspector.
- Do not add components, state, dependencies, APIs, database fields, backend logic, or CSS.
- Do not run automated tests, builds, or browser automation; perform static difference review only and leave interaction verification to the user.
- At completion, clean project-generated Python/test caches and restart the local FastAPI and Vite services without Docker.

---

### Task 1: Add the guarded node double-click action

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:1239-1247`

**Interfaces:**
- Consumes: `locked: boolean` and `onOpenInspector: (nodeId: string) => void`, already provided to `FlowNodeCanvas`.
- Produces: native double-click behavior on each `.flow-node` button; no new exported interface.

- [ ] **Step 1: Add the minimal event handler**

Place this handler beside the existing `onClick` on the node button:

```tsx
onDoubleClick={(event) => {
  if (locked || (event.target as HTMLElement).closest(".connection-port")) return;
  onOpenInspector(node.id);
}}
```

Do not alter the existing `onClick`, pointer handlers, connection-port handlers, quick actions, or inspector component.

- [ ] **Step 2: Perform the static interaction audit**

Inspect the targeted diff and verify all five paths directly from source:

1. `locked === true` returns before opening the inspector.
2. A target inside `.connection-port` returns before opening the inspector.
3. Other node content calls the existing callback with the current `node.id`.
4. Existing single-click selection and pointer drag handlers are byte-for-byte unchanged.
5. Existing gear button still calls `onOpenInspector(node.id)`.

Run only:

```bash
git diff --check -- frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
git diff -- frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
```

Do not run TypeScript compilation, Vite build, automated tests, or browser tools.

### Task 2: Final checkpoint and local service restart

**Files:**
- Add to final commit: `docs/superpowers/plans/2026-08-08-node-double-click-inspector.md`
- Add to final commit: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`

**Interfaces:**
- Consumes: the completed guarded handler.
- Produces: one scoped Git checkpoint and refreshed local services.

- [ ] **Step 1: Confirm scope and clean caches**

Use `git status --short` and targeted diffs to ensure only the plan and designer file are part of this implementation. Find and remove only repository-local `.pytest_cache`, `__pycache__`, and `*.egg-info` directories, excluding virtual environments and `node_modules`.

- [ ] **Step 2: Create the final implementation commit**

Stage only the two files listed above, confirm `git diff --cached --check`, and commit:

```bash
git commit -m "feat: open node settings on double-click"
```

- [ ] **Step 3: Restart without Docker and hand off manual verification**

Resolve the exact repository-owned listeners on ports 8000 and 5173, terminate only those processes, then start the existing local Uvicorn and Vite commands. Verify only that `/api/health` and the frontend root return HTTP 200.

Ask the user to manually verify: draft double-click opens settings; published locked double-click does nothing; unlocked revision double-click opens settings; single-click, drag, ports, and gear remain unchanged.
