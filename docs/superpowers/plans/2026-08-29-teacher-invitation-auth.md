# Teacher Invitation Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shared login entry student-first, isolate teacher login, and require a super-admin-issued one-time invitation for every new teacher account.

**Architecture:** Add a dedicated `teacher_invitations` persistence and repository boundary, expose separate public invitation-consumption and super-admin management routes, and close public teacher registration. Keep the existing separate student/teacher account and session models; update the SPA’s route resolver so `/login` is student-first while teacher login and invitation registration use fixed-role pages.

**Tech Stack:** FastAPI, Pydantic, SQLite, React 18, TypeScript, Vite, existing PBKDF2 password and cookie-session services.

**Spec:** `docs/superpowers/specs/2026-08-29-teacher-invitation-auth-design.md`

## Global Constraints

- Existing teacher accounts, student accounts, sessions, flows, instances, submissions, files, and audit history must remain unchanged.
- Teacher employee numbers are exactly five decimal digits: `^\d{5}$`.
- Invitation tokens use `secrets.token_urlsafe(32)`; only SHA-256 hashes are persisted.
- Invitation registration can create only the `teacher` role and must take name and employee number from the invitation row.
- Original invitation tokens are returned once and never persisted in recoverable form or browser storage.
- Do not reuse `share_tokens`; create a separate `teacher_invitations` table and repository.
- Follow the existing white panel, gray border, red error, blue primary-action visual language.
- Do not run automated tests, browser automation, lint, or frontend builds during implementation, per repository instructions. Maintain the test source statically and report that it was not executed.
- Use the current branch. The approved design commit `51e442f` is the implementation checkpoint; do not create intermediate commits. Create one task-scoped result commit after all work is complete.
- Never stage the existing unrelated `.gitignore`, `AGENTS.md`, `README.md`, `docker-compose.yml`, `storage/.gitkeep`, `INSTALL.md`, or `assets/` changes.
- Before any Node.js command, run `export PATH="$PWD/.local/node/bin:$PATH"` from the repository root. No Node.js command is required by this plan.
- Restart backend and frontend locally without Docker only after the result commit, then verify listeners and process working directories for ports `8000` and `5173`.

## File Structure

**Create:**

- `backend/app/repositories/teacher_invitations.py` — invitation lifecycle, transaction boundaries, hashing, account creation, and invitation audit records.
- `backend/app/api/routes/teacher_invitations.py` — super-admin list/create/revoke HTTP contract.
- `frontend/src/features/auth/TeacherInvitationRegistrationPage.tsx` — public token validation and password-setting page.
- `frontend/src/features/auth/teacherInvitationApi.ts` — public invitation API types and requests.
- `frontend/src/features/admin/TeacherInvitationsAdminPage.tsx` — super-admin invitation list, creation form, one-time link result, and revocation.
- `frontend/src/features/admin/teacherInvitationAdminApi.ts` — invitation management API types and requests.
- `backend/tests/teacher_auth_helpers.py` — direct test-account provisioning helper replacing reliance on the removed public teacher-register endpoint.

**Modify:**

- `backend/app/core/database.py` — schema and migration registration.
- `backend/app/api/router.py` — include the new super-admin invitation router.
- `backend/app/api/routes/auth.py` — five-digit teacher login validation, public invitation lookup/accept endpoints, and removal of public teacher registration.
- `frontend/src/types.ts` — add invitation registration and invitation-admin screens.
- `frontend/src/App.tsx` — canonical auth routes, legacy redirects, fixed-role navigation, invitation token routing, and admin-page routing.
- `frontend/src/features/auth/AuthPortal.tsx` — fixed-role form, student-first navigation, and removal of role switching/public teacher registration.
- `frontend/src/features/auth/authApi.ts` — remove generic teacher registration calls while retaining student registration and role-specific login.
- `frontend/src/features/auth/TeacherAccountMenu.tsx` — add a super-admin “教师邀请” action.
- `frontend/src/features/home/HomeView.tsx` — pass the invitation-management navigation callback.
- `frontend/src/features/home/OssMaterialLibraryView.tsx` — pass the invitation-management navigation callback.
- `frontend/src/styles.css` — login-entry, invitation form/list/dialog, state badge, and responsive styles.
- Existing backend auth/workflow/admin test modules that call `/api/auth/teacher/register` — use the shared direct-provisioning helper and five-digit fixtures.
- `backend/tests/test_role_auth.py` and `backend/tests/test_database_admin.py` — define the invitation security contract and adapt admin setup.

