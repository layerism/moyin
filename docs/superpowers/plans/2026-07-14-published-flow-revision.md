# Published Flow Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow teachers to revise published DAG workflows while preserving immutable versions, stable student links, published-node deletion protection, and dependency-aware student progress invalidation.

**Architecture:** Add a pure domain diff module that compares the latest published snapshot with the current draft. Keep publication and student-instance migration in one SQLite transaction inside the workflow repository; expose a read-only impact endpoint and surface its result in a teacher confirmation dialog before republishing.

**Tech Stack:** Python 3.11, FastAPI, SQLite, pytest, React 18, TypeScript, native Node test runner, Vite.

## Global Constraints

- Published `flow_versions` remain immutable; every republish creates `vN+1`.
- A node ID present in any current published baseline cannot be removed from a saved revision.
- Newly added, not-yet-published nodes can be removed.
- Business-content changes, added nodes, and predecessor-set changes invalidate the changed node and all reachable successors in the new DAG.
- `x`, `y`, `deadlineAt`, and preview `status` changes do not invalidate progress.
- Existing high-entropy share-token values remain unchanged and point to the latest version.
- Invalidated drafts and submissions leave runtime tables only after their complete snapshots are written to `audit_logs`.
- Republish, migration, token retargeting, and audit writes run in one database transaction.

---

### Task 1: Pure DAG revision impact calculation

**Files:**
- Create: `backend/app/domain/workflow_revision.py`
- Create: `backend/tests/test_workflow_revision.py`

**Interfaces:**
- Produces: `PublishedNodeDeletionError(ValueError)`.
- Produces: `analyze_revision(previous: dict, current: dict) -> dict[str, list[str]]` with keys `addedNodeIds`, `changedNodeIds`, `predecessorChangedNodeIds`, and `invalidatedNodeIds`.
- Produces: `assert_published_nodes_present(previous: dict, current: dict) -> None`.

- [ ] **Step 1: Write failing domain tests**

Create fixtures for a branched DAG `root -> left -> join` and `root -> right -> join`. Assert:

```python
def test_content_change_invalidates_only_changed_node_and_successors():
    current = deepcopy(BASE_CONFIG)
    current["nodes"][1]["requirement"] = "修改后的要求"

    impact = analyze_revision(BASE_CONFIG, current)

    assert impact["changedNodeIds"] == ["left"]
    assert impact["invalidatedNodeIds"] == ["left", "join"]


def test_layout_and_deadline_changes_do_not_invalidate_progress():
    current = deepcopy(BASE_CONFIG)
    current["nodes"][0].update({"x": 320, "y": 160, "deadlineAt": "2030-01-01", "status": "ready"})
    assert analyze_revision(BASE_CONFIG, current)["invalidatedNodeIds"] == []


def test_new_node_and_rewired_target_invalidate_their_successors():
    current = insert_node_between(BASE_CONFIG, "left", "join", "review")
    impact = analyze_revision(BASE_CONFIG, current)
    assert impact["addedNodeIds"] == ["review"]
    assert impact["predecessorChangedNodeIds"] == ["join", "review"]
    assert impact["invalidatedNodeIds"] == ["review", "join"]


def test_published_node_deletion_is_rejected():
    current = without_node(BASE_CONFIG, "left")
    with pytest.raises(PublishedNodeDeletionError, match="已发布节点不可删除"):
        assert_published_nodes_present(BASE_CONFIG, current)
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd backend && .venv/bin/pytest tests/test_workflow_revision.py -q`

Expected: collection fails because `app.domain.workflow_revision` does not exist.

- [ ] **Step 3: Implement deterministic impact analysis**

Implement:

