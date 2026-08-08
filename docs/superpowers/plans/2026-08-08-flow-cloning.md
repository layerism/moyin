# Workflow Cloning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click workflow-copy operation that forces a unique rename and creates an unpublished, roster-free, fully editable clone with independent OSS template assets.

**Architecture:** A dedicated FastAPI clone endpoint reads the owned source flow's persisted `draft_config`, copies referenced template objects to new OSS keys, then writes the new flow, template asset rows, and audit event in one SQLite transaction. React owns the two-phase rename/success dialog, while `App` inserts the returned flow at the head of the list and reuses the existing editor navigation.

**Tech Stack:** FastAPI, Pydantic, SQLite, Aliyun OSS SDK (`oss2`), React, TypeScript, CSS, pytest, Node `node:test`.

## Global Constraints

- Work on the current branch; commit only once after the complete implementation because commit `8e79928` is the pre-development checkpoint.
- Do not modify or stage unrelated existing changes in `AGENTS.md`, `docs/05_oa_graph.md`, or `.superpowers/`.
- Do not add database fields, tables, or migrations.
- Clone only the persisted server-side `flows.draft_config`; do not copy unsaved browser state.
- Copy description, nodes, edges, layout, field/rule/time configuration, audit script references, and independent template objects/assets.
- Do not copy roster entries, versions, share tokens, instances, node instances, drafts, submissions, audit jobs, student uploads, deadline overrides, or runtime audit history.
- The clone must have `status = "draft"`, no published version, `publishedNodeIds = []`, and all nodes editable; retain node and edge IDs because they are flow-scoped.
- Normalize the proposed name with `strip()`, reject blank or over 120 characters with 422, and reject the source name or another active flow name with 409.
- OSS/database consistency is compensating atomicity: delete every newly copied object best-effort after any copy or database failure, and never return a partial clone.
- During development, add test coverage but do not run tests, builds, or browser automation; perform static business-logic review only and leave interactive validation to the user.
- At completion, remove `.pytest_cache`, `__pycache__`, and `*.egg-info`, commit the scoped implementation, then restart one local backend and one local Vite service without Docker.

---

## File Structure

- `backend/app/services/object_storage.py`: expose one server-side OSS object-copy primitive.
- `backend/app/repositories/workflows.py`: own clone validation, config/asset remapping, compensation, transaction, and audit logging.
- `backend/app/api/routes/workflows.py`: define the clone request contract and HTTP error mapping.
- `backend/tests/test_object_storage.py`: specify OSS SDK delegation and error behavior.
- `backend/tests/test_workflows.py`: specify clone boundaries, authorization, independent assets, and compensation.
- `frontend/src/features/academic-flow/flowClone.ts`: pure default-name and validation rules.
- `frontend/src/features/academic-flow/api.ts`: expose `workflowApi.cloneFlow`.
- `frontend/src/features/home/FlowCloneDialog.tsx`: render the rename, busy, and success phases with keyboard/accessibility behavior.
- `frontend/src/features/home/HomeView.tsx`: own clone UI state, explicit row action, list highlight, and dialog wiring.
- `frontend/src/App.tsx`: call the API, map the response, and prepend the new process.
- `frontend/src/styles.css`: implement the solid copy action, dialog states, responsive layout, and transient highlight.
- `frontend/tests/flowClone.test.ts`: specify pure naming rules.

### Task 1: OSS server-side copy primitive

**Files:**
- Modify: `backend/app/services/object_storage.py`
- Modify: `backend/tests/test_object_storage.py`

**Interfaces:**
- Consumes: the existing `ObjectStorage.from_bucket(...)`, `_ensure_success(...)`, and `UploadedObject`.
- Produces: `ObjectStorage.copy_object(source_key: str, target_key: str) -> UploadedObject`.

- [ ] **Step 1: Extend the fake bucket and write copy behavior tests**

Add `bucket_name = "test-bucket"`, a `copy_calls` collection, and a fake method with the real SDK shape:

```python
def copy_object(self, source_bucket_name, source_key, target_key):
    self.copy_calls.append((source_bucket_name, source_key, target_key))
    return FakeResponse(status=200, etag='"copied-etag"')
```

Add assertions that `storage.copy_object("old/key", "new/key")` delegates with the same bucket name, returns `UploadedObject(etag="copied-etag")`, converts SDK exceptions to `ObjectStorageError("OSS 复制失败")`, and rejects an HTTP status of 300 or greater.

