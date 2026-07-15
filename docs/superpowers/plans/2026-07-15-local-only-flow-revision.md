# Local-Only Flow Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make flow configuration edits local to the designer and persist them only when first publish or confirmed republish succeeds.

**Architecture:** The designer owns an in-memory working copy and dirty flag while the parent retains the last server-confirmed baseline. Revision impact accepts a configuration payload without mutation; publish accepts the same configuration and persists it atomically with the new immutable version.

**Tech Stack:** React 18, TypeScript 5.6, FastAPI, Pydantic, SQLite, pytest, Node test runner.

## Global Constraints

- Remove “保存草稿／保存修订” and “保存并退出” from the designer.
- Published edits must not call the draft-save endpoint.
- Keep the existing revision-impact confirmation dialog.
- Preserve local edits after preview or publish errors.
- Do not modify connection rules or student runtime rendering.
- Per user instruction, implement all code changes before asking whether to run automated tests.
- Preserve unrelated changes in `docs/05_oa_graph.md` and `.superpowers/sdd/`.

---

### Task 1: Stateless revision-impact and atomic publish payloads

**Files:**
- Modify: `backend/app/api/routes/workflows.py`
- Modify: `backend/app/repositories/workflows.py`
- Test: `backend/tests/test_workflows.py`

**Interfaces:**
- Consumes: `{ "config": { "nodes": [...], "edges": [...] } }` from the designer.
- Produces: `get_revision_impact(flow_id, teacher_id, config)` and `publish_flow(flow_id, teacher_id, config, expected_draft_config_hash, expected_current_version_id)`.

- [ ] **Step 1: Extend request models and route calls**

```python
class RevisionImpactRequest(BaseModel):
    config: dict[str, Any]


class PublishFlowRequest(BaseModel):
    config: dict[str, Any] | None = None
    expectedDraftConfigHash: str | None = None
    expectedCurrentVersionId: str | None = None
```

Pass `payload.config` into impact preview and publish. Keep `config` optional on publish only for backward compatibility with existing callers; the designer always sends it.

- [ ] **Step 2: Compute impact from the supplied configuration**

```python
def get_revision_impact(
    flow_id: str,
    teacher_id: int,
    config: dict[str, Any] | None = None,
) -> dict[str, object]:
    # Verify ownership first. Use payload config when present; otherwise use the
    # persisted draft only for backward-compatible API calls.
```

Validate and hash the supplied configuration without updating `flows` or inserting a version.

- [ ] **Step 3: Persist the supplied configuration inside the publish transaction**

```python
config = supplied_config if supplied_config is not None else json.loads(flow["draft_config"])
snapshot = canonical_json(config)
config_hash = hashlib.sha256(snapshot.encode("utf-8")).hexdigest()
```

After all validation and concurrency checks pass, update `flows.draft_config`, `flows.status`, and `flows.updated_at` in the same transaction that inserts `flow_versions`. A rejected publish must leave all tables unchanged.

- [ ] **Step 4: Add deferred backend regression cases**

Add tests proving that payload-based preview does not change `flows.draft_config`, confirmed publish stores the payload and creates one version, and a stale `expectedCurrentVersionId` leaves the database unchanged. Do not run them until the user authorizes testing.

- [ ] **Step 5: Commit backend API changes**

```bash
git add backend/app/api/routes/workflows.py backend/app/repositories/workflows.py backend/tests/test_workflows.py
git commit -m "Make flow revision preview stateless"
```

### Task 2: Frontend publish client sends an immutable configuration snapshot

**Files:**
- Modify: `frontend/src/features/academic-flow/api.ts`
- Modify: `frontend/src/features/academic-flow/flowRevision.ts`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/tests/flowRevision.test.ts`

**Interfaces:**
- Consumes: `AcademicProcess`, preview hash, and current published version ID.
- Produces: `workflowApi.getRevisionImpact(serverId, process)` and `workflowApi.publish(serverId, process, expectedDraftConfigHash, expectedCurrentVersionId)`.

- [ ] **Step 1: Define one configuration serializer**

```ts
export function createFlowConfig(process: AcademicProcess) {
  return { edges: process.edges, nodes: process.nodes };
}
```

Use this serializer for both preview and publish so the confirmed payload matches the previewed payload.

- [ ] **Step 2: Send configuration in both API requests**

```ts
getRevisionImpact(serverId: string, process: AcademicProcess) {
  return request<RevisionImpact>(path, {
    method: "POST",
    body: JSON.stringify({ config: createFlowConfig(process) }),
  });
}
```

```ts
publish(serverId, process, expectedDraftConfigHash, expectedCurrentVersionId) {
  return request<PublishedFlow>(path, {
    method: "POST",
    body: JSON.stringify({
      config: createFlowConfig(process),
      expectedDraftConfigHash: expectedDraftConfigHash ?? null,
      expectedCurrentVersionId: expectedCurrentVersionId ?? null,
    }),
  });
}
```

- [ ] **Step 3: Remove pre-publish draft saving in `App.tsx`**

`publishAcademicProcess` creates only missing flow metadata, then publishes the supplied configuration directly. It must not call `saveAcademicProcess` or `workflowApi.saveDraft`.

- [ ] **Step 4: Add deferred payload tests**

Assert that the serializer includes the exact nodes and edges and that preview/publish payload construction uses the same configuration. Do not run them until the user authorizes testing.

- [ ] **Step 5: Commit frontend API changes**

```bash
git add frontend/src/features/academic-flow/api.ts frontend/src/features/academic-flow/flowRevision.ts frontend/src/App.tsx frontend/tests/flowRevision.test.ts
git commit -m "Publish flow configurations directly"
```

### Task 3: Local designer working copy and discard protection

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Modify: `frontend/src/features/academic-flow/publishButtonState.ts`
- Test: `frontend/tests/publishButtonState.test.ts`

**Interfaces:**
- Consumes: last server-confirmed `process` prop and the publish callbacks from Task 2.
- Produces: local `workingProcess`, `revisionDirty`, guarded navigation, and the three labels “提交发布／解锁编辑／重新发布”.

- [ ] **Step 1: Replace parent-backed editing with a local working copy**

```ts
const [workingProcess, setWorkingProcess] = useState(() => structuredClone(process));
const [revisionDirty, setRevisionDirty] = useState(false);
const [revisionEditingRequested, setRevisionEditingRequested] = useState(false);