```python
BUSINESS_NODE_FIELDS = (
    "kind", "title", "requirement", "infoFields", "fileExtensions",
    "fileLimitMb", "auditScriptType", "auditScriptName", "autoApprove",
)


def business_node_snapshot(node: dict[str, Any]) -> dict[str, Any]:
    return {field: node.get(field) for field in BUSINESS_NODE_FIELDS}


def predecessor_sets(config: dict[str, Any]) -> dict[str, set[str]]:
    result = {node["id"]: set() for node in config["nodes"]}
    for edge in config.get("edges", []):
        result[edge["target"]].add(edge["source"])
    return result


def reachable_successors(config: dict[str, Any], starts: set[str]) -> set[str]:
    outgoing = {node["id"]: set() for node in config["nodes"]}
    for edge in config.get("edges", []):
        outgoing[edge["source"]].add(edge["target"])
    visited = set(starts)
    pending = list(starts)
    while pending:
        for target in outgoing[pending.pop()]:
            if target not in visited:
                visited.add(target)
                pending.append(target)
    return visited
```

Return node IDs in current-config node order for stable API and test output.

- [ ] **Step 4: Run domain tests and verify GREEN**

Run: `cd backend && .venv/bin/pytest tests/test_workflow_revision.py -q`

Expected: all revision-domain tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add backend/app/domain/workflow_revision.py backend/tests/test_workflow_revision.py
git commit -m "Add workflow revision impact analysis"
```

---

### Task 2: Revision metadata, save protection, and impact API

**Files:**
- Modify: `backend/app/repositories/workflows.py`
- Modify: `backend/app/api/routes/workflows.py`
- Modify: `backend/tests/test_workflows.py`

**Interfaces:**
- Produces: `get_revision_impact(flow_id: str, teacher_id: int) -> dict[str, object]`.
- Extends workflow responses with `publishedNodeIds`, `publishedVersionNo`, and `hasUnpublishedChanges`.
- Adds: `POST /api/workflows/{flow_id}/revision-impact`.

- [ ] **Step 1: Write failing API tests**

Add tests that first publish `sample_config()`, then assert:

```python
flow = client.get(f"/api/workflows/{flow_id}").json()
assert flow["publishedNodeIds"] == ["n1", "n2"]
assert flow["publishedVersionNo"] == 1
assert flow["hasUnpublishedChanges"] is False
```

Save a changed title and assert `hasUnpublishedChanges is True`. Call the impact endpoint and assert changed and invalidated IDs. Attempt to save a draft missing `n1` and assert HTTP `409` with `{"detail": "已发布节点不可删除：n1"}`. Also assert another teacher receives `404` from the impact endpoint.

- [ ] **Step 2: Run focused API tests and verify RED**

Run: `cd backend && .venv/bin/pytest tests/test_workflows.py -q`

Expected: failures for missing response fields, endpoint, and deletion validation.

- [ ] **Step 3: Add latest-version lookup and response metadata**

In `workflows.py`, add a private query returning the latest published version for the owned flow. Compare canonical JSON hashes to compute `hasUnpublishedChanges`. Extend `get_flow()` with:

```python
"publishedNodeIds": [node["id"] for node in published_config.get("nodes", [])],
"publishedVersionNo": published["version_no"] if published else None,
"hasUnpublishedChanges": bool(published and published["config_hash"] != draft_hash),
```

- [ ] **Step 4: Enforce deletion protection on draft save**

Before updating `flows.draft_config`, load the latest published snapshot and call `assert_published_nodes_present`. Map `PublishedNodeDeletionError` to HTTP `409` in `put_draft` and `publish`.

- [ ] **Step 5: Add the impact endpoint**

`get_revision_impact` must validate ownership, return empty impact for an unpublished flow, and otherwise return:

```json
{
  "currentVersionId": "...",
  "currentVersionNo": 1,
  "nextVersionNo": 2,
  "addedNodeIds": [],
  "changedNodeIds": ["n1"],
  "predecessorChangedNodeIds": [],
  "invalidatedNodeIds": ["n1", "n2"],
  "affectedStudentCount": 3
}
```

Count distinct instances on the current version only when `invalidatedNodeIds` is non-empty.

- [ ] **Step 6: Run API and domain tests**

Run: `cd backend && .venv/bin/pytest tests/test_workflow_revision.py tests/test_workflows.py -q && .venv/bin/ruff check app tests`

Expected: all focused tests and Ruff pass.

- [ ] **Step 7: Commit Task 2**

```bash
git add backend/app/repositories/workflows.py backend/app/api/routes/workflows.py backend/tests/test_workflows.py
git commit -m "Add workflow revision preview API"
```

---

### Task 3: Transactional republish and student DAG migration

**Files:**
- Modify: `backend/app/repositories/workflows.py`
- Create: `backend/tests/test_workflow_republish.py`

**Interfaces:**
- Consumes: `analyze_revision` from Task 1.
- Changes: `publish_flow(flow_id, teacher_id)` performs initial publish or transactional republish.
- Preserves: existing `flow_instances.id` and active share-token values.

- [ ] **Step 1: Write failing end-to-end migration tests**

Build a four-node branched DAG, register students, submit nodes, save a revised draft, and republish. Cover these independent cases:

1. Changing `left` resets `left` and `join`, while `root` and `right` remain approved.
2. Adding `review` between `left` and `join` creates `review`, resets `join`, and leaves unrelated `right` unchanged.
3. A layout-only change creates no invalidated audit and preserves every node status/submission.
4. The original token string resolves to `v2`; the same student instance ID now reports `v2`.
5. Deleted invalidated drafts/submissions appear in `audit_logs.before_data` under `node_submission_invalidated`.
6. A forced exception during migration rolls back the new version, token target, instance version, node state, and audit rows.

- [ ] **Step 2: Run migration tests and verify RED**

Run: `cd backend && .venv/bin/pytest tests/test_workflow_republish.py -q`

Expected: failures because republish currently creates a new token and does not migrate existing instances.

- [ ] **Step 3: Refactor publication into one immediate transaction**

Open one connection, execute `BEGIN IMMEDIATE`, re-read the owned flow and latest published version inside that transaction, validate the draft, and allocate the next version number. Do not call repository functions that open a second connection from inside the transaction.

For first publish, retain existing behavior. For republish:

```python
impact = analyze_revision(previous_config, current_config)
new_version_id = insert_version(...)
migrate_instances(connection, old_version_id, new_version_id, current_config, impact, teacher_id, now)
connection.execute(
    "UPDATE share_tokens SET flow_version_id = ? WHERE flow_version_id = ? AND status = 'active'",
    (new_version_id, old_version_id),
)
connection.execute("UPDATE flow_versions SET status = 'disabled' WHERE id = ?", (old_version_id,))
```

Return the existing token value on republish.

- [ ] **Step 4: Implement instance migration**

For each instance on the old version:

- Update `flow_instances.flow_version_id` to the new version after node migration is prepared.
- Insert missing `node_instances` for added nodes.
- For every invalidated node, read node state, draft, and all submissions; insert `node_submission_invalidated` with complete canonical `before_data`; then delete submissions/draft and reset timestamps and attempt count.
- Remove node-level deadline overrides only for invalidated nodes; preserve overrides for unaffected nodes.
- Recompute invalidated/new-node status in topological order: `available` when all predecessors are approved, otherwise `locked`; apply effective deadlines and set `expired` when needed.
- Recompute flow completion from all node statuses.

Write one `workflow_republish` audit row containing old/new version IDs, all impact lists, and migrated-student count, plus one `share_token_retargeted` row without token plaintext.

- [ ] **Step 5: Verify stable routes and progress**

Assert the old `/s/{token}` enters or returns the migrated instance, `/student/flows/{instanceId}` remains valid, old-version progress no longer lists migrated students, and new-version progress does.

- [ ] **Step 6: Run complete backend verification**

Run: `cd backend && .venv/bin/pytest -q && .venv/bin/ruff check app tests`

Expected: all backend tests and Ruff pass.

- [ ] **Step 7: Commit Task 3**

```bash
git add backend/app/repositories/workflows.py backend/tests/test_workflow_republish.py
git commit -m "Migrate student progress on workflow republish"
```

---

### Task 4: Teacher revision controls and impact confirmation

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/features/academic-flow/api.ts`
- Modify: `frontend/src/features/academic-flow/runtimeTypes.ts`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Create: `frontend/src/features/academic-flow/RevisionImpactDialog.tsx`
- Create: `frontend/src/features/academic-flow/flowRevision.ts`
- Create: `frontend/tests/flowRevision.test.ts`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Adds to `AcademicProcess`: `publishedNodeIds: string[]`, `publishedVersionNo?: number`, `hasUnpublishedChanges: boolean`.
- Adds: `RevisionImpact` API type and `workflowApi.getRevisionImpact(serverId)`.
- Produces: `canDeleteRevisionNode(nodeId, publishedNodeIds) -> boolean`.

