# Published Node Layout Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow teachers to reposition previously published nodes during local revision and publish the new layout without resetting any existing student runtime state, while keeping published edges non-deletable.

**Architecture:** Separate node movement permission from node deletion permission in the frontend. Treat `x` and `y` as versioned presentation fields in the backend: permit their change in a new immutable version, keep historical node/edge presence validation, and rely on the existing revision fingerprint—which excludes layout fields—to preserve student state.

**Tech Stack:** React 18, TypeScript 5.6, FastAPI, SQLite, pytest, Node test runner.

## Global Constraints

- Revision edits remain frontend-only until the teacher confirms republish.
- Repositioned coordinates are written to the new `flow_versions.config_snapshot` and shown by the student topology.
- Pure coordinate changes must not reset `node_instances`, `submissions`, `node_drafts`, review state, or attempt counts.
- Published nodes remain non-deletable.
- Published edges remain non-selectable and non-deletable; revision-created edges remain deletable.
- Preserve unrelated changes in `docs/05_oa_graph.md` and untracked `.superpowers/` files.

---

### Task 1: Allow published nodes to move in the local revision workspace

**Files:**
- Modify: `frontend/tests/flowRevision.test.ts`
- Modify: `frontend/src/features/academic-flow/flowRevision.ts`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`

**Interfaces:**
- Consumes: `editorLocked: boolean`, `FlowNodeCanvas.canMoveNode(nodeId): boolean`, and the existing published-node deletion policy.
- Produces: `canMoveRevisionNode(): boolean`, returning `true` for every node while the parent revision editor is unlocked.

- [ ] **Step 1: Change the movement-policy test so old and new nodes are both movable during revision**

```ts
test("published and new nodes can both move during an unlocked revision", () => {
  const currentNodes = ["published", "new"];

  assert.equal(canMoveRevisionNode("published", ["published"], currentNodes), true);
  assert.equal(canMoveRevisionNode("new", ["published"], currentNodes), true);
});
```

Keep the separate deletion tests unchanged so they continue proving that published nodes cannot be deleted.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd frontend
node --experimental-strip-types --test tests/flowRevision.test.ts
```

Expected: FAIL because the current `canMoveRevisionNode` returns `false` for the explicit published node.

- [ ] **Step 3: Implement the minimal frontend movement policy**

Replace the published-node identity check with a revision-wide movement policy:

```ts
export function canMoveRevisionNode() {
  return true;
}
```

Pass it to the canvas without coupling movement to `publishedNodeIds`:

```tsx
canMoveNode={() => canMoveRevisionNode()}
```

In `updateNode`, continue removing `deadlineAt` for published workflows, but stop deleting `x` and `y` for old nodes:

```ts
if (workingProcess.published) {
  delete nextValue.deadlineAt;
}
```

Do not change `canDeleteRevisionNode`, `canDeleteRevisionEdge`, `protectedNodeIds`, `protectedEdgeIds`, or `preservePublishedEdges`.

- [ ] **Step 4: Run the focused frontend test and verify GREEN**

Run:

```bash
cd frontend
node --experimental-strip-types --test tests/flowRevision.test.ts
```

Expected: all tests pass, including published-node deletion and published-edge deletion protection.

- [ ] **Step 5: Commit the frontend behavior change**

```bash
git add frontend/tests/flowRevision.test.ts \
  frontend/src/features/academic-flow/flowRevision.ts \
  frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
git commit -m "Allow published nodes to move during revisions"
```

### Task 2: Accept layout-only republish and preserve student state

**Files:**
- Modify: `backend/tests/test_workflow_revision.py`
- Modify: `backend/tests/test_workflow_republish.py`
- Modify: `backend/app/domain/workflow_revision.py`
- Modify: `backend/app/repositories/workflows.py`
- Modify: `backend/app/api/routes/workflows.py`

**Interfaces:**
- Consumes: `analyze_revision(previous, current)` and `_assert_no_published_structure_deletions(connection, flow_id, config)`.
- Produces: republish validation that permits `x` and `y` changes while still requiring all historical node IDs and edge keys.

- [ ] **Step 1: Replace the obsolete domain rejection test with an allowed-movement assertion**

