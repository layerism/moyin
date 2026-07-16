# Local Audit Script Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, super-admin-managed JSON-contract Python/JavaScript audit-script library that teachers can select in file-upload nodes.

**Architecture:** Script source is stored as immutable local versions in `backend/scripts/global/<script_id>/<version>/`, with searchable metadata in SQLite. Teacher-authenticated requests can list only global script metadata; template download and all mutations require `super_admin`. A node keeps script ID, version and hash so a published flow retains the selected source version.

**Tech Stack:** FastAPI, SQLite, Pydantic Settings, React, TypeScript, pytest, Node built-in test runner.

## Global Constraints

- Store source only below `backend/scripts/`; do not use OSS for scripts.
- Only `super_admin` may download templates, upload, version or archive scripts.
- Accept non-empty `.py`/`.js` source no larger than 1 MiB; never import or execute it in this feature.
- Templates accept exactly one JSON object on stdin and print exactly one JSON object on stdout; errors use stderr.
- Preserve current built-in script options. Persist `auditScriptId`, `auditScriptVersion`, and `auditScriptHash` with nodes.
- Do not expose source code or project `.env` values to teachers or uploaded scripts.

---

## Task 1: Persist immutable script versions

**Files:**

- Modify: `backend/app/core/config.py`
- Modify: `backend/app/core/database.py`
- Create: `backend/app/services/audit_script_templates.py`
- Create: `backend/app/repositories/audit_scripts.py`
- Create: `backend/tests/test_audit_scripts_api.py`

**Interfaces:** `get_template_source(language)`, `create_audit_script(name, filename, content, admin_id)`, `create_audit_script_version(script_id, filename, content, admin_id)`, `list_audit_scripts()`, `archive_audit_script(script_id, admin_id)`.

- [ ] **Step 1: Write failing repository tests**

```python
def test_create_script_writes_manifest_and_handler(tmp_path: Path) -> None:
    settings.audit_scripts_root = str(tmp_path / "scripts")
    script = create_audit_script("材料基础校验", "check.py", b"def run(payload): return {}", 1)
    directory = tmp_path / "scripts" / "global" / script["id"] / "1"
    assert (directory / "handler.py").exists()
    assert json.loads((directory / "manifest.json").read_text("utf-8"))["sha256"] == script["sha256"]

def test_python_template_has_json_contract() -> None:
    source, filename = get_template_source("python")
    assert filename == "audit_script_template.py"
    assert "def run(payload: dict) -> dict:" in source
    assert "json.loads(sys.stdin.read())" in source
```

- [ ] **Step 2: Verify tests fail before implementation**

Run: `cd backend && PYTHONPATH=. ./.venv/bin/pytest -q tests/test_audit_scripts_api.py`

Expected: collection failure because `app.repositories.audit_scripts` does not exist.

- [ ] **Step 3: Add schema, settings and template sources**

Add `audit_scripts_root: str = str(Path(__file__).resolve().parents[2] / "scripts")` and `audit_script_max_bytes: int = 1_048_576` to `Settings`. Add these tables to `SCHEMA`:

```sql
CREATE TABLE IF NOT EXISTS audit_scripts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  language TEXT NOT NULL CHECK (language IN ('py', 'js')),
  current_version INTEGER NOT NULL,
  created_by INTEGER NOT NULL REFERENCES teacher_accounts(id),
  created_at TEXT NOT NULL, archived_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_script_versions (
  script_id TEXT NOT NULL REFERENCES audit_scripts(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL, entry_filename TEXT NOT NULL,
  directory_path TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  created_by INTEGER NOT NULL REFERENCES teacher_accounts(id), created_at TEXT NOT NULL,
  PRIMARY KEY (script_id, version_no)
);
```

Implement `handler.py` template with `json.loads(sys.stdin.read())`, `run(payload)` and `print(json.dumps(result, ensure_ascii=False))`. Implement `handler.js` with `readFileSync(0, "utf8")`, `await run(payload)` and `process.stdout.write(JSON.stringify(result))`.

- [ ] **Step 4: Implement storage repository**

Validate display name, extension, content length and 1 MiB limit. Generate UUID/hash, write `handler.<suffix>` and `manifest.json` to a temporary sibling directory, atomically rename it to `global/<id>/<version>`, then insert metadata in one transaction. On failure remove only the new directory. List only unarchived `{id, name, language, version, sha256}` metadata and never filesystem paths.

- [ ] **Step 5: Run tests and commit**

Run: `cd backend && PYTHONPATH=. ./.venv/bin/pytest -q tests/test_audit_scripts_api.py`

