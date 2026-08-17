# Curved Flow Edges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render deterministic, port-fanned cubic Bézier edges in both the teacher flow designer and the student runtime topology.

**Architecture:** Introduce one pure geometry module that resolves legacy ports, assigns stable source/target lanes, and returns path, endpoint, and midpoint geometry. The teacher and student views adapt their node dimensions into this shared module while retaining their existing interaction and state layers.

**Tech Stack:** React 18, TypeScript, SVG paths, Node test sources.

## Global Constraints

- Do not modify `AcademicFlowEdge`, workflow drafts, published snapshots, backend APIs, database structures, or dependency semantics.
- Curves must not infer edges from crossings or proximity.
- Teacher and student views must use the same lane and Bézier algorithm.
- Preserve teacher edge selection, hitboxes, delete controls, keyboard deletion, connection validation, and preview behavior.
- Preserve student node states, colors, arrows, zoom, and pan behavior.
- Preserve unrelated user changes in the working tree.
- Per project instructions, do not run tests or browser automation; perform source-level business-logic auditing only.
- The managed checkout exposes `.git` as read-only, so checkpoint and result commits cannot be created in this session.

---

### Task 1: Build shared curved-edge geometry

**Files:**
- Create: `frontend/src/features/academic-flow/edgeCurveGeometry.ts`

**Interfaces:**
- Consumes: edge IDs/source/target/optional ports and nodes with explicit `x`, `y`, `width`, and `height`.
- Produces: `createCurveGeometry(input): CurvedEdgeGeometry`, `createCurvedEdgeGeometries(edges, nodes): Map<string, CurvedEdgeGeometry>`, and `getOppositePort(port): AcademicFlowPort`.

- [ ] **Step 1: Define the shared geometry types**

Create these exported types in `edgeCurveGeometry.ts`:

```ts
import type { AcademicFlowPort } from "../../types";

export type CurvePoint = { x: number; y: number };
export type CurveNode = CurvePoint & { height: number; id: string; width: number };
export type CurveEdge = {
  id: string;
  source: string;
  sourcePort?: AcademicFlowPort;
  target: string;
  targetPort?: AcademicFlowPort;
};
export type CurvedEdgeGeometry = {
  midX: number;
  midY: number;
  path: string;
  sourcePort: AcademicFlowPort;
  sourceX: number;
  sourceY: number;
  targetPort: AcademicFlowPort;
  targetX: number;
  targetY: number;
};
```

- [ ] **Step 2: Implement port resolution and stable lane allocation**

Implement private helpers with these exact rules:

```text
fallback ports: choose vertical when |deltaY| >= |deltaX|, otherwise horizontal
source group key: source node ID + resolved source port
target group key: target node ID + resolved target port
top/bottom groups: order sibling edges by opposite node center X, then center Y, then edge ID
left/right groups: order sibling edges by opposite node center Y, then center X, then edge ID
usable span: max(0, node span - 32)
lane spacing: min(18, usable span / (count - 1)); one edge receives offset 0
lane offset: (index - (count - 1) / 2) * lane spacing
top/bottom offset: add lane offset to endpoint X
left/right offset: add lane offset to endpoint Y
```

Resolve every edge once into an internal record before grouping. Ignore edges whose source or target node is absent.

- [ ] **Step 3: Implement cubic path and midpoint geometry**

Export `createCurveGeometry` with this input:

```ts
{
  source: CurvePoint;
  sourcePort: AcademicFlowPort;
  target: CurvePoint;
  targetPort: AcademicFlowPort;
}
```

Use the Euclidean endpoint distance and clamp the control distance to `48 <= distance * 0.35 <= 180`. Move control point 1 outward along the source-port normal and control point 2 outward along the target-port normal. Return:

```text
M source.x source.y C control1.x control1.y control2.x control2.y target.x target.y
```

Calculate `midX` and `midY` with the cubic Bézier formula at `t = 0.5`, not by averaging endpoints.

Export `getOppositePort`: top ↔ bottom and left ↔ right.

- [ ] **Step 4: Build all final edge geometries in one pass**

Implement `createCurvedEdgeGeometries(edges, nodes)` so it:

1. Resolves fallback ports from node centers.
2. Allocates source and target lane offsets from the complete edge set.
3. Computes shifted boundary endpoints.
4. Calls `createCurveGeometry`.
5. Stores geometry by edge ID while preserving resolved ports.

---