- [ ] **Step 2: Implement the minimal copy primitive**

Add beside `put_object`:

```python
def copy_object(self, source_key: str, target_key: str) -> UploadedObject:
    try:
        response = self._bucket.copy_object(
            self._bucket.bucket_name,
            source_key,
            target_key,
        )
    except Exception as exc:
        raise ObjectStorageError("OSS 复制失败") from exc
    _ensure_success(response, "复制")
    return UploadedObject(etag=str(getattr(response, "etag", "")).strip('"'))
```

- [ ] **Step 3: Statistically review the SDK boundary without executing tests**

Confirm the fake signature matches `oss2.Bucket.copy_object(source_bucket_name, source_key, target_key, headers=None, params=None)` and that no source object is deleted or overwritten.

### Task 2: Transactional workflow clone service and API

**Files:**
- Modify: `backend/app/repositories/workflows.py`
- Modify: `backend/app/api/routes/workflows.py`
- Modify: `backend/tests/test_workflows.py`

**Interfaces:**
- Consumes: `ObjectStorage.copy_object`, `get_object_storage`, `object_key`, `timestamped_object_name`, `settings.oss_prefix`, `get_connection`, `utc_now_iso`, and existing flow serialization through `get_flow`.
- Produces: `clone_flow(flow_id: str, name: str, teacher_id: int) -> dict[str, object]` and `POST /api/workflows/{flow_id}/clone` with body `{ "name": string }`.

- [ ] **Step 1: Write repository/API tests for the complete clone boundary**

Create a `FakeCloneStorage` that records copy/delete calls, can fail on a selected copy index, and stores copied bytes under the target key. Add four focused tests:

```python
def test_clone_published_flow_creates_editable_draft_without_runtime_data(...): ...
def test_clone_rejects_source_name_duplicate_name_and_foreign_source(...): ...
def test_clone_rewrites_template_asset_ids_and_storage_keys(...): ...
def test_clone_copy_failure_compensates_objects_and_creates_no_flow(...): ...
```

The success test must create a published source with roster/runtime records, call `POST /api/workflows/{id}/clone`, and assert: 201; copied description/config; `status == "draft"`; `publishedVersionId is None`; `publishedNodeIds == []`; empty roster; no clone rows in `flow_versions`, `share_tokens`, `flow_instances`, or runtime child tables; and one `workflow_cloned` audit row whose before/after JSON contains source ID, new ID/name, and template count.

The asset test must assert every `templateAsset.assetId` and `storageKey` differs from the source, all other public metadata remains equal, each new row belongs to the new flow and original node key, and source rows/config remain unchanged.

The failure test must make the second object copy raise `ObjectStorageError`, assert a 502 response, assert the first target key was passed to `delete_object`, and assert no new flow or asset row exists.

- [ ] **Step 2: Add clone request validation and route error mapping**

Define:

```python
class CloneFlowRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
```

Add a route before the generic `/{flow_id}` delete route:

```python
@router.post("/{flow_id}/clone", status_code=status.HTTP_201_CREATED)
def post_flow_clone(
    flow_id: str,
    payload: CloneFlowRequest,
    teacher: dict[str, object] = Depends(get_current_teacher),
) -> dict[str, object]:
    try:
        return clone_flow(flow_id, payload.name, int(teacher["id"]))
    except KeyError as exc:
        raise not_found() from exc
    except DuplicateFlowNameError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FlowValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ObjectStorageError as exc:
        raise HTTPException(status_code=502, detail="模板复制失败，请稍后重试") from exc
```

Import `clone_flow` and `ObjectStorageError`. Pydantic handles blank JSON strings and overlength input at 422; the repository handles whitespace-only input after trimming.

- [ ] **Step 3: Implement clone metadata discovery and strict template validation**

In `workflows.py`, deep-copy `json.loads(source["draft_config"])`, enumerate nodes with `templateAsset.assetId`, and load each asset using one owned query. For every reference require all of the following before any OSS write:

```python
asset["flow_id"] == flow_id
asset["node_key"] == node["id"]
asset["status"] == "active"
```

Raise `FlowValidationError("流程模板资产无效，无法复制")` when a reference is absent, foreign, inactive, or does not match its node. Preserve audit script IDs/version hashes and every non-template config property verbatim.

- [ ] **Step 4: Implement independent object/asset remapping with compensation**

Generate `new_flow_id = str(uuid.uuid4())`. For each validated source asset generate a new asset UUID and:

