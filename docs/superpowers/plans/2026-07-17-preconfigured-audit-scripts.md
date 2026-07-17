# Preconfigured Audit Scripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace administrator-managed audit-script uploads with version-controlled scripts discovered from `backend/scripts`, while preserving read-only selection and fixed-version execution in file-upload nodes.

**Architecture:** A focused catalog service scans one manifest per script and resolves immutable files below `versions/<n>/`. The existing list endpoint delegates to the catalog, all write/template endpoints and the management UI are deleted, and the existing node selector continues to persist ID, version, name and SHA-256.

**Tech Stack:** Python 3.12, FastAPI, pathlib/json/hashlib, React 18, TypeScript, Vite.

## Global Constraints

- Script source is deployed with backend code below `backend/scripts/<script-id>/`.
- Only `.py` and `.js` entries are accepted.
- No HTTP endpoint may download, upload, update or archive audit scripts.
- New selections use the manifest's current version; published nodes retain their stored version and SHA-256.
- Invalid scripts are logged and omitted without blocking valid scripts.
- Do not add dependencies.

---

### Task 1: Read-only script catalog and immutable resolver

**Files:**
- Create: `backend/app/services/audit_script_catalog.py`
- Modify: `backend/app/services/audit_script_runtime.py`
- Replace: `backend/tests/test_audit_scripts_api.py`
- Modify: `backend/tests/test_audit_script_runtime.py`

**Interfaces:**
- Produces: `list_audit_scripts() -> list[dict[str, object]]`
- Produces: `resolve_audit_script_version(script_id: str, version: int, expected_sha256: str) -> AuditScriptRuntimeDescriptor`
- Consumes: `settings.audit_scripts_root`

- [ ] **Step 1: Replace repository/API tests with failing catalog tests**

Create helpers that write this structure under the temporary root:

```python
def write_script(root: Path, script_id: str = "material-check", version: int = 1) -> Path:
    script = root / script_id
    version_dir = script / "versions" / str(version)
    version_dir.mkdir(parents=True)
    entry = version_dir / "handler.py"
    entry.write_text("def run(payload): return {'passed': True}", encoding="utf-8")
    (script / "manifest.json").write_text(json.dumps({
        "id": script_id,
        "name": "材料基础校验",
        "description": "校验材料结构",
        "language": "py",
        "version": version,
        "entry": "handler.py",
    }), encoding="utf-8")
    return entry
```

Assert that valid scripts are listed with a computed SHA-256; malformed JSON, missing entries, path escapes, language mismatches and duplicate IDs are omitted; ordering is stable; an empty root returns `[]`.

- [ ] **Step 2: Run the focused test to confirm the old implementation fails**

Run: `cd backend && PYTHONPATH=. ./.venv/bin/pytest -q tests/test_audit_scripts_api.py`

Expected: FAIL because the catalog module does not exist or the list endpoint still queries SQLite.

- [ ] **Step 3: Implement the catalog with standard-library validation**

Use a frozen record for validated manifests and private helpers:

```python
@dataclass(frozen=True)
class AuditScriptRecord:
    id: str
    name: str
    description: str
    language: Literal["py", "js"]
    version: int
    entry_path: Path
    sha256: str
    updated_at: str

def list_audit_scripts() -> list[dict[str, object]]: ...
def find_audit_script_version(script_id: str, version: int) -> AuditScriptRecord: ...
```

Validate IDs with `re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", value)`, require non-empty bounded name/description, positive integer version, an entry basename only, matching suffix, resolved paths under the configured root, readable files no larger than `audit_script_max_bytes`, and unique IDs. Log invalid directories with `logging.getLogger(__name__).warning(...)` without returning absolute paths to API clients.

- [ ] **Step 4: Refactor runtime resolution to use the catalog**

Replace database lookup with:

```python
record = find_audit_script_version(script_id, version)
if record.sha256 != expected_sha256:
    raise AuditScriptResolutionError("无法解析审核脚本版本")
return AuditScriptRuntimeDescriptor(
    script_id=record.id,
    version=record.version,
    language=record.language,
    entry_path=record.entry_path,
    sha256=record.sha256,
)
```

Map catalog validation, missing-version and OS errors to the existing non-leaking `AuditScriptResolutionError`.

- [ ] **Step 5: Update runtime tests for directory versions**

Make version `1` and `2` coexist under `versions/1/handler.py` and `versions/2/handler.py`, set the manifest current version to `2`, and assert that the resolver can still resolve version `1` by its stored hash. Preserve the tamper, missing file, traversal and hash mismatch checks.

- [ ] **Step 6: Focused verification**

Run: `cd backend && PYTHONPATH=. ./.venv/bin/pytest -q tests/test_audit_scripts_api.py tests/test_audit_script_runtime.py`

Expected: PASS.

---

### Task 2: Remove writable API and legacy persistence code

**Files:**
- Modify: `backend/app/api/routes/workflow_admin.py`
- Delete: `backend/app/repositories/audit_scripts.py`
- Delete: `backend/app/services/audit_script_templates.py`
- Modify: `backend/tests/test_audit_scripts_api.py`

**Interfaces:**
- Consumes: `list_audit_scripts()` from `app.services.audit_script_catalog`
- Produces: only `GET /api/workflow-admin/audit-scripts`

- [ ] **Step 1: Add route-removal assertions**

After authenticating as a super administrator, assert:

```python
assert client.get("/api/workflow-admin/audit-scripts/templates/python").status_code == 404
assert client.post("/api/workflow-admin/audit-scripts").status_code == 405
assert client.put("/api/workflow-admin/audit-scripts/material-check").status_code == 405
assert client.delete("/api/workflow-admin/audit-scripts/material-check").status_code == 405
```

- [ ] **Step 2: Remove all mutation/template route code**

Reduce the route imports and endpoint to:

```python
from app.services.audit_script_catalog import list_audit_scripts

@router.get("/audit-scripts")
def get_audit_scripts() -> list[dict[str, object]]:
    return list_audit_scripts()
```

Remove FastAPI multipart imports and obsolete exception mapping helpers that were only used by script mutations.

- [ ] **Step 3: Delete obsolete repository and template generator**

Delete both modules after confirming no remaining imports with:

Run: `rg -n "repositories.audit_scripts|audit_script_templates|create_audit_script|create_audit_script_version|archive_audit_script" backend`

Expected: only obsolete tests before their replacement; no application imports.

- [ ] **Step 4: Verify read-only API behavior**

Run: `cd backend && PYTHONPATH=. ./.venv/bin/pytest -q tests/test_audit_scripts_api.py`

Expected: authenticated users receive the catalog, and all removed methods/routes return 404 or 405 as asserted.

---

### Task 3: Add a version-controlled example script

**Files:**
- Modify: `.gitignore`
- Delete: `backend/scripts/.gitkeep`
- Create: `backend/scripts/material-basic-check/manifest.json`
- Create: `backend/scripts/material-basic-check/versions/1/handler.py`

**Interfaces:**
- Consumes: the manifest contract from Task 1.
- Produces: one selectable Python audit script.

- [ ] **Step 1: Allow deployed scripts in Git**

Remove the broad `backend/scripts/*` ignore rule. Keep existing Python cache rules so `__pycache__` below script directories remains ignored.

- [ ] **Step 2: Add manifest and minimal JSON handler**

Use this manifest:

```json
{
  "id": "material-basic-check",
  "name": "材料基础校验",
  "description": "校验审核输入结构及文件数量，作为后台预置脚本示例",
  "language": "py",
  "version": 1,
  "entry": "handler.py"
}
```

The handler must read one JSON object from stdin, preserve one result per input file, and write one JSON object to stdout using the existing template contract. It must not read project environment variables or perform network access.

- [ ] **Step 3: Confirm catalog visibility**

