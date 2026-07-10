# Dual-Role Authentication and Flow Soft Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add separate teacher/student registration and login experiences, role-based backend sessions, a placeholder forgot-password page, a student account page, and confirmed database-preserving flow archiving.

**Architecture:** Extend the existing student authentication without migrating its foreign keys: add parallel teacher account/session tables and shared security primitives. Protect teacher workflow routes with the teacher session while retaining student session ownership checks. Keep authentication UI in focused components and persist flow list creation/archive through the workflow API.

**Tech Stack:** React 18, TypeScript 5.6, Vite 5, FastAPI, Pydantic, Python 3.11 `sqlite3`, PBKDF2-HMAC-SHA256, pytest.

## Global Constraints

- Teacher identity uses name, employee number, and password.
- Student identity uses name, student number, and password.
- Passwords are never stored in plaintext.
- Forgot password is a UI-only placeholder and performs no write request.
- Student sessions cannot access teacher management APIs.
- Flow deletion is soft deletion: set `flows.status = 'archived'` and retain all related records.
- Every independently testable stage ends with a Git commit.

---

### Task 1: Teacher Accounts and Role-Specific Authentication

**Files:**
- Modify: `backend/app/core/database.py`
- Modify: `backend/app/services/security.py`
- Modify: `backend/app/api/routes/auth.py`
- Test: `backend/tests/test_role_auth.py`

**Interfaces:**
- Produces: `POST /api/auth/teacher/register`, `POST /api/auth/teacher/login`, `GET /api/auth/teacher/me`, `POST /api/auth/teacher/logout`.
- Produces: student-prefixed aliases for the four existing student endpoints.
- Produces: `get_current_teacher()` dependency returning `id`, `employeeNo`, and `name`.

- [ ] **Step 1: Write failing role authentication tests**

```python
def test_teacher_register_login_and_me(client):
    response = client.post("/api/auth/teacher/register", json={
        "name": "教师甲", "employeeNo": "T001", "password": "Pass1234"
    })
    assert response.status_code == 201
    assert client.get("/api/auth/teacher/me").json()["employeeNo"] == "T001"

def test_student_prefixed_login_alias(client):
    payload = {"name": "学生甲", "studentNo": "S001", "password": "Pass1234"}
    assert client.post("/api/auth/student/register", json=payload).status_code == 201
    assert client.get("/api/auth/student/me").json()["studentNo"] == "S001"
```

- [ ] **Step 2: Run tests and confirm missing routes fail**

Run: `cd backend && .venv/bin/python -m pytest tests/test_role_auth.py -q`

Expected: FAIL with 404 responses.

- [ ] **Step 3: Implement teacher schema, sessions, and routes**

Add `teacher_accounts` and `teacher_sessions`. Reuse password hashing while using the distinct `teacher_session` cookie. Add student route aliases without removing compatibility endpoints used by existing share links.

- [ ] **Step 4: Run role authentication and regression tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_role_auth.py tests/test_auth.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app backend/tests/test_role_auth.py
git commit -m "Add teacher and student role authentication"
```

### Task 2: Teacher Authorization and Flow Archiving

**Files:**
- Modify: `backend/app/api/routes/workflows.py`
- Modify: `backend/app/api/routes/workflow_admin.py`
- Modify: `backend/app/repositories/workflows.py`
- Modify: `backend/tests/test_workflows.py`
- Create: `backend/tests/test_flow_archiving.py`

**Interfaces:**
- Consumes: `get_current_teacher()` from Task 1.
- Produces: protected workflow create/save/publish/list/admin routes.
- Produces: idempotent `DELETE /api/workflows/{flow_id}` archive endpoint.
- Produces: `list_flows()` returning only non-archived records.

- [ ] **Step 1: Write failing authorization and archive tests**

```python
def test_student_cannot_create_flow(student_client):
    assert student_client.post("/api/workflows", json={"name": "越权流程"}).status_code == 401

def test_archive_hides_flow_but_retains_version(teacher_client, published_flow, db):
    assert teacher_client.delete(f"/api/workflows/{published_flow['flowId']}").status_code == 204
    assert teacher_client.get("/api/workflows").json() == []
    count = db.execute("SELECT COUNT(*) FROM flow_versions WHERE flow_id = ?", (published_flow["flowId"],)).fetchone()[0]
    assert count == 1
```

- [ ] **Step 2: Run tests and confirm current authorization/archive behavior fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_flow_archiving.py -q`

Expected: FAIL because workflow routes are unprotected and archive endpoint is absent.