```python
target_key = object_key(
    settings.oss_prefix,
    "templates",
    new_flow_id,
    timestamped_object_name(asset["original_name"], asset["sha256"]),
)
```

Call `storage.copy_object(source_key, target_key)`, append the target key immediately after success, replace the cloned node's entire public `templateAsset` object with the new asset ID/storage key and copied ETag while retaining filename/content type/size/hash, and prepare the new `flow_template_assets` row. If any copy raises, delete all accumulated target keys best-effort, log cleanup failures with the specific target key, then re-raise the original storage error.

- [ ] **Step 5: Insert flow/assets/audit in one immediate transaction**

Normalize `new_name = name.strip()` and reject blank/overlength with `FlowValidationError`. Before OSS writes, verify the source exists, is not archived, belongs to `teacher_id`, and the name differs from its source. Inside `BEGIN IMMEDIATE`, recheck uniqueness among `status != 'archived'`, then insert:

```text
flows: new id/name/source description/owner, status draft, remapped draft_config
flow_template_assets: new ids/new flow id/same node and metadata/new storage key/new ETag
audit_logs: action workflow_cloned, entity_type workflow, entity_id new flow id
```

Use `before_data={"sourceFlowId": flow_id}` and `after_data={"newFlowId": new_flow_id, "newName": new_name, "templateCount": len(assets)}`. On any transaction error, rely on the connection context to roll back and best-effort delete all copied target objects before re-raising. Return `get_flow(new_flow_id, teacher_id)` only after transaction success.

- [ ] **Step 6: Perform a static backend audit**

Inspect the diff and SQL foreign-key columns to confirm only `flows`, `flow_template_assets`, and `audit_logs` receive new rows; all runtime/version/roster tables remain untouched; duplicate checking occurs inside the write transaction; and every post-copy exception path invokes compensation.

### Task 3: Frontend clone rules, API, and two-phase dialog

**Files:**
- Create: `frontend/src/features/academic-flow/flowClone.ts`
- Create: `frontend/src/features/home/FlowCloneDialog.tsx`
- Modify: `frontend/src/features/academic-flow/api.ts`
- Modify: `frontend/src/features/home/HomeView.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`
- Create: `frontend/tests/flowClone.test.ts`

**Interfaces:**
- Consumes: `AcademicProcess`, `ServerFlow`, existing `mapServerFlow`, and `onOpenProcess(processId)`.
- Produces: `createFlowCloneName(sourceName: string): string`, `getFlowCloneNameError(value: string, sourceName: string, existingNames: string[]): string`, `workflowApi.cloneFlow(serverId: string, name: string): Promise<ServerFlow>`, and `onCloneProcess(source: AcademicProcess, name: string): Promise<AcademicProcess>`.

- [ ] **Step 1: Write pure naming-rule tests**

In `frontend/tests/flowClone.test.ts`, cover:

```typescript
assert.equal(createFlowCloneName("实习流程"), "实习流程 - 副本");
assert.equal(getFlowCloneNameError("   ", "实习流程", []), "请输入新流程名称");
assert.equal(getFlowCloneNameError("实习流程", "实习流程", []), "副本名称不能与原流程相同");
assert.equal(getFlowCloneNameError("其他流程", "实习流程", ["其他流程"]), "已存在同名流程");
assert.equal(getFlowCloneNameError("新流程", "实习流程", []), "");
```

Also assert 121 characters returns `"流程名称不能超过 120 个字符"`; comparisons use trimmed names.

- [ ] **Step 2: Implement pure naming rules and the API method**

Create the two pure functions with the exact messages above. Add:

```typescript
cloneFlow(serverId: string, name: string) {
  return request<ServerFlow>(`/api/workflows/${encodeURIComponent(serverId)}/clone`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
},
```

- [ ] **Step 3: Build the dedicated accessible clone dialog**

Create `FlowCloneDialog.tsx` with a discriminated result prop:

```typescript
type FlowCloneResult = { id: string; name: string } | null;
```

The rename phase renders the source name/status, “将复制：节点、连线、规则、模板”, “不会复制：学生名单、发布状态、填写数据”, an input capped at 120 characters, error `role="alert"`, and cancel/confirm buttons. Select the full default name on mount. When `submitting`, disable input, close, overlay, Escape, cancel and confirm; label the primary action “正在复制模板…”. When not submitting, Enter confirms, Escape/overlay cancels, and the close icon has `aria-label="关闭复制流程弹窗"`.

