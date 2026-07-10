# OA Workflow V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a persistent first version in which teachers publish the existing DAG designer, students register or sign in through the shared high-entropy URL, and each student has independently tracked node progress.

**Architecture:** Keep the current React/Vite designer and FastAPI service, add a focused SQLite repository using the Python standard library, and expose typed workflow/auth endpoints. Published flow snapshots are immutable; mutable deadlines and per-student runtime state are stored separately. Frontend API and workflow modules isolate server contracts from the existing canvas implementation.

**Tech Stack:** React 18, TypeScript 5.6, Vite 5, FastAPI, Pydantic, Python 3.11 `sqlite3`, PBKDF2-HMAC-SHA256, pytest.

## Global Constraints

- Published node structure, edges, fields, attachment rules, and audit rules are immutable.
- Published node deadlines remain mutable and are audited.
- One student has one flow instance per published version.
- Anonymous shared-link access must redirect to registration or sign-in before instance creation.
- Expired nodes reject submission; per-student deadline overrides take precedence over the global node deadline.
- Runtime code must remain modular because configuration and state rules are expected to change frequently.
- The first version supports form, announcement, confirmation, and file-metadata submission; binary object-storage upload remains outside this iteration.

---

### Task 1: Persistent Store and Authentication

**Files:**
- Create: `backend/app/core/database.py`
- Create: `backend/app/services/security.py`
- Modify: `backend/app/core/config.py`
- Modify: `backend/app/main.py`
- Replace: `backend/app/api/routes/auth.py`
- Test: `backend/tests/test_auth.py`

**Interfaces:**
- Produces: `get_connection()`, `initialize_database()`, `hash_password()`, `verify_password()`, `create_session_token()`, `get_current_student()`.
- Stores: `student_accounts`, `student_sessions`, and `audit_logs`.

- [ ] **Step 1: Write failing authentication tests**

```python
def test_register_login_and_me(client):
    registered = client.post("/api/auth/register", json={
        "name": "张三", "studentNo": "20260001", "password": "Pass1234"
    })
    assert registered.status_code == 201
    assert client.get("/api/auth/me").json()["studentNo"] == "20260001"

def test_duplicate_student_number_is_rejected(client):
    payload = {"name": "张三", "studentNo": "20260001", "password": "Pass1234"}
    client.post("/api/auth/register", json=payload)
    assert client.post("/api/auth/register", json=payload).status_code == 409
```

- [ ] **Step 2: Run tests and verify failure**

Run: `cd backend && .venv/bin/pytest tests/test_auth.py -q`

Expected: FAIL because registration, session middleware, and database schema do not exist.

- [ ] **Step 3: Implement SQLite lifecycle and cookie authentication**

Use `sqlite3.Row`, foreign keys, WAL mode, PBKDF2 with a random 16-byte salt, and a random 32-byte session token whose SHA-256 digest is stored. Set the `oa_session` cookie as `HttpOnly`, `SameSite=Lax`, and `Secure` only when `APP_ENV=production`.

- [ ] **Step 4: Run authentication tests**

Run: `cd backend && .venv/bin/pytest tests/test_auth.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app backend/tests/test_auth.py
git commit -m "Implement persistent student authentication"
```

### Task 2: Flow Draft, Publication, and Share Tokens

**Files:**
- Create: `backend/app/domain/workflow.py`
- Create: `backend/app/repositories/workflows.py`
- Create: `backend/app/api/routes/workflows.py`
- Modify: `backend/app/api/router.py`
- Test: `backend/tests/test_workflows.py`

**Interfaces:**
- Consumes: `get_connection()` and `audit_logs` from Task 1.
- Produces: `validate_flow_config(config)`, `POST /api/workflows`, `PUT /api/workflows/{id}/draft`, `POST /api/workflows/{id}/publish`, `GET /api/shared-flows/{token}`.

- [ ] **Step 1: Write failing publication tests**

```python
def test_publish_returns_share_url_and_immutable_snapshot(client):
    flow = client.post("/api/workflows", json={"name": "报销流程"}).json()
    config = {"nodes": [{"id": "n1", "kind": "form", "title": "信息"}], "edges": []}
    client.put(f"/api/workflows/{flow['id']}/draft", json={"config": config})
    published = client.post(f"/api/workflows/{flow['id']}/publish").json()
    assert published["shareUrl"].startswith("/s/")
    assert published["versionNo"] == 1

def test_cycle_is_rejected(client):
    config = {
        "nodes": [{"id": "a"}, {"id": "b"}],
        "edges": [{"source": "a", "target": "b"}, {"source": "b", "target": "a"}],
    }
    response = client.post("/api/workflows/validate", json={"config": config})
    assert response.status_code == 422
```

- [ ] **Step 2: Run tests and verify failure**

Run: `cd backend && .venv/bin/pytest tests/test_workflows.py -q`

Expected: FAIL because workflow routes do not exist.

- [ ] **Step 3: Implement workflow repository and DAG validation**

Persist `flows`, `flow_versions`, `flow_node_runtime_configs`, and `share_tokens`. Canonicalize JSON before calculating `config_hash`; generate share tokens with `secrets.token_urlsafe(32)` and store only SHA-256 digests.

- [ ] **Step 4: Run workflow tests**

Run: `cd backend && .venv/bin/pytest tests/test_workflows.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app backend/tests/test_workflows.py
git commit -m "Add versioned OA workflow publishing"
```

