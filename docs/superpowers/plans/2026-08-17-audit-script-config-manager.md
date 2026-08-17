# Audit Script Configuration Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Do not dispatch subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose safe, schema-driven `v1` settings for every preconfigured audit script through a super-admin UI and pass immutable setting snapshots into audit execution.

**Architecture:** Extend each `versions/1/config.json` with validated `runtimeSettings`, expose typed management APIs that merge only editable values and atomically rewrite the JSON, and snapshot those values into workflow nodes as `auditScriptSettings`. The React manager fetches a script summary first, loads one config on selection, renders controls from the returned definitions, and saves values with optimistic hash checking.

**Tech Stack:** Python 3.11, FastAPI, Pydantic, SQLite JSON snapshots, React 18, TypeScript, Vite 5.

## Global Constraints

- Modify every existing audit script in `v1`; do not create `v2`.
- Keep `VISION_API_BASE_URL` and `VISION_API_KEY` in `backend/.env`; never return them to the browser or write them to script JSON.
- Keep the model JSON response protocol, untrusted-material safety instruction, response-size limit, and audit output protocol fixed in code.
- Preserve published-flow pinning of script entry hash, configuration hash, parameter snapshot, and runtime-setting snapshot.
- Existing previews must be reopened and published flows must be republished after a `v1` configuration change.
- Use the existing white panels, gray borders, blue primary actions, red error semantics, radii, spacing, and typography.
- Do not run tests, builds, browser automation, or real model requests. Perform static business-logic and source checks only.
- Use project Node.js `24.18.0` and npm `11.16.0` from `.local/node` for any permitted Node command.
- Work in the current branch, preserve unrelated working-tree changes, and attempt only task-scoped checkpoint commits.

---

### Task 1: Establish the task checkpoint

**Files:**
- Inspect only: all files listed in Tasks 2-6.

**Interfaces:**
- Consumes: current dirty working tree and read-only `.git` state.
- Produces: a recorded task boundary without staging unrelated files.

- [ ] **Step 1: Review task-owned paths and existing changes**

Run:

```bash
git status --short
git diff -- backend/app/services/audit_script_parameters.py backend/app/services/audit_script_catalog.py backend/app/api/routes/workflow_admin.py backend/app/repositories/workflows.py backend/app/repositories/audit_jobs.py backend/app/services/audit_job_worker.py backend/app/domain/workflow_revision.py backend/app/repositories/flow_instances.py frontend/src/types.ts frontend/src/features/academic-flow/auditScripts.ts frontend/src/features/academic-flow/api.ts frontend/src/features/academic-flow/AuditScriptMetadataDialog.tsx frontend/src/styles.css
```

Expected: distinguish pre-existing user changes from files untouched by this task.

- [ ] **Step 2: Attempt the pre-change checkpoint without adding unrelated files**

Run only if task-owned paths can be isolated:

```bash
git commit --allow-empty -m "chore: checkpoint before audit script config manager"
```

Expected in this managed workspace: `.git/index.lock` may be rejected as read-only. Record the failure and continue without attempting a bypass.

---

### Task 2: Extend the version configuration model

**Files:**
- Modify: `backend/app/services/audit_script_parameters.py`

**Interfaces:**
- Consumes: `versions/1/config.json` with `acceptedExtensions`, `parameters`, and optional `runtimeSettings`.
- Produces: `AuditScriptVersionConfig.runtime_settings`, `validate_script_settings(...)`, and `default_script_settings(...)`.

- [ ] **Step 1: Add runtime-setting data to the immutable configuration model**

Use these signatures:

```python
@dataclass(frozen=True)
class AuditScriptVersionConfig:
    accepted_extensions: tuple[str, ...]
    parameters: tuple[dict[str, object], ...]
    runtime_settings: tuple[dict[str, object], ...]
    sha256: str


def validate_script_settings(
    config: AuditScriptVersionConfig, settings: object
) -> dict[str, Scalar]: ...


def default_script_settings(config: AuditScriptVersionConfig) -> dict[str, Scalar]: ...
```