const commitDesignChange = (nextProcess: AcademicProcess) => {
  if (editorLocked) return;
  setWorkingProcess({ ...nextProcess, hasUnpublishedChanges: true });
  setRevisionDirty(true);
};
```

Render and edit `workingProcess`; do not call `onProcessChange` during local edits. Call it only after a successful publish supplies the new baseline.

- [ ] **Step 2: Use explicit local edit state for the unified button**

```ts
export function getRevisionEditing(published: boolean, requested: boolean) {
  return published && requested;
}
```

Change the locked published label from “流程修改” to “解锁编辑”. Disable “重新发布” until `revisionDirty` is true.

- [ ] **Step 3: Preview and publish a frozen working snapshot**

On “重新发布”, clone `workingProcess`, request impact for that clone, and retain it as the pending candidate. Confirm using the candidate, `draftConfigHash`, and `currentVersionId`. On cancel or error, retain the working copy; on success, replace it with the returned baseline and clear local edit state.

- [ ] **Step 4: Remove save actions**

Delete the `onSaveProcess` prop, `saveProcess` handler, “保存草稿／保存修订” button, and “保存并退出” button from `AcademicFlowDesigner` and both call sites in `App.tsx`.

- [ ] **Step 5: Guard dirty navigation and browser exit**

```ts
const confirmDiscard = (navigate: () => void) => {
  if (!revisionDirty || window.confirm("未发布修改将丢失，确认离开吗？")) navigate();
};

useEffect(() => {
  if (!revisionDirty) return;
  const handleBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
  window.addEventListener("beforeunload", handleBeforeUnload);
  return () => window.removeEventListener("beforeunload", handleBeforeUnload);
}, [revisionDirty]);
```

Apply the guard to the standalone header and breadcrumb return/home actions.

- [ ] **Step 6: Add deferred state tests**

Update button-state tests for “解锁编辑”, local dirty state, and operation locks. Do not run them until the user authorizes testing.

- [ ] **Step 7: Commit designer changes**

```bash
git add frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/features/academic-flow/publishButtonState.ts frontend/tests/publishButtonState.test.ts frontend/src/App.tsx
git commit -m "Keep flow revisions in the browser"
```

### Task 4: Published baseline loading and deferred verification

**Files:**
- Modify: `backend/app/repositories/workflows.py`
- Test: `backend/tests/test_workflows.py`

**Interfaces:**
- Consumes: latest published `config_snapshot`.
- Produces: published flows whose `config` is always the current published snapshot and whose `hasUnpublishedChanges` is false.

- [ ] **Step 1: Ignore legacy persisted revisions when loading a published flow**

```python
visible_config = published_config if published_config is not None else draft_config
```

Return `visible_config` as `config`. This makes refresh/re-entry discard any legacy unpublished draft and show the current published version.

- [ ] **Step 2: Add deferred baseline regression test**

Persist a different legacy draft after publication, reload the flow, and assert that the API returns the published snapshot with `hasUnpublishedChanges is False`. Do not run it until the user authorizes testing.

- [ ] **Step 3: Perform static review only**

Inspect the final diff for unintended draft saves, verify that unrelated working-tree files are untouched, and run `git diff --check`. Do not run test or build commands yet.

- [ ] **Step 4: Commit baseline behavior**

```bash
git add backend/app/repositories/workflows.py backend/tests/test_workflows.py
git commit -m "Load published flows from their current version"
```

- [ ] **Step 5: Ask for test authorization**

Offer backend pytest, frontend Node tests, TypeScript build, or manual browser verification only after implementation is complete.