Run: `cd backend && PYTHONPATH=. ./.venv/bin/python -c 'from app.services.audit_script_catalog import list_audit_scripts; print(list_audit_scripts())'`

Expected: one item with ID `material-basic-check`, version `1`, language `py`, and a 64-character SHA-256.

---

### Task 4: Remove frontend management UI and retain node selection

**Files:**
- Modify: `frontend/src/features/home/HomeView.tsx`
- Modify: `frontend/src/features/academic-flow/api.ts`
- Modify: `frontend/src/features/academic-flow/auditScripts.ts`
- Modify: `frontend/tests/auditScripts.test.ts`
- Delete: `frontend/src/features/academic-flow/AuditScriptManagerDialog.tsx`
- Delete: `frontend/src/features/academic-flow/auditScriptManager.ts`
- Delete: `frontend/tests/auditScriptManager.test.ts`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Retains: `workflowApi.listAuditScripts()`
- Retains: `AuditScriptSelector` and fixed-version fallback option.

- [ ] **Step 1: Remove the management entry and dialog state**

Delete the `AuditScriptManager` import, `scriptManagerOpen` state, super-admin “审核脚本” button and dialog render from `HomeView.tsx`. The page keeps only “创建流程” in its tools area.

- [ ] **Step 2: Remove mutation/download client methods**

Delete `requestBlob`, `uploadAuditScript`, `updateAuditScript` and `downloadAuditScriptTemplate` from `api.ts`. Keep `listAuditScripts()` unchanged.

- [ ] **Step 3: Remove legacy hard-coded script choices**

Reduce node options to one disabled choice plus scanned scripts:

```typescript
const noAuditScript = { label: "不启用材料审核", value: "" };
```

Continue appending a fixed-version fallback when an existing node references a version absent from the current list. `resolveAuditScriptSelection("")` must clear all five script fields.

- [ ] **Step 4: Update selector tests**

Assert that the first option is “不启用材料审核”, no hard-coded `check_material.py` or `check_filename.mjs` option remains, scanned scripts include language and version, and fixed old versions remain visible without switching to the latest.

- [ ] **Step 5: Delete manager implementation and styles**

Delete the dialog/helper/test files and CSS rules from `.audit-script-backdrop` through the manager form/table responsive rules. Preserve `.audit-script-section` and `.audit-script-error` rules used by the node inspector.

- [ ] **Step 6: Static reference check**

Run: `rg -n "AuditScriptManager|auditScriptManager|uploadAuditScript|updateAuditScript|downloadAuditScriptTemplate|下载 Python 模板|上传新脚本" frontend/src frontend/tests`

Expected: no matches.

---

### Task 5: Cleanup, review and service restart

**Files:**
- Verify: all files above
- Update: `docs/superpowers/plans/2026-07-17-preconfigured-audit-scripts.md` checkboxes if execution tracking is retained

**Interfaces:** None.

- [ ] **Step 1: Check repository diff and prohibited endpoints**

Run: `git diff --check`

Run: `rg -n "@router\.(post|put|delete)\(\"/audit-scripts|audit-scripts/templates" backend/app`

Expected: no whitespace errors and no writable/template audit-script routes.

- [ ] **Step 2: Clean generated caches**

Remove `.pytest_cache`, `__pycache__`, `*.egg-info`, frontend `dist` and `.vite` only when generated by this work; do not touch user files.

- [ ] **Step 3: Preserve unrelated worktree changes and create one implementation commit**

Stage only the spec correction, plan, backend catalog/runtime/routes/tests/example script, frontend removals/selector changes and `.gitignore`. Do not stage `AGENTS.md`, `docs/05_oa_graph.md` or existing `.superpowers/` artifacts.

- [ ] **Step 4: Restart services**

Stop the existing Uvicorn and Vite processes, start one backend on `127.0.0.1:8000` and one frontend on `127.0.0.1:5173`, then confirm `/api/health` and `/academic-flow` respond successfully.