Remove imports and assertions for `PublishedNodeMovementError` and `assert_published_node_positions_unchanged`. Add:

```py
def test_published_node_movement_is_layout_only():
    current = deepcopy(BASE_CONFIG)
    current["nodes"][0].update({"x": 640, "y": 320})

    assert analyze_revision(BASE_CONFIG, current)["invalidatedNodeIds"] == []
```

In the integration test `test_layout_only_republish_preserves_all_progress_and_has_no_invalidation_audit`, retain its current table snapshots and add verification that the new version snapshot contains the moved coordinates:

```py
with get_connection() as connection:
    version = connection.execute(
        "SELECT config_snapshot FROM flow_versions WHERE id = ?",
        (republished["flowVersionId"],),
    ).fetchone()
snapshot = json.loads(version["config_snapshot"])
root = next(node for node in snapshot["nodes"] if node["id"] == "root")
assert (root["x"], root["y"]) == (300, 120)
```

- [ ] **Step 2: Run the focused backend integration test and verify RED**

Run:

```bash
cd backend
.venv/bin/pytest tests/test_workflow_republish.py::test_layout_only_republish_preserves_all_progress_and_has_no_invalidation_audit -q
```

Expected: FAIL with the published-node movement validation error before a new version can be created.

- [ ] **Step 3: Remove only the obsolete position immutability guard**

Delete `PublishedNodeMovementError` and `assert_published_node_positions_unchanged` from `backend/app/domain/workflow_revision.py` after confirming no remaining callers.

Update `_assert_no_published_structure_deletions` to retain only historical node and edge presence checks:

```py
def _assert_no_published_structure_deletions(
    connection: Any, flow_id: str, config: dict[str, Any]
) -> None:
    assert_node_ids_present(_historical_node_ids(connection, flow_id), config)
    assert_edge_keys_present(_historical_edges(connection, flow_id), config)
```

Remove the obsolete imports and `except PublishedNodeMovementError` branches from `backend/app/repositories/workflows.py` and `backend/app/api/routes/workflows.py`. Do not change `analyze_revision`; its business fingerprint already excludes `x`, `y`, `deadlineAt`, and preview status.

- [ ] **Step 4: Run focused backend tests and verify GREEN**

Run:

```bash
cd backend
.venv/bin/pytest tests/test_workflow_revision.py \
  tests/test_workflow_republish.py::test_layout_only_republish_preserves_all_progress_and_has_no_invalidation_audit -q
```

Expected: all selected tests pass; the layout-only republish creates a new snapshot and preserves every runtime table snapshot.

- [ ] **Step 5: Commit the backend behavior change**

```bash
git add backend/tests/test_workflow_revision.py \
  backend/tests/test_workflow_republish.py \
  backend/app/domain/workflow_revision.py \
  backend/app/repositories/workflows.py \
  backend/app/api/routes/workflows.py
git commit -m "Persist published node layout revisions"
```

### Task 3: Full verification and service restart

**Files:**
- Verify only; no additional source files expected.

**Interfaces:**
- Consumes: committed frontend and backend changes from Tasks 1 and 2.
- Produces: fresh evidence that the entire frontend and backend suites and production frontend build remain valid.

- [ ] **Step 1: Run the complete frontend suite**

```bash
cd frontend
node --experimental-strip-types --test tests/*.test.ts
```

Expected: zero failed tests.

- [ ] **Step 2: Run the complete backend suite**

```bash
cd backend
.venv/bin/pytest -q
```

Expected: zero failed tests.

- [ ] **Step 3: Build the frontend production bundle**

```bash
cd frontend
npm run build
```

Expected: TypeScript and Vite exit with code `0`.

- [ ] **Step 4: Confirm protected-edge code remains intact**

```bash
rg -n "canDeleteRevisionEdge|protectedEdgeIds|preservePublishedEdges|flow-edge-hitbox" \
  frontend/src/features/academic-flow/AcademicFlowDesigner.tsx \
  frontend/src/features/academic-flow/flowRevision.ts
```

Expected: published edge IDs still control hitbox rendering, deletion guards, and published-edge restoration.

- [ ] **Step 5: Restart frontend and backend development services**

Restart Vite on port `5173` and Uvicorn on port `8000`, then leave both sessions running for manual verification.
