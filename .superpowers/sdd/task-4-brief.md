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