### Task 3: Student Instances and Node Runtime

**Files:**
- Create: `backend/app/domain/workflow_runtime.py`
- Create: `backend/app/repositories/flow_instances.py`
- Create: `backend/app/api/routes/student_flows.py`
- Create: `backend/app/api/routes/workflow_admin.py`
- Modify: `backend/app/api/router.py`
- Test: `backend/tests/test_flow_runtime.py`

**Interfaces:**
- Consumes: authenticated student, published flow snapshot, runtime deadlines.
- Produces: `get_or_create_instance()`, `advance_instance()`, student instance/detail/draft/submit endpoints, teacher progress and deadline endpoints.

- [ ] **Step 1: Write failing runtime tests**

```python
def test_students_share_definition_but_not_progress(published_flow, student_clients):
    first = student_clients[0].post(f"/api/student/shared/{published_flow['token']}/enter").json()
    second = student_clients[1].post(f"/api/student/shared/{published_flow['token']}/enter").json()
    assert first["flowVersionId"] == second["flowVersionId"]
    assert first["id"] != second["id"]

def test_expired_node_rejects_submit_and_override_reopens(client, teacher_client):
    response = client.post("/api/student/node-instances/node-id/submit", json={"payload": {}})
    assert response.status_code == 422
    teacher_client.put("/api/workflow-admin/instances/instance-id/nodes/n1/deadline", json={
        "deadlineAt": "2026-08-01T00:00:00Z", "reason": "批准延期"
    })
    assert client.post("/api/student/node-instances/node-id/submit", json={"payload": {}}).status_code == 200
```

- [ ] **Step 2: Run tests and verify failure**

Run: `cd backend && .venv/bin/pytest tests/test_flow_runtime.py -q`

Expected: FAIL because runtime tables and routes do not exist.

- [ ] **Step 3: Implement runtime state machine**

Create `flow_instances`, `node_instances`, `node_drafts`, `submissions`, and `student_deadline_overrides`. Determine root nodes from edge indegree, open roots on instance creation, and open a downstream node only when every incoming predecessor is approved. Use database transactions and unique constraints for idempotency.

- [ ] **Step 4: Run runtime tests**

Run: `cd backend && .venv/bin/pytest tests/test_flow_runtime.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app backend/tests/test_flow_runtime.py
git commit -m "Track per-student OA workflow progress"
```

### Task 4: Frontend API Boundary and Student Access

**Files:**
- Create: `frontend/src/features/academic-flow/api.ts`
- Create: `frontend/src/features/academic-flow/runtimeTypes.ts`
- Create: `frontend/src/features/academic-flow/StudentRuntimePage.tsx`
- Create: `frontend/src/features/auth/StudentAccessGate.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: Tasks 1-3 JSON endpoints with `credentials: "include"`.
- Produces: `workflowApi`, `/s/{token}` route, registration/sign-in gate, runtime node forms, publish/share dialog, and teacher progress panel.

- [ ] **Step 1: Add typed API client**

```ts
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "include" });
  if (!response.ok) throw new ApiError(response.status, await response.json());
  return response.json() as Promise<T>;
}
```

- [ ] **Step 2: Wire designer save and publish**

Create the server workflow lazily, save the current nodes/edges as draft configuration, publish it, then display and navigate to the returned `/s/{token}` URL. Disable structural controls when viewing a published version, while retaining deadline controls in the tracking view.

- [ ] **Step 3: Implement shared-link access gate**

At `/s/{token}`, call `/api/auth/me`; render register and sign-in tabs when unauthenticated. After authentication, call `/api/student/shared/{token}/enter` and replace the URL with `/student/flows/{instanceId}`.

- [ ] **Step 4: Implement student runtime page and tracking panel**

Render nodes from the published snapshot and state from `nodeInstances`. Available form nodes support dynamic text fields and draft/submit; announcement and confirmation nodes support acknowledgement; file nodes accept file metadata in V1. Render locked, expired, reviewing, rejected, and approved states without mutating the shared definition.

- [ ] **Step 5: Build frontend**

Run: `cd frontend && npm run build`

Expected: TypeScript and Vite build complete without errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src frontend/vite.config.ts
git commit -m "Connect OA designer to student workflow runtime"
```

### Task 5: Verification and Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/04_oa_workflow_runtime_design.md` only if implementation details require an explicit correction.

**Interfaces:**
- Consumes: completed backend and frontend.
- Produces: reproducible local startup and verified end-to-end workflow.

- [ ] **Step 1: Run backend suite**

Run: `cd backend && .venv/bin/pytest -q`

Expected: all tests pass.

- [ ] **Step 2: Run backend lint**

Run: `cd backend && .venv/bin/ruff check app tests`

Expected: no lint errors.

- [ ] **Step 3: Run frontend build**

Run: `cd frontend && npm run build`

Expected: build succeeds.

- [ ] **Step 4: Verify browser workflow**

Start FastAPI on port 8000 and Vite on port 5173. Create a flow, add and connect nodes, publish, open the shared URL in a signed-out context, register, submit a root node, and verify that the teacher progress endpoint reports the student's updated state.

- [ ] **Step 5: Document startup and V1 boundary**

Document the SQLite database path, both startup commands, shared-link workflow, registration requirement, and the V1 file-metadata boundary.

- [ ] **Step 6: Commit**

```bash
git add README.md docs
git commit -m "Document OA workflow V1 operation"
```