### Task 2: Replace teacher canvas orthogonal routing

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:950-990,1394-1420,1460-1505,2220-2532`

**Interfaces:**
- Consumes: `createCurveGeometry`, `createCurvedEdgeGeometries`, `getOppositePort`, existing `AcademicFlowEdge[]`, and dynamic `FlowNodeLayout.renderedHeight`.
- Produces: teacher edge records carrying `CurvedEdgeGeometry` for rendering and selection.

- [ ] **Step 1: Build teacher curve nodes and edge geometry**

Import the shared functions and map each `FlowNodeLayout` to:

```ts
{
  id: node.id,
  x: node.x,
  y: node.y,
  width: nodeSize.width,
  height: node.renderedHeight,
}
```

Replace the `resolveEdgePorts` mapping with `createCurvedEdgeGeometries(edges, curveNodes)`. Build `edgeLines` by merging each existing edge with the geometry stored under its ID; omit only edges with missing geometry.

- [ ] **Step 2: Render curve paths and separated arrow endpoints**

Inside the SVG edge map:

```tsx
const path = edge.path;
```

Keep the visible edge and transparent hitbox on the same `path`. Render the arrow with `edge.targetX`, `edge.targetY`, and `edge.targetPort`, which now represent the fanned target endpoint.

- [ ] **Step 3: Position the delete control on the curve midpoint**

Change `getEdgeDeleteButtonStyle` to consume `{ midX, midY }` and return:

```ts
{ left: edge.midX, top: edge.midY }
```

This keeps the delete button attached to the displayed cubic path rather than the straight endpoint midpoint.

- [ ] **Step 4: Convert connection previews to curves**

For a magnetized target, call `createCurveGeometry` with the source port center, target preview point, source port, and `connectionPreviewPort`.

For a free pointer target, call `createCurveGeometry` with the source port center, pointer position, source port, and `getOppositePort(sourcePort)`.

Use the returned `path`; keep the existing preview arrow only when a real target port exists.

- [ ] **Step 5: Remove obsolete teacher orthogonal helpers**

Delete these functions after their callers are replaced:

```text
getFallbackPorts
resolveEdgePorts
createOrthogonalPath
getRouteCollisionCount
segmentIntersectsNodeInterior
getRouteLength
createPreviewPath
getOrthogonalMidpoints
offsetPoint
dedupePoints
```

Retain `getPortPoint`, `createArrowPolygon`, `getEdgeDeleteButtonStyle`, and `hasCycle`.

---

### Task 3: Replace student topology routing and audit the result

**Files:**
- Modify: `frontend/src/features/academic-flow/studentTopologyGeometry.ts:1-96`
- Modify: `frontend/src/features/academic-flow/StudentFlowTopology.tsx:1-12,145-175`
- Modify: `frontend/tests/studentTopologyGeometry.test.ts`

**Interfaces:**
- Consumes: `createCurvedEdgeGeometries`, `AcademicFlowEdge[]`, and fixed `studentNodeSize`.
- Produces: `createStudentEdgeGeometries(edges, nodes): Map<string, CurvedEdgeGeometry>` used once per topology render.

- [ ] **Step 1: Replace student path helpers with one adapter**

Keep `studentNodeSize` and `getStudentCanvasBounds`. Replace `createStudentEdgePath`, `getStudentEdgeTarget`, `getFallbackPorts`, `getPortPoint`, and `pointsToPath` with:

```ts
export function createStudentEdgeGeometries(edges: TopologyEdge[], nodes: TopologyNode[]) {
  return createCurvedEdgeGeometries(
    edges,
    nodes.map((node) => ({
      ...node,
      width: studentNodeSize.width,
      height: studentNodeSize.height,
    })),
  );
}
```

Export `TopologyEdge` and `TopologyNode` if required by the updated tests.

- [ ] **Step 2: Render student paths from the shared geometry map**

In `StudentFlowTopology`, create the map once with `useMemo`:

```tsx
const edgeGeometries = useMemo(
  () => createStudentEdgeGeometries(edges, nodes),
  [edges, nodes],
);
```

For each edge, read `const geometry = edgeGeometries.get(edge.id)`. Skip missing geometry; render `geometry.path` and create the arrow from `geometry.targetX`, `geometry.targetY`, and `geometry.targetPort`. Preserve the existing target-runtime status color class.

- [ ] **Step 3: Complete the updated geometry test source**

Update imports to use `createStudentEdgeGeometries`. Assert the single edge contains ` C `, and the four-edge fixture yields distinct source and target positions for sibling edges. Keep the existing canvas-bounds assertion unchanged.

- [ ] **Step 4: Audit source boundaries and stale helpers**

Run only the non-test checks allowed by the project:

```bash
rg -n "createOrthogonalPath|createPreviewPath|createStudentEdgePath|getStudentEdgeTarget|getOrthogonalMidpoints|pointsToPath" frontend/src frontend/tests
rg -n "createCurveGeometry|createCurvedEdgeGeometries|createStudentEdgeGeometries|midX|targetX" frontend/src frontend/tests
sed -n '1,280p' frontend/src/features/academic-flow/edgeCurveGeometry.ts
git diff --check -- frontend/src/features/academic-flow/edgeCurveGeometry.ts frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/features/academic-flow/studentTopologyGeometry.ts frontend/src/features/academic-flow/StudentFlowTopology.tsx frontend/tests/studentTopologyGeometry.test.ts
git diff -- frontend/src/features/academic-flow/edgeCurveGeometry.ts frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/features/academic-flow/studentTopologyGeometry.ts frontend/src/features/academic-flow/StudentFlowTopology.tsx frontend/tests/studentTopologyGeometry.test.ts
```

Expected audit result: no obsolete path generator remains; both views import the shared geometry; each SVG path and arrow use the same geometry record; no whitespace errors are reported.

- [ ] **Step 5: Perform project closeout**

Remove only project-generated `.pytest_cache`, `__pycache__`, and `*.egg-info` artifacts if present. Restart the existing backend from `backend/` on port `8000` and frontend with repository Node.js `24.18.0`/npm `11.16.0` on port `5173`, stopping only processes confirmed to belong to this project. Report that tests and browser checks were not run.

If `.git` becomes writable, create the result checkpoint with only this task's files:

```bash
git add frontend/src/features/academic-flow/edgeCurveGeometry.ts \
  frontend/src/features/academic-flow/AcademicFlowDesigner.tsx \
  frontend/src/features/academic-flow/studentTopologyGeometry.ts \
  frontend/src/features/academic-flow/StudentFlowTopology.tsx \
  frontend/tests/studentTopologyGeometry.test.ts \
  docs/superpowers/specs/2026-08-17-curved-flow-edges-design.md \
  docs/superpowers/plans/2026-08-17-curved-flow-edges.md
git commit -m "feat: render fanned curved flow edges"
```