Expected: PASS.

Run: `git add backend/app/core/config.py backend/app/core/database.py backend/app/services/audit_script_templates.py backend/app/repositories/audit_scripts.py backend/tests/test_audit_scripts_api.py && git commit -m "feat: persist versioned audit scripts"`

## Task 2: Add role-protected API routes

**Files:**

- Modify: `backend/app/api/routes/workflow_admin.py`
- Modify: `backend/tests/test_audit_scripts_api.py`

**Interfaces:** `GET /audit-scripts` is readable by teachers; template, create, version and archive routes require `get_current_super_admin`.

- [ ] **Step 1: Write failing authorization tests**

```python
def test_teacher_can_list_but_cannot_upload_or_download_template(client: TestClient) -> None:
    assert client.get("/api/workflow-admin/audit-scripts").status_code == 200
    assert client.get("/api/workflow-admin/audit-scripts/templates/python").status_code == 403
    response = client.post("/api/workflow-admin/audit-scripts", data={"name": "材料审核"}, files={"file": ("audit.py", b"def run(payload): return {}", "text/x-python")})
    assert response.status_code == 403
```

- [ ] **Step 2: Verify route tests fail before adding endpoints**

Run: `cd backend && PYTHONPATH=. ./.venv/bin/pytest -q tests/test_audit_scripts_api.py`

Expected: FAIL because routes are absent.

- [ ] **Step 3: Implement the endpoints**

Also add `PUT /audit-scripts/{script_id}` for a new immutable version and `DELETE /audit-scripts/{script_id}` to archive the entry. Convert unknown IDs to 404, name/version conflicts to 409, and source validation errors to 422. Never return source or directory paths.

- [ ] **Step 4: Run API tests and commit**

Run: `cd backend && PYTHONPATH=. ./.venv/bin/pytest -q tests/test_audit_scripts_api.py`

Expected: PASS.

Run: `git add backend/app/api/routes/workflow_admin.py backend/tests/test_audit_scripts_api.py && git commit -m "feat: add super-admin audit script APIs"`

## Task 3: Freeze script identity in workflow snapshots

**Files:**

- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/features/academic-flow/academicFlowData.ts`
- Modify: `backend/app/domain/workflow_revision.py`
- Modify: `frontend/tests/flowRevision.test.ts`
- Modify: `frontend/tests/nodeSettingCapabilities.test.ts`
- Modify: `backend/tests/test_workflow_revision.py`

**Interfaces:** Node fields are `auditScriptId?: string`, `auditScriptVersion?: number`, `auditScriptHash?: string`.

- [ ] **Step 1: Write failing revision tests**

```python
def test_script_version_change_invalidates_a_published_node() -> None:
    previous = {"nodes": [{"id": "file", "auditScriptId": "a", "auditScriptVersion": 1, "auditScriptHash": "x"}], "edges": []}
    current = {"nodes": [{"id": "file", "auditScriptId": "a", "auditScriptVersion": 2, "auditScriptHash": "y"}], "edges": []}
    assert analyze_revision(previous, current)["invalidatedNodeIds"] == ["file"]