`default_script_settings` must return `{definition["key"]: definition["value"]}` after the configuration file has been normalized.

- [ ] **Step 2: Normalize `runtimeSettings` with the existing scalar type system**

Extend the accepted top-level keys to:

```python
{"acceptedExtensions", "parameters", "runtimeSettings"}
```

Runtime setting definitions use `value` instead of `default`, may include `multiline` only for `type="string"`, and retain the existing `minimum`, `maximum`, `minimumLength`, `maximumLength`, and `options` rules. Reject duplicate keys within runtime settings and reject more than 20 runtime settings.

- [ ] **Step 3: Include normalized settings in the configuration hash**

Canonical hashing must continue to use:

```python
json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
```

This ensures any saved value changes `configSha256` and invalidates stale snapshots rather than silently changing historical execution.

- [ ] **Step 4: Perform a static source audit**

Confirm manually that:

- missing `runtimeSettings` remains backward compatible as `[]`;
- browser values cannot add unknown keys;
- booleans are not accepted as numbers;
- multiline affects presentation only;
- all returned settings are scalar JSON values.

---

### Task 3: Define all script `v1` configurations and consume them

**Files:**
- Modify: `backend/scripts/confirmation-visual-audit/versions/1/config.json`
- Modify: `backend/scripts/confirmation-visual-audit/versions/1/handler.py`
- Modify: `backend/scripts/docx-word-count-check/versions/1/config.json`
- Create: `backend/scripts/material-basic-check/versions/1/config.json`
- Modify: `backend/app/services/audit_script_executor.py`
- Modify: `backend/.env.example`
- Inspect: `backend/scripts/docx-word-count-check/versions/1/handler.py`
- Inspect: `backend/scripts/material-basic-check/versions/1/handler.py`

**Interfaces:**
- Consumes: validated `context.scriptParams` and `context.scriptSettings` supplied by the worker.
- Produces: script output using configuration snapshots, with no secrets in JSON.

- [ ] **Step 1: Add the confirmation visual audit runtime settings**

Define these exact keys and safe ranges in `config.json`:

```text
systemPrompt          string   1..4000, multiline
modelName             string   1..200
thinkingEnabled       boolean
temperature           number   0..1
maximumPages          integer  1..20
imageMaximumSide      integer  512..4096
jpegQuality           integer  40..100
pdfRenderScale        number   1..4
requestTimeoutSeconds number   5..300
```

Use current behavior as the initial values: thinking disabled, temperature `0`, maximum pages `20`, image maximum side `2000`, JPEG quality `85`, PDF scale `2`, and request timeout `60`. Set `modelName` to the currently configured visual model name. Put only the editable business role and audit guidance in `systemPrompt`.

- [ ] **Step 2: Keep security and protocol instructions fixed in the handler**

Compose the request system message as:

```python
system = f"{settings['systemPrompt']}\n{FIXED_UNTRUSTED_MATERIAL_RULE}\n{schema_rule}"
```

The fixed rule must continue to tell the model to ignore instructions embedded in uploaded images/PDF pages. The JSON schema suffix remains derived from `scanAuditMode` and cannot be modified through the UI.

- [ ] **Step 3: Replace adjustable constants with validated settings**

Read once in `main()`:

```python
settings = payload["context"]["scriptSettings"]
```

Pass settings explicitly into page normalization, JPEG conversion, PDF rendering, and `request_audit`. Generate the provider field as:

```python
"thinking": {"type": "enabled" if settings["thinkingEnabled"] else "disabled"}
```

Use `settings["modelName"]`, `settings["temperature"]`, and `settings["requestTimeoutSeconds"]`; retain `.env` only for base URL and API key.

- [ ] **Step 4: Standardize the non-AI script configurations**

