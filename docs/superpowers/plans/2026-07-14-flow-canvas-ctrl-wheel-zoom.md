# Flow Canvas Ctrl + Wheel Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add slow pointer-anchored Ctrl + wheel zoom to teacher and student OA DAG canvases.

**Architecture:** Add a pure zoom helper beside the existing pan helper. Both canvases maintain local zoom state, scale an inner content layer, and update their scroll offsets from the helper so the graph coordinate under the pointer remains stable.

**Tech Stack:** React, TypeScript, CSS transforms, Node test runner.

## Global Constraints

- Zoom is enabled only when `Ctrl` is pressed.
- Range is 50%–150%; one wheel event changes scale by approximately 2%.
- Existing unmodified wheel scrolling, teacher pan, node interaction, and student submission behavior remain unchanged.
- No API, database, or dependency changes.

---

### Task 1: Add deterministic zoom math

**Files:**
- Modify: `frontend/src/features/academic-flow/canvasPan.ts`
- Modify: `frontend/tests/canvasPan.test.ts`

**Interfaces:**
- Produces `getCanvasZoomState(input): { zoom: number; scrollLeft: number; scrollTop: number }`.
- `input` contains `zoom`, `deltaY`, pointer offsets, and current scroll positions.

- [ ] **Step 1: Write failing tests**

```ts
test("zooms slowly while preserving the pointer anchor", () => {
  assert.deepEqual(getCanvasZoomState({ zoom: 1, deltaY: -120, offsetX: 200, offsetY: 100, scrollLeft: 300, scrollTop: 150 }), {
    zoom: 1.02, scrollLeft: 310, scrollTop: 155,
  });
});

test("clamps Ctrl-wheel zoom to the supported range", () => {
  assert.equal(getCanvasZoomState({ zoom: 1.5, deltaY: -120, offsetX: 0, offsetY: 0, scrollLeft: 0, scrollTop: 0 }).zoom, 1.5);
});
```

- [ ] **Step 2: Run the focused test**

Run: `node --experimental-strip-types --test tests/canvasPan.test.ts`  
Expected: fail because `getCanvasZoomState` is not exported.

- [ ] **Step 3: Implement the minimal helper**

```ts
const zoomStep = 0.02;
const minZoom = 0.5;
const maxZoom = 1.5;

export function getCanvasZoomState(input: CanvasZoomInput) {
  const zoom = Math.min(maxZoom, Math.max(minZoom, input.zoom + (input.deltaY < 0 ? zoomStep : -zoomStep)));
  const ratio = zoom / input.zoom;
  return {
    zoom,
    scrollLeft: Math.max(0, (input.scrollLeft + input.offsetX) * ratio - input.offsetX),
    scrollTop: Math.max(0, (input.scrollTop + input.offsetY) * ratio - input.offsetY),
  };
}
```

- [ ] **Step 4: Run the focused test and commit**

Run: `node --experimental-strip-types --test tests/canvasPan.test.ts`  
Expected: all tests pass.

### Task 2: Wire Ctrl + wheel zoom into both canvases

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Modify: `frontend/src/features/academic-flow/StudentFlowTopology.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes `getCanvasZoomState` from Task 1.
- Produces teacher and student view-local `zoom` state with pointer-anchored `onWheel` handling.

- [ ] **Step 1: Add teacher canvas state and handler**

```ts
const [zoom, setZoom] = useState(1);
const zoomCanvas = (event: WheelEvent<HTMLDivElement>) => {
  if (!event.ctrlKey || !canvasRef.current) return;
  event.preventDefault();
  const rect = canvasRef.current.getBoundingClientRect();
  const next = getCanvasZoomState({ zoom, deltaY: event.deltaY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, scrollLeft: canvasRef.current.scrollLeft, scrollTop: canvasRef.current.scrollTop });
  setZoom(next.zoom);
  canvasRef.current.scrollLeft = next.scrollLeft;
  canvasRef.current.scrollTop = next.scrollTop;
};
```

- [ ] **Step 2: Wrap teacher graph content in a scaled layer**

Apply `transform: scale(${zoom})` with `transform-origin: 0 0` to the graph layer, and set its width and height to the inverse-scaled canvas dimensions so scrolling remains available. Replace the fixed `100%` toolbar button label with `Math.round(zoom * 100) + "%"`.

- [ ] **Step 3: Add the same local handler to `StudentFlowTopology`**

Use a viewport ref, local `zoom` state, and the same helper. Apply the scale only to the graph content layer so node button coordinates and SVG paths remain aligned.

- [ ] **Step 4: Add scoped CSS**

```css
.canvas-zoom-content { transform-origin: 0 0; }
.student-topology-zoom-content { transform-origin: 0 0; }
```

- [ ] **Step 5: Run tests and build**

Run: `node --experimental-strip-types --test tests/*.test.ts && npm run build`  
Expected: all tests pass and Vite build succeeds.

### Task 3: Browser validation and checkpoint

**Files:**
- Verify only; no production file additions.

- [ ] **Step 1: Validate teacher canvas**

Open a teacher flow, use `Ctrl + wheel` once in each direction, and confirm the percentage changes by approximately two points while nodes remain at the pointer location.

- [ ] **Step 2: Validate student topology**

Open a student runtime flow, use `Ctrl + wheel` once in each direction, and confirm nodes remain clickable at the new scale.

- [ ] **Step 3: Check console and commit**

Confirm no new browser errors, run `git diff --check`, then commit the implementation with message `Add Ctrl-wheel flow canvas zoom`.