```

- [ ] **Step 2: Verify current revision code fails the new test**

Run: `cd backend && PYTHONPATH=. ./.venv/bin/pytest -q tests/test_workflow_revision.py`

Expected: FAIL because `BUSINESS_NODE_FIELDS` omits immutable script fields.

- [ ] **Step 3: Extend types and revision fields**

```ts
export type AuditScriptType = "js" | "mjs" | "none" | "py";
export type AcademicFlowNode = {
  auditScriptHash?: string;
  auditScriptId?: string;
  auditScriptName: string;
  auditScriptType: AuditScriptType;
  auditScriptVersion?: number;
};
```

Add the three fields to `BUSINESS_NODE_FIELDS`. Keep `check_material.py` and `check_filename.mjs` as legacy built-ins with unset immutable fields.

- [ ] **Step 4: Run focused tests and commit**

Run: `cd frontend && node --experimental-strip-types --test tests/flowRevision.test.ts tests/nodeSettingCapabilities.test.ts`

Expected: PASS.

Run: `cd backend && PYTHONPATH=. ./.venv/bin/pytest -q tests/test_workflow_revision.py`

Expected: PASS.

Run: `git add frontend/src/types.ts frontend/src/features/academic-flow/academicFlowData.ts frontend/tests/flowRevision.test.ts frontend/tests/nodeSettingCapabilities.test.ts backend/app/domain/workflow_revision.py backend/tests/test_workflow_revision.py && git commit -m "feat: preserve audit script versions in workflows"`

## Task 4: Build a role-aware selector

**Files:**

- Create: `frontend/src/features/academic-flow/auditScripts.ts`
- Create: `frontend/src/features/academic-flow/AuditScriptSelector.tsx`
- Modify: `frontend/src/features/academic-flow/api.ts`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Modify: `frontend/src/App.tsx`
- Create: `frontend/tests/auditScripts.test.ts`

**Interfaces:** `AuditScriptSummary`, `getAuditScriptOptions()`, `toNodeAuditScriptSelection()`, `AuditScriptSelector`.

- [ ] **Step 1: Write failing selection mapping test**

```typescript
test("global scripts map to immutable node fields", () => {
  const script = { id: "script-1", name: "材料审核", language: "js", version: 3, sha256: "abc" };
  assert.equal(getAuditScriptOptions([script]).at(-1)?.label, "材料审核（JavaScript，v3）");
  assert.deepEqual(toNodeAuditScriptSelection(script), { auditScriptHash: "abc", auditScriptId: "script-1", auditScriptName: "材料审核", auditScriptType: "js", auditScriptVersion: 3 });
});
```

- [ ] **Step 2: Verify test fails before helper implementation**

Run: `cd frontend && node --experimental-strip-types --test tests/auditScripts.test.ts`

Expected: FAIL because `auditScripts.ts` is absent.

- [ ] **Step 3: Implement API and UI integration**

```ts
export type AuditScriptSummary = { id: string; language: "js" | "py"; name: string; sha256: string; version: number };
export function toNodeAuditScriptSelection(script: AuditScriptSummary | null): Partial<AcademicFlowNode> {
  return script
    ? { auditScriptHash: script.sha256, auditScriptId: script.id, auditScriptName: script.name, auditScriptType: script.language, auditScriptVersion: script.version }
    : { auditScriptHash: undefined, auditScriptId: undefined, auditScriptName: "", auditScriptType: "none", auditScriptVersion: undefined };
}
```

Add `workflowApi.listAuditScripts()`, `workflowApi.uploadAuditScript(name, file)`, and `workflowApi.downloadAuditScriptTemplate(language)`. Download uses authenticated `fetch`, a `Blob` and a temporary object URL. `AuditScriptSelector` loads global metadata, combines it with built-ins and immediately selects a newly uploaded script. Show the two template download buttons and `<input accept=".py,.js" type="file">` only when `isSuperAdmin`; pass `teacherIdentity?.role === "super_admin"` from `App.tsx` through `AcademicFlowDesigner`.

- [ ] **Step 4: Run frontend tests and commit**

Run: `cd frontend && node --experimental-strip-types --test tests/auditScripts.test.ts tests/flowRevision.test.ts tests/nodeSettingCapabilities.test.ts`

Expected: PASS.

Run: `git add frontend/src/features/academic-flow/auditScripts.ts frontend/src/features/academic-flow/AuditScriptSelector.tsx frontend/src/features/academic-flow/api.ts frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/App.tsx frontend/tests/auditScripts.test.ts && git commit -m "feat: select global audit scripts in file nodes"`

## Task 5: Ignore runtime source and verify integration

**Files:**

- Modify: `.gitignore`
- Create: `backend/scripts/.gitkeep`

- [ ] **Step 1: Add runtime source ignore rules**

```gitignore
# Runtime audit-script sources
backend/scripts/*
!backend/scripts/.gitkeep
```

- [ ] **Step 2: Run full verification**

Run: `cd backend && PYTHONPATH=. ./.venv/bin/pytest -q`

Expected: PASS.

Run: `cd frontend && node --experimental-strip-types --test tests/*.test.ts && npm run build`

Expected: all tests PASS and the Vite production build succeeds.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 3: Verify manually in the browser**

1. A normal teacher sees only the global script selector.
2. A super administrator can download both templates, upload a `.py` file and select it.
3. Published node configuration retains the selected ID, version and hash after reload.
4. `backend/scripts/global/<script_id>/1/manifest.json` exists and `git status` does not show uploaded source.

- [ ] **Step 4: Commit runtime storage setup**

Run: `git add .gitignore backend/scripts/.gitkeep && git commit -m "chore: ignore runtime audit script sources"`

## Plan Self-Review

- Tasks 1–2 cover local storage, templates and role enforcement; Task 3 freezes a selected version; Task 4 supplies UI selection; Task 5 prevents runtime source from entering Git and verifies the end-to-end path.
- Uploaded scripts have `py` or `js` language; `mjs` remains only for existing built-ins.
- Execution, secret injection, sandboxing and OSS script storage are explicitly out of scope.
