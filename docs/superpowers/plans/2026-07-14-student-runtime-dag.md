# Student Runtime DAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the student runtime card list with a read-only OA DAG whose writable nodes open a submission dialog and whose approved nodes become disabled.

**Architecture:** Keep the teacher designer unchanged and add an isolated `StudentFlowTopology` presentation module. Continue using the existing per-student runtime state and transactional DAG advancement, while adding deterministic server-side payload validation before automatic approval.

**Tech Stack:** React 18, TypeScript, SVG, FastAPI, SQLite, pytest, Node test runner.

## Global Constraints

- No new frontend dependency.
- The published flow snapshot is the topology source of truth.
- Approved and blocked nodes cannot be edited by students.
- Python and MJS audit files are configuration only in this version.

---

### Task 1: Submission validation

**Files:**
- Modify: `backend/app/domain/workflow_runtime.py`
- Modify: `backend/app/repositories/flow_instances.py`
- Test: `backend/tests/test_flow_runtime.py`

**Interfaces:**
- Produces: `validate_submission(node: dict[str, Any], payload: dict[str, Any]) -> None`
- Raises: `ValueError` with a student-readable validation message.

- [ ] Add failing tests for missing form fields, missing confirmation, invalid file extension and oversized file.
- [ ] Run `.venv/bin/python -m pytest tests/test_flow_runtime.py -q` and confirm the new tests fail.
- [ ] Implement `validate_submission` and call it before writing `submissions`.
- [ ] Run the runtime tests and confirm they pass.

### Task 2: Read-only topology geometry

**Files:**
- Create: `frontend/src/features/academic-flow/studentTopologyGeometry.ts`
- Test: `frontend/tests/studentTopologyGeometry.test.ts`

**Interfaces:**
- Produces: `getStudentCanvasBounds(nodes)` and `createStudentEdgePath(edge, nodes)`.

- [ ] Add failing tests for saved node bounds and orthogonal top-to-bottom paths.
- [ ] Run the Node test and confirm the module is missing.
- [ ] Implement deterministic SVG geometry without browser globals.
- [ ] Run the geometry tests and confirm they pass.

### Task 3: Student topology and submission dialog

**Files:**
- Create: `frontend/src/features/academic-flow/StudentFlowTopology.tsx`
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- `StudentFlowTopology` consumes the published nodes, edges and `RuntimeNodeInstance[]`.
- It emits `onOpenNode(nodeKey)` only for `available`, `draft`, or `rejected` nodes.

- [ ] Render saved node positions and SVG orthogonal edges in a scrollable read-only canvas.
- [ ] Map runtime states to visible labels and disabled node styles.
- [ ] Move the existing form controls into a modal dialog opened from writable topology nodes.
- [ ] Close the dialog after a successful automatic approval and retain it after validation failure.
- [ ] Add a status legend and completed-node progress summary.

### Task 4: Verification

**Files:**
- Modify only files required by failures found during verification.

- [ ] Run all backend tests with `.venv/bin/python -m pytest -q`.
- [ ] Run all frontend Node tests.
- [ ] Run `npm run build`.
- [ ] Restart stale Vite modules if necessary and verify frontend and backend health endpoints.
- [ ] Commit the implementation checkpoint.