---

### Task 1: Add the Invitation Schema and Repository

**Files:**

- Modify: `backend/app/core/database.py`
- Create: `backend/app/repositories/teacher_invitations.py`

**Interfaces:**

- Produces `TeacherInvitationError`, `create_teacher_invitation()`, `list_teacher_invitations()`, `get_teacher_invitation()`, `accept_teacher_invitation()`, and `revoke_teacher_invitation()` for Tasks 2 and 3.
- Consumes `get_connection()`, `hash_password()`, `utc_now_iso()`, and the existing `audit_logs` table.

- [ ] **Step 1: Add the table to the base schema**

Add the following shape after `teacher_sessions` so fresh databases receive it without a migration-only dependency:

```sql
CREATE TABLE IF NOT EXISTS teacher_invitations (
    id TEXT PRIMARY KEY,
    employee_no TEXT NOT NULL CHECK (length(employee_no) = 5 AND employee_no NOT GLOB '*[^0-9]*'),
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'used', 'expired', 'revoked')),
    expires_at TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    used_by_teacher_id INTEGER REFERENCES teacher_accounts(id) ON DELETE SET NULL,
    used_at TEXT,
    revoked_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_invitations_active_employee
ON teacher_invitations(employee_no)
WHERE status = 'active';
```

- [ ] **Step 2: Add an idempotent migration call**

Add `_apply_teacher_invitation_migration(connection)` to `initialize_database()` after the teacher-role migration. Its body executes the same `CREATE TABLE IF NOT EXISTS` and `CREATE UNIQUE INDEX IF NOT EXISTS`, then records migration ID `20260829_add_teacher_invitations` with `INSERT OR IGNORE`.

- [ ] **Step 3: Define repository result and error types**

Use explicit types so routes do not infer database rows:

```python
class TeacherInvitationError(ValueError):
    pass


def create_teacher_invitation(
    *, name: str, employee_no: str, expires_at: str, actor_id: int
) -> dict[str, object]: ...

def list_teacher_invitations() -> list[dict[str, object]]: ...
def get_teacher_invitation(token: str) -> dict[str, object]: ...
def accept_teacher_invitation(*, token: str, password: str) -> dict[str, object]: ...
def revoke_teacher_invitation(*, invitation_id: str, actor_id: int) -> dict[str, object]: ...
```

Public dictionary keys must be camelCase: `id`, `employeeNo`, `name`, `status`, `expiresAt`, `createdAt`, `usedAt`, `revokedAt`, and `token` only in the create result.

- [ ] **Step 4: Implement invitation creation**

Normalize `name.strip()` and `employee_no.strip()`, reject non-matching `re.fullmatch(r"\d{5}", employee_no)`, parse the ISO expiry as an aware UTC datetime, and require it to be later than `utc_now()`.

Within `BEGIN IMMEDIATE`:

1. Update naturally expired active rows to `expired`.
2. Reject an existing `teacher_accounts.employee_no` with `TeacherInvitationError("该工号已存在教师账号")`.
3. Reject an active invitation with `TeacherInvitationError("该工号已有待注册邀请")`.
4. Generate a UUID invitation ID and `secrets.token_urlsafe(32)` token.
5. Persist only `hashlib.sha256(token.encode("utf-8")).hexdigest()`.
6. Insert an `audit_logs` row with action `teacher_invitation_created`, entity type `teacher_invitation`, and redacted metadata containing name, employee number, and expiry but no token or hash.

Return the original token only from this call.

- [ ] **Step 5: Implement list, resolve, accept, and revoke**

Before list or resolve, normalize expired active rows using the server timestamp. Resolve by token hash and return the same `TeacherInvitationError("邀请链接无效或已失效")` for missing, non-active, or expired rows.

`accept_teacher_invitation()` must use `BEGIN IMMEDIATE`, re-read the invitation, create a `teacher_accounts` row with role `teacher`, mark the invitation `used`, populate `used_by_teacher_id` and `used_at`, and insert `teacher_invitation_used` audit data in the same transaction. Do not accept name, employee number, or role as parameters.

