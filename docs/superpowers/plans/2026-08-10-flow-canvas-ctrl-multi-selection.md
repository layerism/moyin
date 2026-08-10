# Flow Canvas Ctrl Multi-Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Ctrl+left-click incremental selection and deselection to the existing flow-canvas multi-selection model without changing group dragging.

**Architecture:** Reuse `selectedNodeIds` as the sole selection set. Handle Ctrl toggling during node `pointerdown`, prevent that gesture from creating a drag snapshot, and make the later `click` event a no-op for Ctrl gestures.

**Tech Stack:** React, TypeScript, native Pointer Events.

## Global Constraints

- Modify only the existing canvas component; do not add backend fields, global keyboard listeners, dependencies, or new selection state.
- Ctrl selection applies only to nodes accepted by `canMoveNode(node.id)`.
- Ctrl toggling never starts dragging; group movement starts only after Ctrl is released.
- Do not add Shift, Meta, or Command selection behavior.
- Per repository policy, do not run tests, builds, or browser automation during implementation; perform static business-logic audit only.
- Preserve all unrelated working-tree changes and create no intermediate commit.

---

### Task 1: Add Ctrl toggle behavior to flow nodes

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:1075-1104`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:1455-1472`

**Interfaces:**
- Consumes: `selectedNodeIds: Set<string>`, `activeNodeId: string`, `canMoveNode(nodeId: string): boolean`, and `onSelectNode(nodeId: string): void`.
- Produces: local `toggleNodeSelection(nodeId: string): void`; no public API or persisted-flow change.

- [ ] **Step 1: Add one local selection toggle helper before `startNodeDrag`**

```tsx
const toggleNodeSelection = (nodeId: string) => {
  setSelectedNodeIds((current) => {
    const next = new Set(current);
    if (next.has(nodeId)) {
      next.delete(nodeId);
      if (nodeId === activeNodeId) {
        const nextActiveId = next.values().next().value;
        if (typeof nextActiveId === "string") onSelectNode(nextActiveId);
      }
    } else {
      next.add(nodeId);
      onSelectNode(nodeId);
    }
    return next;
  });
};
```

The empty-set branch intentionally leaves the parent `activeNodeId` unchanged; selection styling and quick actions already depend on membership in `selectedNodeIds`.

- [ ] **Step 2: Make Ctrl+pointerdown toggle selection and exit before drag setup**

After the existing left-button, lock, movability, and connection-port guard, preserve `event.stopPropagation()` and add:

```tsx
if (event.ctrlKey) {
  event.preventDefault();
  toggleNodeSelection(node.id);
  return;
}
```

Keep the existing `dragIds`, `startPositions`, `setDraggingNodes`, and pointer-capture logic unchanged for non-Ctrl gestures.

- [ ] **Step 3: Prevent the node click handler from undoing the pointerdown toggle**

Change the node handler to receive the click event and keep ordinary single-selection behavior:

```tsx
onClick={(event) => {
  if (event.ctrlKey || selectedNodeIds.has(node.id)) return;
  setSelectedNodeIds(new Set([node.id]));
  onSelectNode(node.id);
}}
```

- [ ] **Step 4: Perform static interaction audit**

Run only:

```bash
rg -n "toggleNodeSelection|event\.ctrlKey|setDraggingNodes" frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
git diff --check -- frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
```

Confirm from the diff that Ctrl add/remove, ordinary single selection, locked-node behavior, marquee selection, and existing group drag remain mutually consistent.