- [ ] **Step 1: Write failing frontend policy tests**

```ts
test("published nodes cannot be deleted from a revision", () => {
  assert.equal(canDeleteRevisionNode("old", ["old"]), false);
});

test("new unpublished nodes can be deleted", () => {
  assert.equal(canDeleteRevisionNode("new", ["old"]), true);
});
```

Run: `cd frontend && node --experimental-strip-types --test tests/flowRevision.test.ts`

Expected: FAIL because `flowRevision.ts` does not exist.

- [ ] **Step 2: Implement policy helper and types**

Implement the pure helper, extend server/process mapping with revision metadata, and type the impact response exactly as Task 2 returns it.

- [ ] **Step 3: Restore published-flow editing with deletion guards**

Remove broad `process.published` guards from add, connect, move, and node-content update actions. In `deleteNode`, allow deletion only when `canDeleteRevisionNode` returns true. Pass `locked={false}` to the canvas and a node-level `canDeleteNode` callback; hide the delete action for published nodes and show a noninteractive lock indicator with tooltip `已发布节点不可删除`.

Render `NodeInspector` for both draft and published flows. Continue routing deadline changes through the runtime deadline API rather than the revision-content path.

For a published node, make the inspector deadline field read-only and direct teachers to `填写进度` for global or individual extensions; do not copy deadline edits into the revision draft.