`revoke_teacher_invitation()` must change only an active, unexpired row to `revoked`, populate `revoked_at`, and write `teacher_invitation_revoked`; every other state returns `TeacherInvitationError("该邀请已失效，不能撤销")`.

- [ ] **Step 6: Perform a static repository audit**

Read the complete new repository and verify all five lifecycle transitions are explicit: create, natural expiry, resolve, use, and revoke. Confirm no SQL statement persists the original token and every account-creation path fixes `role = 'teacher'`.

### Task 2: Expose Super-Admin Invitation Management APIs

**Files:**

- Create: `backend/app/api/routes/teacher_invitations.py`
- Modify: `backend/app/api/router.py`

**Interfaces:**

- Consumes repository functions from Task 1.
- Produces `GET/POST /api/admin/teacher-invitations` and `POST /api/admin/teacher-invitations/{id}/revoke` for Task 5.

- [ ] **Step 1: Define request models**

```python
class CreateTeacherInvitationRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    employeeNo: str = Field(pattern=r"^\d{5}$")
    expiresAt: datetime
```

Use an `APIRouter(dependencies=[Depends(get_current_super_admin)])` so every endpoint has the same server-side authorization boundary.

- [ ] **Step 2: Add list, create, and revoke handlers**

Map repository errors to `422` for invalid input/state and preserve a compact response shape. Creation returns status `201`; revocation and listing return `200`.

```python
@router.get("")
def list_invitations() -> list[dict[str, object]]: ...

@router.post("", status_code=status.HTTP_201_CREATED)
def create_invitation(payload: CreateTeacherInvitationRequest, admin=Depends(get_current_super_admin)): ...

@router.post("/{invitation_id}/revoke")
def revoke_invitation(invitation_id: str, admin=Depends(get_current_super_admin)): ...
```

- [ ] **Step 3: Register the router**

Import `teacher_invitations` in `backend/app/api/router.py` and include it at prefix `/admin/teacher-invitations` with tag `teacher-invitations`.

- [ ] **Step 4: Audit authorization placement**

Confirm no invitation-management function is reachable through `database_admin.router` or an unauthenticated route, and both router-level and actor-specific dependencies use `get_current_super_admin`.

### Task 3: Replace Public Teacher Registration with Invitation Acceptance

**Files:**

- Modify: `backend/app/api/routes/auth.py`

**Interfaces:**

- Consumes `get_teacher_invitation()` and `accept_teacher_invitation()` from Task 1.
- Produces public lookup and accept endpoints used by `teacherInvitationApi.ts` in Task 4.

- [ ] **Step 1: Split teacher login and invitation payload models**

Replace the broad shared teacher model with:

```python
class TeacherLoginCredentials(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    employeeNo: str = Field(pattern=r"^\d{5}$")
    password: str = Field(min_length=8, max_length=128)


class TeacherInvitationAcceptance(BaseModel):
    password: str = Field(min_length=8, max_length=128)
```

Keep student models unchanged.

- [ ] **Step 2: Remove the unrestricted teacher registration handler**

Delete the `@router.post("/teacher/register")` handler and its direct `INSERT INTO teacher_accounts`. Do not leave a hidden alias that accepts the old payload.

- [ ] **Step 3: Add public invitation lookup and acceptance**

```python
@router.get("/teacher-invitations/{token}")
def teacher_invitation(token: str) -> dict[str, object]: ...

@router.post("/teacher-invitations/{token}/accept", status_code=status.HTTP_201_CREATED)
def accept_invitation(token: str, payload: TeacherInvitationAcceptance, response: Response) -> dict[str, object]: ...
```

Both handlers map every invalid/expired/used/revoked token to the same `404` detail `邀请链接无效或已失效`. Acceptance calls `create_teacher_session()` only after the repository transaction succeeds, sets the existing HttpOnly teacher cookie, and returns `id`, `employeeNo`, `name`, and `role`.

- [ ] **Step 4: Keep login compatible for existing accounts**

Update `login_teacher()` to use `TeacherLoginCredentials`; keep its name/password comparison, active-account filter, response, and Session Cookie unchanged. Existing valid five-digit teacher accounts continue to log in.

- [ ] **Step 5: Audit the complete teacher account creation surface**

Use `rg -n "INSERT INTO teacher_accounts|teacher/register" backend/app` and confirm the only runtime account insertion is inside `accept_teacher_invitation()`, and no public endpoint can select `super_admin`.