- Keep DOCX `minimumWordCount` in `parameters`; add `runtimeSettings: []`.
- Add material-basic `config.json` with empty accepted extensions, parameters, and runtime settings.
- Do not add artificial settings to scripts that have no adjustable business behavior.

- [ ] **Step 5: Narrow the visual-script environment boundary**

Remove `VISION_MODEL` and `VISION_API_TIMEOUT_SECONDS` from the confirmation script's special environment allowlist because both values now come from the validated snapshot. Keep only `VISION_API_BASE_URL` and `VISION_API_KEY`. Remove the two obsolete entries from `backend/.env.example`; do not rewrite or expose the live `backend/.env`.

- [ ] **Step 6: Parse every JSON file and compile Python sources without bytecode output**

Use a read-only static command based on `json.loads(...)` and `compile(...)`. Do not execute script main functions or send model requests.

---

### Task 4: Add catalog management reads and atomic value updates

**Files:**
- Modify: `backend/app/services/audit_script_catalog.py`
- Modify: `backend/app/api/routes/workflow_admin.py`

**Interfaces:**
- Consumes: normalized `AuditScriptVersionConfig` and super-admin authenticated requests.
- Produces: management summaries, configuration detail, and atomically saved value-only updates.

- [ ] **Step 1: Expose runtime settings in catalog records**

Add `runtime_settings` to `AuditScriptRecord` and include `runtimeSettings` in serialized public summaries so flow-node selection can snapshot script settings. Keep `list_audit_scripts()` filtered to `visibility="public"`.

- [ ] **Step 2: Add management service functions**

Use these service boundaries:

```python
def list_manageable_audit_scripts() -> list[dict[str, object]]: ...

def get_audit_script_config(script_id: str, version: int) -> dict[str, object]: ...

def update_audit_script_config(
    script_id: str,
    version: int,
    expected_config_sha256: str,
    parameter_defaults: dict[str, object],
    runtime_settings: dict[str, object],
) -> dict[str, object]: ...
```

The management list includes internal scripts. The detail response includes no entry path, environment variable, API key, or base URL.

- [ ] **Step 3: Merge values without accepting schema replacement**

For `parameters`, replace only each submitted definition's `default`. For `runtimeSettings`, replace only each submitted definition's `value`. Require the submitted key sets to match the editable definitions exactly, validate the merged JSON through `load_audit_script_version_config`, and reject an outdated hash before writing.

- [ ] **Step 4: Save atomically**

Follow the existing manifest metadata write pattern: create a temporary file inside the version directory, preserve file mode, write UTF-8 formatted JSON with a trailing newline, flush, `fsync`, and `os.replace`. On failure, delete only the resolved temporary file and raise `AuditScriptWriteError`.

- [ ] **Step 5: Add typed super-admin routes**

Add:

```http
GET /audit-scripts/manage
GET /audit-scripts/{script_id}/versions/1/config
PUT /audit-scripts/{script_id}/versions/1/config
```

Use `Depends(get_current_super_admin)` on all three. Both detail routes call the generic catalog service with `version=1`; the browser cannot select another version. The PUT Pydantic body fields are:

```python
expectedConfigSha256: str
parameterDefaults: dict[str, str | int | float | bool]
runtimeSettings: dict[str, str | int | float | bool]
```

Map missing scripts to `404`, hash conflicts to `409`, validation errors to `422`, and write errors to `500`.

---

### Task 5: Snapshot and execute script runtime settings

**Files:**
- Modify: `backend/app/repositories/workflows.py`
- Modify: `backend/app/domain/workflow_revision.py`
- Modify: `backend/app/repositories/flow_instances.py`
- Modify: `backend/app/repositories/audit_jobs.py`
- Modify: `backend/app/services/audit_job_worker.py`

**Interfaces:**
- Consumes: catalog defaults and node snapshots.
- Produces: validated `context.scriptSettings` for every audit process.

