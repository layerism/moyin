# Flow Canvas Pan Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hand tool that pans the teacher workflow canvas without changing workflow data and remains usable after publication.

**Architecture:** Keep transient tool and pointer-capture state inside `FlowNodeCanvas`. Extract the scroll-delta calculation into a small pure geometry helper so direction and clamping are unit tested independently; the component applies the result to the existing scroll container.

**Tech Stack:** React 18, TypeScript, native Pointer Events, CSS, Node test runner, Vite.

## Global Constraints

- The tool pans only from the canvas background and does not start from nodes, ports, edges, or controls.
- Panning changes only `scrollLeft` and `scrollTop`; no workflow or database value is updated.
- Published flows retain all existing topology locks while canvas panning remains available.
- Do not add a third-party canvas or gesture dependency.

---

### Task 1: Canvas pan calculation

**Files:**
- Create: `frontend/src/features/academic-flow/canvasPan.ts`
- Create: `frontend/tests/canvasPan.test.ts`

**Interfaces:**
- Produces: `getCanvasPanScroll(start, current): { left: number; top: number }`, where `start` contains the pointer origin and initial scroll offsets.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { getCanvasPanScroll } from "../src/features/academic-flow/canvasPan.ts";

test("pans the viewport opposite to pointer movement", () => {
  assert.deepEqual(
    getCanvasPanScroll(
      { clientX: 120, clientY: 80, scrollLeft: 300, scrollTop: 200 },
      { clientX: 90, clientY: 130 },
    ),
    { left: 330, top: 150 },
  );
});

test("clamps canvas scroll offsets at zero", () => {
  assert.deepEqual(
    getCanvasPanScroll(
      { clientX: 10, clientY: 10, scrollLeft: 4, scrollTop: 6 },
      { clientX: 30, clientY: 40 },
    ),
    { left: 0, top: 0 },
  );
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd frontend && node --experimental-strip-types --test tests/canvasPan.test.ts`

Expected: FAIL because `canvasPan.ts` does not exist.

- [ ] **Step 3: Implement the minimal helper**

```ts
export type CanvasPanStart = {
  clientX: number;
  clientY: number;
  scrollLeft: number;
  scrollTop: number;
};

export function getCanvasPanScroll(
  start: CanvasPanStart,
  current: { clientX: number; clientY: number },
) {
  return {
    left: Math.max(0, start.scrollLeft - (current.clientX - start.clientX)),
    top: Math.max(0, start.scrollTop - (current.clientY - start.clientY)),
  };
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `cd frontend && node --experimental-strip-types --test tests/canvasPan.test.ts`

Expected: 2 tests pass.

### Task 2: Hand tool interaction and published-state exception

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:274-290,423-905`
- Modify: `frontend/src/styles.css:1559-1598,2195-2203`

**Interfaces:**
- Consumes: `getCanvasPanScroll` from Task 1.
- Produces: A toolbar button named `手形工具` with `aria-pressed`; a `locked: boolean` canvas prop; `.pan-tool-active` and `.is-panning` canvas states.

- [ ] **Step 1: Add the hand-tool state and pointer handlers**

In `FlowNodeCanvas`, add `panToolActive`, `panStart`, and handlers that:

```ts
const startCanvasPan = (event: PointerEvent<HTMLDivElement>) => {
  if (!panToolActive || event.target !== event.currentTarget || !canvasRef.current) return;
  setPanStart({
    clientX: event.clientX,
    clientY: event.clientY,
    scrollLeft: canvasRef.current.scrollLeft,
    scrollTop: canvasRef.current.scrollTop,
  });
  event.currentTarget.setPointerCapture(event.pointerId);
};
```

During pointer movement, call `getCanvasPanScroll`, assign both scroll offsets, and suppress connection-preview updates while panning. On pointer up or cancel, release capture and clear `panStart`.

- [ ] **Step 2: Add the accessible toolbar control**

Replace the inert `⌖` button with:

```tsx
<button
  aria-label="手形工具"
  aria-pressed={panToolActive}
  className={panToolActive ? "active" : ""}
  onClick={() => setPanToolActive((active) => !active)}
  title="拖动画布"
  type="button"
>
  <span aria-hidden="true">✋</span>
</button>
```

Use the compact hand symbol because this repository does not currently include an icon library; do not add a dependency for one toolbar glyph.

- [ ] **Step 3: Keep the pan surface interactive after publication**

Pass `locked={process.published}` to `FlowNodeCanvas`. When `locked` is true, do not execute node drag, connection, edge deletion, node actions, drop, or automatic-layout handlers, and do not render quick actions or connection ports. Keep node elements present with pointer events so a pan cannot accidentally start through a node surface.

Replace the broad published lock:

```css
.designer-locked .node-template-list,
.designer-locked .flow-canvas {
  pointer-events: none;
}
```

with a palette-only lock so `.flow-canvas` remains pointer-interactive. The component-level `locked` guard enforces structural immutability; the hand button remains enabled.

- [ ] **Step 4: Add grab-state styling**

```css
.dag-canvas.pan-tool-active {
  cursor: grab;
}

.dag-canvas.pan-tool-active.is-panning {
  cursor: grabbing;
  user-select: none;
}

.canvas-toolbar button.active {
  border-color: #93c5fd;
  background: #eaf2ff;
  color: #1d4ed8;
}
```

- [ ] **Step 5: Run all frontend verification**

Run: `cd frontend && node --experimental-strip-types --test tests/*.test.ts && npm run build`

Expected: all tests pass and Vite production build completes without TypeScript errors.

- [ ] **Step 6: Restart and smoke-check the development server**

Restart Vite on port `5173`, then verify the page and transformed source:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/academic-flow/8ed7cacf-36d0-4190-ae64-abe2d07d1664
curl -s http://localhost:5173/src/features/academic-flow/AcademicFlowDesigner.tsx | rg "手形工具|pan-tool-active"
```

Expected: HTTP `200` and both identifiers are present.

- [ ] **Step 7: Commit the implementation**

```bash
git add frontend/src/features/academic-flow/canvasPan.ts frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/styles.css frontend/tests/canvasPan.test.ts
git commit -m "Add workflow canvas pan tool"
```