### Task 4: Make Authentication Routes Student-First and Fixed-Role

**Files:**

- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/features/auth/AuthPortal.tsx`
- Modify: `frontend/src/features/auth/authApi.ts`
- Create: `frontend/src/features/auth/TeacherInvitationRegistrationPage.tsx`
- Create: `frontend/src/features/auth/teacherInvitationApi.ts`
- Modify: `frontend/src/styles.css`

**Interfaces:**

- Consumes public auth endpoints from Task 3.
- Produces canonical routes `/login`, `/student/register`, `/teacher/login`, and `/teacher/invitations/:token`.

- [ ] **Step 1: Add route state for invitation registration**

Add `teacherInvitation` to `Screen` and extend `getRouteFromPathname()` to return `teacherInvitationToken`. Match `/teacher/invitations/([^/]+)` before generic academic-flow matching.

Canonical mappings:

```text
/login                         -> authLogin, student
/student/register              -> authRegister, student
/teacher/login                 -> authLogin, teacher
/teacher/invitations/:token    -> teacherInvitation, teacher
```

Legacy mappings must use `history.replaceState`, not add another back-button entry:

```text
/auth/login?role=teacher       -> /teacher/login
/auth/login?role=student       -> /login
/auth/login                    -> /login
/auth/register?role=student    -> /student/register
/auth/register?role=teacher    -> /teacher/login
```

When an unauthenticated visitor reaches a teacher-protected screen through `/`, `/academic-flow`, or `/admin/*`, send them to `/teacher/login`; the general `/login` remains the user-facing default entry.

- [ ] **Step 2: Make `AuthPortal` role immutable**

Rename `initialRole` to `role`, delete internal role state, `changeRole()`, and the teacher/student tab list. Keep shared account-history and form markup.

Navigation contract:

```ts
onNavigate: (mode: "forgot" | "login" | "register", role: AuthRole) => void;
```

For `role === "student"`, show student registration and forgot-password links plus a separate low-emphasis button `教职工用户？教师登录 ›`. For `role === "teacher"`, hide registration and show `返回学生登录`; keep teacher forgot-password placeholder if currently available.

The submit branch must call `authApi.registerStudent(credentials)` only for student registration. Teacher mode never renders a registration form.

- [ ] **Step 3: Narrow the generic auth API**

Replace `register(role, credentials)` with:

```ts
registerStudent(credentials: RoleCredentials): Promise<AuthIdentity>
login(role: AuthRole, credentials: RoleCredentials): Promise<AuthIdentity>
```

`registerStudent()` posts only to `/api/auth/student/register`; no frontend function constructs `/api/auth/teacher/register`.

- [ ] **Step 4: Add the public invitation API and page**

Define:

```ts
export type TeacherInvitationSummary = {
  employeeNo: string;
  expiresAt: string;
  name: string;
};

getTeacherInvitation(token: string): Promise<TeacherInvitationSummary>
acceptTeacherInvitation(token: string, password: string): Promise<AuthIdentity>
```

The page loads invitation metadata once, renders name and employee number as read-only values, validates two matching passwords of at least eight characters, calls acceptance, then invokes `onAuthenticated(identity)` so App stores the teacher identity and opens `/academic-flow`.

Do not store the token in localStorage, sessionStorage, remembered-account history, or component state beyond the route-derived prop.

- [ ] **Step 5: Add focused authentication styles**

Reuse `.role-auth-*`; remove obsolete `.role-segment` layout if it has no other consumers. Add focused selectors for `.teacher-login-entry`, `.auth-back-link`, `.teacher-invitation-identity`, and invitation invalid/loading states. The teacher entry is visually subordinate to the student primary button and remains keyboard accessible.

- [ ] **Step 6: Statically trace every auth navigation**

Read `getRouteFromPathname()`, `navigateAuth()`, protected-screen gates, logout handlers, and legacy redirects as one call chain. Confirm student logout returns `/login`, teacher logout returns `/teacher/login`, and invitation success returns `/academic-flow`.

### Task 5: Add the Super-Admin Teacher Invitation Page

**Files:**

- Create: `frontend/src/features/admin/teacherInvitationAdminApi.ts`
- Create: `frontend/src/features/admin/TeacherInvitationsAdminPage.tsx`
- Modify: `frontend/src/features/auth/TeacherAccountMenu.tsx`
- Modify: `frontend/src/features/home/HomeView.tsx`
- Modify: `frontend/src/features/home/OssMaterialLibraryView.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/styles.css`

**Interfaces:**

- Consumes super-admin endpoints from Task 2.
- Produces `/admin/teacher-invitations` and a super-admin account-menu action.

- [ ] **Step 1: Define admin invitation API types**

```ts
export type TeacherInvitationStatus = "active" | "used" | "expired" | "revoked";

export type TeacherInvitationRecord = {
  createdAt: string;
  employeeNo: string;
  expiresAt: string;
  id: string;
  name: string;
  revokedAt: string | null;
  status: TeacherInvitationStatus;
  usedAt: string | null;
};

export type CreatedTeacherInvitation = TeacherInvitationRecord & { token: string };
```

Expose `listTeacherInvitations()`, `createTeacherInvitation({name, employeeNo, expiresAt})`, and `revokeTeacherInvitation(id)` with `credentials: "include"` and the existing JSON error convention.

- [ ] **Step 2: Build the invitation management page**

Require `identity.role === "super_admin"` at render time as a UI guard while retaining the API’s backend guard. Provide:

- a header with “教师邀请” and “返回首页”;
- a primary “生成邀请” action;
- a compact table with name, employee number, status, creation time, expiry, and action;
- status labels `待注册`, `已注册`, `已过期`, `已撤销`;
- revoke only for `active` invitations;
- empty, loading, success, and red error states.

The creation dialog accepts name, exactly five digits, and an expiry defaulting to 24 hours from the browser’s current time. After creation, assemble the link with:

```ts
const inviteUrl = `${window.location.origin}/teacher/invitations/${created.token}`;
```

Show it in a one-time result panel with a copy button. Never persist it. Closing the panel discards the token value; the list record remains without `token`.

- [ ] **Step 3: Add navigation from the super-admin account menu**

Add `onTeacherInvitations` beside `onDatabaseAdmin` in `TeacherAccountMenu`. Render the action only for `super_admin`; thread the callback through `HomeView` and `OssMaterialLibraryView`.

In App, add `teacherInvitationsAdmin` to `Screen`, route `/admin/teacher-invitations`, add it to `teacherScreens`, implement `openTeacherInvitationsAdmin()`, and render `TeacherInvitationsAdminPage` with `onBack={openHome}`.

- [ ] **Step 4: Add responsive styles without changing the design system**

Use existing admin header, panel, input, button, dialog backdrop, and message patterns. On narrow screens, stack the creation fields and allow horizontal scrolling only inside the invitation table; do not add a new navigation sidebar.

- [ ] **Step 5: Audit plaintext token handling**

Use `rg -n "token|localStorage|sessionStorage" frontend/src/features/admin/TeacherInvitationsAdminPage.tsx frontend/src/features/admin/teacherInvitationAdminApi.ts` and confirm the token is present only in the create response, local result state, rendered copy field, and invitation URL assembly.

### Task 6: Update Authentication Test Sources Without Executing Them

**Files:**

- Create: `backend/tests/teacher_auth_helpers.py`
- Modify: `backend/tests/test_role_auth.py`
- Modify: `backend/tests/test_database_admin.py`
- Modify: every existing backend test module reported by `rg -l 'api/auth/teacher/register' backend/tests`

**Interfaces:**

- Produces reusable `provision_teacher()` and `login_teacher()` helpers for existing test modules.
- Consumes the database schema and password hashing service; does not expose a runtime application endpoint.

- [ ] **Step 1: Add a direct test provisioning helper**

```python
def provision_teacher(
    *, employee_no: str, name: str = "管理教师",
    password: str = "Pass1234", role: str = "teacher"
) -> None:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO teacher_accounts
                (employee_no, name, password_hash, role, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (employee_no, name, hash_password(password), role, now, now),
        )


def login_teacher(client: TestClient, *, employee_no: str, name: str = "管理教师", password: str = "Pass1234") -> None:
    response = client.post(
        "/api/auth/teacher/login",
        json={"name": name, "employeeNo": employee_no, "password": password},
    )
    assert response.status_code == 200
```

Use five-digit fixtures such as `10001`, `10002`, and `10003`; remove legacy `T001`, `A100`, and `ADMIN001` values that violate the new login model.

- [ ] **Step 2: Replace setup calls in unrelated workflow tests**

For each file returned by `rg -l 'api/auth/teacher/register' backend/tests`, replace public-registration setup with `provision_teacher(...)` followed by `login_teacher(...)`. Preserve the original role, name, cookies, and test intent.

- [ ] **Step 3: Rewrite role-auth tests around the invitation contract**

Cover source-level cases for:

- `POST /api/auth/teacher/register` no longer exists;
- a five-digit existing teacher can log in;
- malformed employee numbers fail model validation;
- a valid invitation returns bound identity metadata;
- acceptance creates exactly one ordinary teacher and a teacher Session;
- reuse, expiry, and revocation return the same invalid-link detail;
- simultaneous logical reuse is prevented by status and transaction checks.

- [ ] **Step 4: Add super-admin invitation source cases**

In `test_database_admin.py`, provision a five-digit `super_admin`, then describe cases for create/list/revoke, regular-teacher `403`, duplicate employee number, duplicate active invitation, and absence of token/hash in the list response.

- [ ] **Step 5: Perform static test-source consistency checks**

Run only text checks, not pytest:

```bash
rg -n "api/auth/teacher/register|employeeNo.*[A-Za-z]" backend/tests
rg -n "teacher-invitations" backend/tests/test_role_auth.py backend/tests/test_database_admin.py
```

Expected: the old endpoint appears only in the explicit “route is closed” assertion; all login fixtures use five digits; invitation cases are present.

### Task 7: Final Static Audit, Result Commit, and Local Restart

**Files:**

- Review all task-scoped files above.
- Do not modify unrelated working-tree files.

**Interfaces:**

- Consumes all previous tasks.
- Produces one auditable result commit and running local services.

- [ ] **Step 1: Check formatting and accidental scope**

Run:

```bash
git diff --check
git status --short
```

Inspect the status manually and build an explicit task-file staging list. Do not use `git add .` or `git add -A`.

- [ ] **Step 2: Trace backend security invariants**

Run read-only searches:

```bash
rg -n "teacher/register|INSERT INTO teacher_accounts|super_admin|token_hash|token_value" backend/app
rg -n "get_current_super_admin|teacher-invitations" backend/app/api
```

Expected: no public teacher register handler; only invitation acceptance inserts teacher accounts; role is fixed to `teacher`; admin management routes require `get_current_super_admin`; no recoverable invitation token column exists.

- [ ] **Step 3: Trace frontend navigation and token handling**

Run:

```bash
rg -n "role-segment|teacher/register|auth/register.*teacher|localStorage|sessionStorage|teacher/invitations|teacher/login" frontend/src
```

Inspect every match. Expected: no role-switch UI, no teacher-register call, no invitation token persistence, and all canonical/legacy routes resolve as specified.

- [ ] **Step 4: Clean only permitted caches**

Locate `.pytest_cache`, `__pycache__`, and `*.egg-info` generated inside this repository during the task. Remove only confirmed task-generated cache paths; do not remove source, assets, storage, `node_modules`, or unrelated build artifacts.

- [ ] **Step 5: Create the single result checkpoint**

Stage only the files enumerated by this plan and commit:

```bash
git commit -m "feat: require invitations for teacher registration"
```

Record the commit hash. Confirm the unrelated working-tree entries remain uncommitted.

- [ ] **Step 6: Restart the backend locally**

Stop only the confirmed backend processes whose working directory is `/ai/github-repo/moyin/backend`, then start:

```bash
cd /ai/github-repo/moyin/backend
./.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- [ ] **Step 7: Restart the frontend locally**

Stop only the confirmed frontend process whose working directory is `/ai/github-repo/moyin/frontend`, then start:

```bash
cd /ai/github-repo/moyin
export PATH="$PWD/.local/node/bin:$PATH"
cd frontend
npm run dev -- --host 0.0.0.0
```

- [ ] **Step 8: Verify process state without browser or HTTP checks**

Use `lsof -nP -iTCP:8000 -sTCP:LISTEN` and `lsof -nP -iTCP:5173 -sTCP:LISTEN`, then inspect `/proc/<pid>/cwd` and command lines. Report the frontend URL `http://localhost:5173/`, commit hash, static audit results, tests not run, and preserved unrelated changes.
