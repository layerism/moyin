# Adaptive Flow Node Height Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make teacher-canvas flow nodes grow vertically with complete, uniform-size titles while keeping width fixed, descriptions clamped to two lines, and all canvas geometry synchronized with measured heights.

**Architecture:** `FlowNodeCanvas` observes rendered button heights with one `ResizeObserver` and builds transient `FlowNodeLayout` objects from persisted nodes plus `renderedHeight`. Every geometry helper consumes these layout objects, so ports, routing, collision checks, magnet targeting, and canvas bounds use the same measured height without changing saved workflow data.

**Tech Stack:** React, TypeScript, CSS, browser `ResizeObserver`.

## Global Constraints

- Keep node width at exactly `280px` and minimum height at exactly `126px`.
- Render every title at `17px`, fully wrapped without line clamp.
- Render every description at `12px`, clamped to two lines with ellipsis.
- Do not add dependencies or change backend/database/node schemas.
- Do not run tests, builds, or browser automation during implementation; perform static business-logic audit only, as required by project instructions.
- Create one final implementation commit after the existing design checkpoint.

---

### Task 1: Measure rendered node heights

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`

**Interfaces:**
- Consumes: `AcademicFlowNode[]`, `nodeSize.height`, rendered `.flow-node` buttons.
- Produces: `type FlowNodeLayout = AcademicFlowNode & { renderedHeight: number }`, `nodeHeights: Record<string, number>`, and `layoutNodes: FlowNodeLayout[]`.

- [ ] **Step 1: Add transient layout type and state**

Define `FlowNodeLayout` beside the canvas connection types. In `FlowNodeCanvas`, maintain a node-element map and measured-height record; derive layout nodes with `nodeHeights[node.id] ?? nodeSize.height`.

- [ ] **Step 2: Observe button heights**

Register each node button by ID. Use one `ResizeObserver` effect to read `HTMLElement.offsetHeight`, update only changed heights, and prune IDs no longer present in `nodes`.

- [ ] **Step 3: Keep height transient**

Confirm height is used only inside `FlowNodeCanvas`; do not pass it to `onUpdateNode`, `onSaveProcess`, draft configuration, or API payloads.

### Task 2: Use measured height throughout geometry

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`

**Interfaces:**
- Consumes: `FlowNodeLayout.renderedHeight`.
- Produces: geometry helpers whose node parameters are `FlowNodeLayout` and whose arrays are `FlowNodeLayout[]`.

- [ ] **Step 1: Replace canvas lookup nodes**

Build `nodeById` and `edgeLines` from `layoutNodes`. Use `renderedHeight` for magnet hit bounds and port lookup.

- [ ] **Step 2: Update port and edge helpers**

Change `getPortPoint`, `getFallbackPorts`, `resolveEdgePorts`, `createOrthogonalPath`, `getRouteCollisionCount`, `segmentIntersectsNodeInterior`, and `createPreviewPath` to consume `FlowNodeLayout`. Replace every vertical `nodeSize.height` reference with `node.renderedHeight`.

- [ ] **Step 3: Update routing and canvas bounds**

Pass `layoutNodes` to path generation and collision scoring. Calculate canvas surface height as the greater of `1000` and the lowest layout node edge plus `80`; keep the existing minimum width and horizontal behavior.

- [ ] **Step 4: Preserve new-node placement fallback**

Continue using `nodeSize.height` when centering a newly dropped node before its first render. Do not move a node after its height is measured.

### Task 3: Apply adaptive node typography

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: existing node title, requirement, kind, and status markup.
- Produces: a fixed-width, minimum-height `.flow-node` without density classes.

- [ ] **Step 1: Remove density calculation**

Delete `getFlowNodeDensity()` and all `flow-node-density-*` class generation. Render layout nodes with width only; register each button for measurement.

- [ ] **Step 2: Make height content-driven**

Change `.flow-node` from fixed `height: 126px` to `min-height: 126px`. Keep the three-row layout and allow title content to expand the first row.

- [ ] **Step 3: Standardize title and description**

Set title to block layout, `17px`, `1.25` line height, normal wrapping, and no clamp. Keep description at `12px`, `1.35` line height, two-line WebKit clamp, and hidden overflow. Delete compact/dense title and metadata overrides.

### Task 4: Static audit, cleanup, commit, and restart

**Files:**
- Modify: only files listed above and this plan.

**Interfaces:**
- Consumes: completed adaptive-height implementation.
- Produces: one implementation checkpoint and restarted local services.

- [ ] **Step 1: Perform static geometry audit**

Use `rg` to confirm fixed-height CSS and density classes are gone, all rendered geometry functions consume `FlowNodeLayout`, and remaining `nodeSize.height` references are limited to minimum/fallback placement semantics.

- [ ] **Step 2: Review scoped diff and caches**

Run `git diff --check`, inspect the exact diff, and confirm unrelated `AGENTS.md`, `INSTALL.md`, and `MEMORY.md` remain unstaged. Check project source directories for `.pytest_cache`, `__pycache__`, and `*.egg-info` while excluding dependency directories.

- [ ] **Step 3: Commit implementation**

Stage only the plan, `AcademicFlowDesigner.tsx`, and `styles.css`; commit with `feat: support adaptive flow node heights`.

- [ ] **Step 4: Restart local services**

Restart Uvicorn on `0.0.0.0:8000` and Vite on `0.0.0.0:5173` without Docker, then confirm both local HTTP endpoints return `200`.