- [ ] **Step 3: Add teacher dependencies and soft-delete repository transaction**

Update only `flows.status` and `updated_at`, append an `audit_logs` row, exclude archived rows from lists, and reject draft save/publish when archived. Do not execute SQL `DELETE` against workflow tables.

- [ ] **Step 4: Update existing workflow fixtures to authenticate as a teacher**

Use one helper that registers the teacher before calling protected routes; keep public shared-flow and authenticated student runtime checks unchanged.

- [ ] **Step 5: Run full backend suite and lint**

Run: `cd backend && .venv/bin/python -m pytest -q`

Run: `cd backend && .venv/bin/ruff check app tests`

Expected: all tests pass and lint reports no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/app backend/tests
git commit -m "Protect and archive teacher workflows"
```

### Task 3: Authentication Pages and Role Navigation

**Files:**
- Create: `frontend/src/features/auth/AuthPortal.tsx`
- Create: `frontend/src/features/auth/authApi.ts`
- Create: `frontend/src/features/auth/StudentAccountPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: role authentication endpoints from Task 1.
- Produces: `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/student` routes.
- Produces: teacher guard for management pages and student session account page.

- [ ] **Step 1: Add typed role authentication client**

```ts
export type AuthRole = "student" | "teacher";
export const authApi = {
  login(role: AuthRole, body: RoleCredentials) {
    return request(`/api/auth/${role}/login`, { method: "POST", body: JSON.stringify(body) });
  },
  register(role: AuthRole, body: RoleCredentials) {
    return request(`/api/auth/${role}/register`, { method: "POST", body: JSON.stringify(body) });
  },
};
```

- [ ] **Step 2: Build login and registration portal**

Use a segmented teacher/student selector. Render `工号` for teachers and `学号` for students. Registration includes password confirmation; login links to registration and forgot-password placeholder.

- [ ] **Step 3: Add forgot-password placeholder and student account page**

The placeholder renders only explanatory text and navigation. The student page loads `/api/auth/student/me`, lists joined flow instances, and supports logout.

- [ ] **Step 4: Add route and session guards**

Unauthenticated management routes render the teacher login page. Teacher login returns to the requested management URL. Share-link student authentication continues to return to the flow instance.

- [ ] **Step 5: Build frontend**

Run: `cd frontend && npm run build`

Expected: TypeScript and Vite build succeed.

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "Add teacher and student authentication portal"
```

### Task 4: Persistent Flow List and Confirmed Soft Delete

**Files:**
- Modify: `frontend/src/features/academic-flow/api.ts`
- Modify: `frontend/src/features/home/HomeView.tsx`
- Modify: `frontend/src/features/home/HomeDialogs.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: protected list/create/archive workflow endpoints.
- Produces: database-backed teacher flow list and two-step archive UI.

- [ ] **Step 1: Add list/create/archive API methods**

Map server flow records into `AcademicProcess`, preserving `serverId` and the saved nodes/edges. Create new workflows in the database when the teacher confirms a name.

- [ ] **Step 2: Add a non-propagating delete icon to each flow row**

The icon click calls `event.stopPropagation()` and opens a confirmation dialog containing the exact flow name and the retained-history warning.

- [ ] **Step 3: Archive only after confirmation**

Call `DELETE /api/workflows/{serverId}` and remove the process from frontend state only after a successful response. Cancel closes the dialog without API calls.

- [ ] **Step 4: Build and verify TypeScript**

Run: `cd frontend && npm run build`

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "Add confirmed workflow soft deletion"
```

### Task 5: End-to-End Verification and Documentation

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: reproducible role login, registration, archiving, and local operation documentation.

- [ ] **Step 1: Run backend tests and lint**

Run: `cd backend && .venv/bin/python -m pytest -q`

Run: `cd backend && .venv/bin/ruff check app tests`

- [ ] **Step 2: Run frontend build**

Run: `cd frontend && npm run build`

- [ ] **Step 3: Verify browser flows**

Register and log in as a teacher, create a flow, cancel deletion once, confirm deletion once, and verify it disappears. Register and log in as a student, verify the student page, open forgot-password, and verify it remains a non-writing placeholder. Check desktop/mobile layouts and console warnings/errors.

- [ ] **Step 4: Verify database preservation**

Query the archived flow, its version count, and its student instance count directly from SQLite; confirm the flow status is `archived` and related counts remain unchanged.

- [ ] **Step 5: Update README and commit**

Document the two role routes, registration fields, password placeholder boundary, teacher authorization, and archive semantics.

```bash
git add README.md
git commit -m "Document role authentication and flow archiving"
```