The success phase renders a green completion mark, result name, “未发布 · 可完整编辑”, an `aria-live="polite"` status, and buttons “留在流程列表” and “进入编辑”. Neither phase embeds API calls.

- [ ] **Step 4: Wire clone state and explicit row action into `AcademicFlowView`**

Add prop:

```typescript
onCloneProcess: (source: AcademicProcess, name: string) => Promise<AcademicProcess>;
```

Track `cloneSource`, `cloneName`, `cloneError`, `cloneSubmitting`, `cloneResult`, and `highlightedProcessId`. Clicking the new double-square “复制” button sets the source, computes the default name, clears errors/results, and stores the trigger element for focus restoration. Confirmation calls the pure validator, awaits `onCloneProcess`, then keeps the dialog open in success phase. “留在流程列表” closes it and marks the new ID highlighted for 2000 ms; “进入编辑” closes it and calls `onOpenProcess(result.id)`. On ordinary cancellation, restore focus to the exact copy button.

Render each row as open action plus an action group containing:

```tsx
<button className="academic-flow-clone" aria-label={`复制流程 ${process.name}`}>
  <span aria-hidden="true" className="clone-stack-icon" />
  <span>复制</span>
</button>
```

and the existing independent delete button. Apply `academic-flow-item cloned-highlight` only to the transient clone result.

- [ ] **Step 5: Connect `App` data flow**

Pass `onCloneProcess` to `AcademicFlowView`. Its callback must resolve the server ID, call `workflowApi.cloneFlow`, convert the response using the existing `mapServerFlow`, prepend exactly once using `setAcademicProcesses(current => [cloned, ...current.filter(item => item.id !== cloned.id)])`, and return the mapped `AcademicProcess` for the success dialog.

- [ ] **Step 6: Add solid interaction styling and responsive behavior**

Change the list row grid so the open region and action group remain separate. Style `.academic-flow-clone` with a visible border, light blue surface, compact double-square icon, and a small shadow; on hover use `transform: translateY(-1px)` with stronger border/shadow, and provide distinct `:focus-visible`, `:active`, and disabled states. Keep delete visually destructive and separate.

Style the dialog source card, copied/not-copied boundary blocks, busy state, and green success state consistently with the existing OA palette. Add a short `cloned-flow-highlight` keyframe that does not move layout. At narrow widths, stack dialog actions and keep the list action group fully visible without covering the flow name.

- [ ] **Step 7: Perform a static frontend audit**

Review component props and state transitions to confirm: the backend is called once; validation blocks same/duplicate/invalid names; close paths are disabled only while submitting; success does not auto-navigate; both success choices work; focus restoration targets the trigger; and a newly returned flow is prepended exactly once. Do not run Node tests, Vite build, or browser automation.

### Task 4: Final scope audit, cleanup, checkpoint, and local restart

**Files:**
- Modify only the files listed in Tasks 1–3 plus this plan.

**Interfaces:**
- Consumes: the complete backend/frontend implementation.
- Produces: one scoped implementation commit and one running backend/Vite pair.

- [ ] **Step 1: Review the final diff against the design**

Use `git diff --check`, `git diff --stat`, targeted `git diff -- <listed files>`, and source searches for `workflow_cloned`, `cloneFlow`, `publishedNodeIds`, and template asset remapping. Do not execute tests, builds, or browser tools. Confirm no schema/migration file changed and no unrelated dirty path is staged.

- [ ] **Step 2: Clean generated development artifacts**

Find and remove only `.pytest_cache` directories, `__pycache__` directories, and `*.egg-info` directories beneath the repository. Do not remove source files, virtual environments, user uploads, or unrelated `.superpowers` artifacts.

- [ ] **Step 3: Create the final implementation checkpoint**

Stage only the exact files from Tasks 1–3 and this plan, inspect `git diff --cached --stat` and `git diff --cached --check`, then commit once:

```bash
git commit -m "feat: add workflow cloning"
```

- [ ] **Step 4: Restart the local services without Docker**

Resolve existing listeners on ports 8000 and 5173, terminate only this repository's prior backend/Vite processes, start one FastAPI backend with the project's existing local command and one Vite frontend with the existing npm script, then perform only lightweight process/HTTP health checks. Do not open or automate a browser.

- [ ] **Step 5: Hand off manual verification**

Report the commit ID, service URLs, and the unrun test/build boundary. Ask the user to manually verify: default name selection, duplicate-name errors, busy lock, template-backed clone, list highlight, both success choices, no roster/runtime history, and full editability before publication.