- [ ] **Step 1: Bind setting defaults into workflow nodes**

When a script is selected or the internal confirmation script is bound, add:

```python
"auditScriptSettings": default_script_settings(record.version_config)
```

For confirmation nodes, build `auditScriptParams` from every parameter default and then overwrite `scanAuditMode` and `scanAuditPrompt` with the node-specific values.

- [ ] **Step 2: Validate complete script snapshots**

Extend `_validate_audit_script_nodes` to require a dictionary `auditScriptSettings` whenever a script is configured, validate it with `validate_script_settings`, and remove it when auditing is disabled. Preserve validation of ID, version, entry hash, config hash, extensions, and parameters.

- [ ] **Step 3: Include settings in revision and safe-output fields**

Add `auditScriptSettings` to `BUSINESS_NODE_FIELDS` so configuration changes participate in revision impact analysis. Remove internal confirmation-node settings from the student-facing safe config alongside the existing internal audit fields.

- [ ] **Step 4: Carry the snapshot through claimed jobs**

Add:

```python
script_settings: object
```

to `ClaimedAuditJob`, populated from `config_node.get("auditScriptSettings", {})`.

- [ ] **Step 5: Validate and pass settings in the worker**

After validating the configuration hash and script parameters, call:

```python
script_settings = validate_script_settings(
    descriptor.version_config, job.script_settings
)
```

Then execute with:

```python
{
    **job.context,
    "scriptParams": script_params,
    "scriptSettings": script_settings,
}
```

Any missing, stale, unknown, or invalid setting must follow the existing script-resolution failure path.

---

### Task 6: Add frontend types, API calls, and generic configuration form

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/features/academic-flow/auditScripts.ts`
- Modify: `frontend/src/features/academic-flow/api.ts`
- Create: `frontend/src/features/academic-flow/auditScriptConfig.ts`
- Create: `frontend/src/features/academic-flow/AuditScriptConfigForm.tsx`
- Modify: `frontend/src/features/academic-flow/AuditScriptMetadataDialog.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: management summary/detail APIs and schema definitions.
- Produces: validated user value edits and a PUT payload with the last server hash.

- [ ] **Step 1: Extend workflow-node and script-summary types**

Add to `AcademicFlowNode`:

```typescript
auditScriptSettings?: Record<string, string | number | boolean>;
```

Add `runtimeSettings` to `AuditScriptSummary` and include their current values in `toNodeAuditScriptSelection` so public scripts snapshot settings when selected.

- [ ] **Step 2: Define management API types in `auditScriptConfig.ts`**

Create discriminated scalar definition types shared by node defaults and runtime values, plus:

```typescript
export type AuditScriptManagementSummary = {
  description: string;
  id: string;
  language: "js" | "py";
  metadataEditable: boolean;
  name: string;
  parameterCount: number;
  runtimeSettingCount: number;
  updatedAt: string;
  version: 1;
};

export type AuditScriptConfigDetail = {
  configSha256: string;
  description: string;
  id: string;
  language: "js" | "py";
  metadataEditable: boolean;
  name: string;
  parameters: AuditScriptParameter[];
  runtimeSettings: AuditScriptRuntimeSetting[];
  version: 1;
};
```

Add pure helpers that construct editable value maps and return one Chinese validation message per invalid field. Reuse the existing parameter-range semantics rather than duplicating incompatible rules.

- [ ] **Step 3: Add API client methods**

Add:

```typescript
listManageableAuditScripts()
getAuditScriptConfig(scriptId: string)
updateAuditScriptConfig(scriptId: string, payload: AuditScriptConfigUpdate)
```

Encode `scriptId`, call the literal `/versions/1/config` path, and use `PUT` only for value updates.

- [ ] **Step 4: Build a focused dynamic form component**

`AuditScriptConfigForm.tsx` owns field rendering only. Accept the detail, draft value maps, validation errors, disabled state, and change callbacks. Render:

```text
string + multiline → textarea
string             → text input
integer / number   → number input
boolean            → checkbox styled with existing controls
select             → select
```

Use explicit labels, descriptions, `min`, `max`, `minLength`, `maxLength`, `step`, `aria-invalid`, and error elements. Do not define nested React components inside render.

- [ ] **Step 5: Convert the existing dialog into list/detail orchestration**

Keep `AuditScriptMetadataDialog` as the modal owner. Its states are:

```text
loading list → list → loading detail → editing → saving → saved/list
                                 ↘ load/save error retained in place
```

Load the management list on open, load one detail on “配置/查看”, preserve drafts on save failure, replace detail/hash from a successful response, and prevent close while saving. A zero-setting script shows “当前脚本暂无可调参数”.

Preserve the existing public-script name/description editor and PATCH call as a separate list action. Use `metadataEditable=false` for internal scripts, whose basic information remains read-only while their `v1` configuration stays editable.

- [ ] **Step 6: Add the version-impact warning and conflict handling**

Render this persistent message above the footer:

```text
配置变更会更新脚本 v1 哈希；已有预览需重新打开，已发布流程需重新发布。
```

For `409`, show “配置已被其他管理员修改，请重新加载”. For validation failures, place field errors where possible and otherwise use the existing red dialog error style.

- [ ] **Step 7: Extend existing styles without creating a second visual system**

Reuse `.audit-script-metadata-*` foundations. Add only focused classes for section headings, field descriptions/errors, boolean rows, the fixed warning, and responsive footer behavior. Preserve the existing modal width unless runtime-setting textareas require a bounded increase that remains within the viewport.

---

### Task 7: Final static audit, cleanup, restart, and checkpoint

**Files:**
- Review: every file modified in Tasks 2-6.
- Update: this plan's checkboxes as work completes.

**Interfaces:**
- Consumes: completed source changes.
- Produces: evidence-limited handoff with running local services.

- [ ] **Step 1: Audit the complete data flow**

Trace and record:

```text
v1/config.json
→ catalog normalization/hash
→ super-admin GET/PUT
→ React draft/save
→ workflow auditScriptSettings snapshot
→ claimed audit job
→ worker validation
→ context.scriptSettings
→ handler consumption
```

Confirm no API response or JSON file contains `VISION_API_KEY` or `VISION_API_BASE_URL`.

- [ ] **Step 2: Run permitted static checks only**

Run focused `git diff --check`, parse all three script configuration JSON files, and compile modified Python source strings with `compile(...)` without generating bytecode. Review TypeScript property names against API response names manually. Do not run pytest, npm tests, TypeScript builds, Vite builds, browser automation, or real audit calls.

- [ ] **Step 3: Clean source caches only**

List caches under project source directories, then remove only confirmed `.pytest_cache`, `__pycache__`, and `*.egg-info` paths. Do not delete `.venv`, `node_modules`, dependency `dist`, or unrelated workspace files.

- [ ] **Step 4: Restart local services**

Resolve the exact project-owned listeners on `8000` and `5173`, terminate only their confirmed parent processes, then restart:

```bash
cd backend
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

```bash
cd frontend
export PATH="$PWD/../.local/node/bin:$PATH"
npm run dev -- --host 0.0.0.0
```

Verify both ports are listening by the expected processes. Do not send HTTP or browser requests.

- [ ] **Step 5: Attempt the result checkpoint**

Stage only task-owned source files, the approved spec, and this plan. Attempt:

```bash
git commit -m "feat: add audit script configuration manager"
```

If `.git/index.lock` is rejected as read-only, report that exact limitation and leave all changes unstaged rather than bypassing repository protections.

- [ ] **Step 6: Report verification boundaries**

State separately:

- implemented source behavior;
- static checks actually run;
- local service listener status;
- tests/build/browser/model calls not run;
- the requirement to reopen previews or republish flows after `v1` hash changes.