- [ ] **Step 4: Enable revision save and impact preview**

- Published save button label: `保存修订`.
- Published publish button label: `重新发布`.
- Status pill: `修订中` when `hasUnpublishedChanges`, otherwise `已发布`.
- Save revision through `PUT /draft`, then refresh the mapped server flow metadata.
- Every local design edit on a published flow sets `hasUnpublishedChanges: true` immediately so the status does not depend on a round trip.
- On `重新发布`, save the draft, request revision impact, and open `RevisionImpactDialog` rather than publishing immediately.

- [ ] **Step 5: Implement confirmation dialog**

The dialog must show current/next version, changed-node count, added-node count, invalidated-node count, and affected-student count. Its destructive confirmation copy must state that affected submissions become audit-only. Confirm calls the existing publish callback; cancel performs no mutation.

- [ ] **Step 6: Verify frontend tests and build**

Run: `cd frontend && node --experimental-strip-types --test tests/*.test.ts && npm run build`

Expected: all frontend tests and production build pass.

- [ ] **Step 7: Browser-test both teacher and student paths**

Using a test flow with one completed student:

- Open the published teacher flow and verify old-node delete is absent while new-node delete is available.
- Change an old node, add and connect a new node, save, and inspect the impact dialog.
- Confirm republish and verify the original share URL is unchanged.
- Open the student topology and verify the added node appears, invalidated descendants require resubmission, and unaffected branch state remains approved.
- Verify browser console contains no React/Vite errors or warnings.

- [ ] **Step 8: Run final cross-stack verification**

```bash
cd backend && .venv/bin/pytest -q && .venv/bin/ruff check app tests
cd ../frontend && node --experimental-strip-types --test tests/*.test.ts && npm run build
```

- [ ] **Step 9: Commit Task 4**

```bash
git add frontend/src/types.ts frontend/src/App.tsx frontend/src/features/academic-flow/api.ts frontend/src/features/academic-flow/runtimeTypes.ts frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/features/academic-flow/RevisionImpactDialog.tsx frontend/src/features/academic-flow/flowRevision.ts frontend/tests/flowRevision.test.ts frontend/src/styles.css
git commit -m "Enable published workflow revision controls"
```
