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

