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

