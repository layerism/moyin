# Long-distance Canvas Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make long-distance connection lines render beyond the original fixed canvas bounds and automatically pan the canvas while a connection is dragged near any viewport edge.

**Architecture:** Keep graph validation and existing connection geometry unchanged. Extend the existing canvas utilities with a pure edge-pan calculation, let the designer own the animation lifecycle, and derive one shared world-space width and height for the surface, content, and SVG layers.

**Tech Stack:** React 18, TypeScript, CSS, existing academic-flow canvas utilities

**Spec:** User-approved design in the 2026-08-23 conversation: dynamic canvas bounds plus four-direction connection edge auto-pan.

## Global Constraints

- Preserve the existing Ctrl plus right-button manual pan and Ctrl plus wheel zoom behavior.
- Preserve connection validation, port selection, routing geometry, node movement, and published-flow restrictions.
- Keep the outer page non-scrollable; canvas movement remains inside the clipped canvas viewport.
- Do not run tests, builds, or browser automation under the repository development rules; perform static business-logic and diff audits only.
- Commit only files belonging to this task and preserve all unrelated worktree changes.

---

### Task 1: Pure edge-pan calculation

**Files:**
- Modify: `frontend/src/features/academic-flow/canvasPan.ts`

**Interfaces:**
- Produces: `getCanvasEdgePanDelta(input): CanvasPoint`, accepting pointer coordinates, viewport bounds, edge threshold, and maximum per-frame step.
- Consumes: existing `CanvasPoint` type.

- [ ] Add a small viewport-bounds input type and a clamped proximity calculation for all four edges.
- [ ] Return screen-space offset deltas: left/top edges produce positive deltas, right/bottom edges produce negative deltas, and the safe center produces zero.
- [ ] Statically audit boundary signs, threshold behavior, and outside-viewport behavior.

### Task 2: Dynamic connection canvas and auto-pan lifecycle

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`

**Interfaces:**
- Consumes: `getCanvasEdgePanDelta` from `canvasPan.ts`.
- Produces: shared `canvasSurfaceWidth` and `canvasSurfaceHeight` dimensions used by the zoom surface, zoom content, and SVG edge layer.

- [ ] Track the latest connection pointer position and clear it when the connection ends or is cancelled.
- [ ] While a connection is active and not magnetized to a target port, run one `requestAnimationFrame` loop that pans within 48 px of each canvas edge, capped at 14 screen pixels per frame.
- [ ] Adjust the world-space preview point by the inverse viewport movement so the line endpoint remains under a stationary pointer during auto-pan.
- [ ] Include node extents and the active preview point in dynamic canvas width and height calculations, with 240 px curve padding and existing 1200 by 1000 minimums.
- [ ] Apply the same dynamic dimensions to the surface, content, and SVG without changing graph validation or manual canvas controls.

### Task 3: Remove fixed SVG clipping and audit completion

**Files:**
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: inline dynamic dimensions from `AcademicFlowDesigner.tsx`.
- Produces: edge-layer sizing that follows its parent and permits curve control points to remain visible.

- [ ] Replace fixed 1200 by 1000 CSS dimensions with minimum content dimensions and a full-parent SVG layer using visible SVG overflow.
- [ ] Review the task-only diff for animation cleanup, connection cancellation, drag/click connection paths, dynamic dimension consistency, and preservation of `overflow: hidden` on the canvas viewport.
- [ ] Create the result checkpoint, clean only permitted project caches, restart local frontend/backend services, and verify listener ownership and working directories without HTTP or browser checks.
