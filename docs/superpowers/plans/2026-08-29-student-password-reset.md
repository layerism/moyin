# 学生密码重置与强制改密实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许超级管理员把普通学生账号密码重置为临时密码 `123`，立即失效该学生全部旧会话，并要求学生先设置至少 8 位的新密码，再恢复对原有流程数据的访问。

**Architecture:** 在 `student_accounts` 上增加持久化的 `must_change_password` 权限事实；学生会话解析分为“已认证身份”和“可访问业务的正式学生”两层。管理员通过独立事务重置密码，学生通过独立事务修改密码并轮换会话；两个学生入口复用同一改密表单，且所有流程数据继续关联原 `student_accounts.id`。

**Tech Stack:** FastAPI、Pydantic、SQLite、PBKDF2-SHA256、React 18、TypeScript、Vite。

**Spec:** `docs/superpowers/specs/2026-08-29-student-password-reset-design.md`

## Global Constraints

- 临时密码固定为 `123`；新密码长度为 `8..128`，且不得仍为 `123`。
- 学生登录密码长度为 `3..128`；学生注册和教师注册/登录仍为 `8..128`。
- `must_change_password` 是服务端唯一权限事实，不把待改密权限状态写入 Cookie 或本地存储。
- 待改密学生仅可调用学生 `/me`、`/change-password` 和 `/logout`；所有学生业务接口继续由后端拒绝。
- 只允许删除目标学生的 `student_sessions`；不得更新、删除或重建流程实例、节点状态、草稿、提交、成绩、文件或审核数据。
- 不开放 `password_hash` 的通用数据库编辑能力，不在响应、日志或审计中记录 `123`、新密码或密码哈希。
- 预览学生账号不得重置，教师认证规则和预览运行链路不得受影响。
- 本任务在当前分支内实施，不创建 worktree；按项目约束不启动 subagent。
- 按项目 `AGENTS.md`，实施中不运行测试、不运行前端构建、不使用浏览器插件，只做静态业务逻辑审计并明确验证边界。
- 项目只允许实施前和完成后各一次任务范围提交；任务中间不提交，且不得夹带现有无关工作树改动。
- Node.js 命令如确有需要，必须先在项目根目录执行 `export PATH="$PWD/.local/node/bin:$PATH"`；本计划不安排 Node.js 命令。

---

## File Map

### Backend

- Modify `backend/app/core/database.py`: 新建账号字段和幂等迁移。
- Modify `backend/app/services/security.py`: 可复用的会话插入函数、待改密身份解析、正式学生访问门禁。
- Modify `backend/app/api/routes/auth.py`: 拆分学生登录/注册请求模型，返回待改密状态，增加改密事务。
- Modify `backend/app/repositories/database_admin.py`: 超级管理员专用学生密码重置事务与脱敏审计。
- Modify `backend/app/api/routes/database_admin.py`: 专用重置接口及错误映射。

### Frontend

- Modify `frontend/src/features/auth/authApi.ts`: 学生身份字段和修改密码请求。
- Create `frontend/src/features/auth/StudentPasswordChangeForm.tsx`: 两个学生入口共用的强制改密表单。
- Modify `frontend/src/features/auth/AuthPortal.tsx`: 仅放宽学生登录到 3 位，保留注册和教师 8 位规则。
- Modify `frontend/src/features/auth/StudentAccessGate.tsx`: 分享入口识别待改密状态，改密前不进入流程。
- Modify `frontend/src/features/academic-flow/api.ts`: 移除只为分享登录存在的重复认证 API。
- Modify `frontend/src/features/academic-flow/runtimeTypes.ts`: 移除随重复认证 API 一并失去用途的 `StudentIdentity`。
- Modify `frontend/src/App.tsx`: 增加 `/student/change-password` 路由、刷新恢复和首页入口分发。
- Modify `frontend/src/types.ts`: 增加 `studentChangePassword` 屏幕类型。
- Modify `frontend/src/features/admin/databaseAdminApi.ts`: 管理员重置密码请求。
- Modify `frontend/src/features/admin/DatabaseAdminPage.tsx`: 普通学生专用按钮、确认弹窗、原因和刷新逻辑。
- Modify `frontend/src/styles.css`: 沿用现有白色面板、灰色边框、蓝色主按钮和红色警示语义。

### Documentation

- Modify `docs/superpowers/specs/2026-08-29-student-password-reset-design.md`: 将规格状态更新为已确认。
- Create `docs/superpowers/plans/2026-08-29-student-password-reset.md`: 本实施计划。

---

### Task 1: Persist the Password-Change Requirement and Split Student Authorization

**Files:**

- Modify: `backend/app/core/database.py:16-27,371-380,382-613`
- Modify: `backend/app/services/security.py:1-180`

**Interfaces:**

- Produces: `must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1))`.
- Produces: `create_student_session(connection: sqlite3.Connection, student_account_id: int) -> str`.
- Produces: `get_authenticated_student(oa_session: str | None = Cookie(default=None)) -> dict[str, object]`.
- Preserves: `get_current_student(...)` as the dependency used by formal student business routes.
- Preserves: teacher dependencies and preview-token behavior.

- [ ] **Step 1: Add the field to new databases and add an idempotent migration for existing databases**

Add the column to the `student_accounts` definition:

```sql
must_change_password INTEGER NOT NULL DEFAULT 0
    CHECK (must_change_password IN (0, 1)),
```

Call a new migration from `initialize_database()` and implement it with the established `PRAGMA table_info` pattern:

```python
def _apply_student_password_change_migration(connection: sqlite3.Connection) -> None:
    migration_id = "20260829_add_student_password_change_requirement"
    columns = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(student_accounts)").fetchall()
    }
    if "must_change_password" not in columns:
        connection.execute(
            """
            ALTER TABLE student_accounts
            ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0
            CHECK (must_change_password IN (0, 1))
            """
        )
    connection.execute(
        "INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)",
        (migration_id, datetime.now(UTC).isoformat()),
    )
```

Existing normal and preview accounts therefore remain at `0`; no account or flow record is rebuilt.

- [ ] **Step 2: Extract session insertion so password change can rotate the session inside one transaction**

Add `sqlite3` to imports and extract the insertion from `create_session()`:

```python
def create_student_session(
    connection: sqlite3.Connection,
    student_account_id: int,
) -> str:
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = utc_now()
    connection.execute(
        """
        INSERT INTO student_sessions
            (student_account_id, token_hash, expires_at, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (
            student_account_id,
            token_hash,
            (now + timedelta(days=SESSION_DAYS)).isoformat(),
            now.isoformat(),
        ),
    )
    return token


def create_session(student_account_id: int) -> str:
    with get_connection() as connection:
        return create_student_session(connection, student_account_id)
```

Do not alter teacher session creation.

- [ ] **Step 3: Split authenticated identity from formal student access**

Rename the current database lookup responsibility to `get_authenticated_student`, include the field, and normalize it to a boolean:

```python
def get_authenticated_student(
    oa_session: str | None = Cookie(default=None),
) -> dict[str, object]:
    if not oa_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
    token_hash = hashlib.sha256(oa_session.encode("utf-8")).hexdigest()
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT a.id, a.student_no, a.name, a.must_change_password
            FROM student_sessions s
            JOIN student_accounts a ON a.id = s.student_account_id
            WHERE s.token_hash = ? AND s.expires_at > ? AND a.status = 'active'
              AND a.account_kind = 'normal'
            """,
            (token_hash, utc_now_iso()),
        ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录状态已失效",
        )
    return {
        "id": row["id"],
        "studentNo": row["student_no"],
        "name": row["name"],
        "mustChangePassword": bool(row["must_change_password"]),
    }
```

Keep `get_current_student` as the formal business dependency:

```python
def get_current_student(
    oa_session: str | None = Cookie(default=None),
) -> dict[str, object]:
    student = get_authenticated_student(oa_session)
    if student["mustChangePassword"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="请先修改初始密码",
        )
    return student
```

`get_current_runtime_student()` must continue to call `get_current_student(oa_session)` only when no preview token exists. Its preview branch remains unchanged, so teacher预览账号既不读取此字段，也不进入强制改密页面。

- [ ] **Step 4: Perform the task-level static authorization audit**

Read every dependency use returned by:

```bash
rg -n "get_current_student|get_current_runtime_student|get_authenticated_student" backend/app/api/routes backend/app/services/security.py
```

Confirm manually that only `/me` and `/change-password` use `get_authenticated_student`; logout continues to invalidate the Cookie token directly. All student flow list/enter/read/draft/submit/upload/download/retry routes must still resolve through `get_current_student` or `get_current_runtime_student`.

---

### Task 2: Implement Student Login and Atomic Forced Password Change

**Files:**

- Modify: `backend/app/api/routes/auth.py:1-199`

**Interfaces:**

- Consumes: `create_student_session`, `get_authenticated_student`, `hash_password`, and `verify_password` from Task 1.
- Produces: `StudentRegistrationCredentials`, password `8..128`.
- Produces: `StudentLoginCredentials`, password `3..128`.
- Produces: `StudentPasswordChangeRequest`, `newPassword` length `8..128`.
- Produces: `POST /api/auth/student/change-password` returning the rotated student identity.

- [ ] **Step 1: Split request models without changing teacher rules**

Replace shared student credentials with explicit models:

```python
class StudentRegistrationCredentials(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    studentNo: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=8, max_length=128)


class StudentLoginCredentials(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    studentNo: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=3, max_length=128)


class StudentPasswordChangeRequest(BaseModel):
    newPassword: str = Field(min_length=8, max_length=128)
```

Use registration credentials only on the two registration decorators and login credentials only on the two login decorators. Leave `TeacherCredentials.password` at `8..128`.

- [ ] **Step 2: Return the server-side requirement on register, login, and `/me`**

Registration returns `mustChangePassword: False`. Student login selects `must_change_password` and returns its boolean value. Change `/student/me` and legacy `/me` to depend on `get_authenticated_student`, not the formal business dependency:

```python
@router.get("/student/me")
@router.get("/me", include_in_schema=False)
def me(
    student: dict[str, object] = Depends(get_authenticated_student),
) -> dict[str, object]:
    return student
```

This preserves the session while allowing the frontend to recover the forced-change screen after refresh.

- [ ] **Step 3: Add the atomic change-password transaction and session rotation**

Reject `123` explicitly before opening the transaction. Inside `BEGIN IMMEDIATE`, re-read the account to prevent stale frontend state, require a normal active account with `must_change_password = 1`, update the hash/flag/timestamp, delete all sessions, and insert exactly one replacement session:

```python
@router.post("/student/change-password")
def change_student_password(
    payload: StudentPasswordChangeRequest,
    response: Response,
    student: dict[str, object] = Depends(get_authenticated_student),
) -> dict[str, object]:
    if payload.newPassword == "123":
        raise HTTPException(status_code=422, detail="新密码不能与初始密码相同")

    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            """
            SELECT id, student_no, name, status, account_kind, must_change_password
            FROM student_accounts WHERE id = ?
            """,
            (int(student["id"]),),
        ).fetchone()
        if row is None or row["status"] != "active" or row["account_kind"] != "normal":
            raise HTTPException(status_code=401, detail="登录状态已失效")
        if not bool(row["must_change_password"]):
            raise HTTPException(status_code=409, detail="当前账号不需要重置密码")
        connection.execute(
            """
            UPDATE student_accounts
            SET password_hash = ?, must_change_password = 0, updated_at = ?
            WHERE id = ?
            """,
            (hash_password(payload.newPassword), now, int(row["id"])),
        )
        connection.execute(
            "DELETE FROM student_sessions WHERE student_account_id = ?",
            (int(row["id"]),),
        )
        token = create_student_session(connection, int(row["id"]))

    set_session_cookie(response, token)
    return {
        "id": row["id"],
        "studentNo": row["student_no"],
        "name": row["name"],
        "mustChangePassword": False,
    }
```

Do not write the old password, new password, temporary password or hash into `audit_logs`; this student operation does not need a password-content audit record.

- [ ] **Step 4: Statically inspect the transaction boundary and response contract**

Confirm from the final diff that the password update, flag clear, old-session deletion and new-session insertion share one `with get_connection()` transaction, and that `set_session_cookie()` occurs only after the transaction has completed successfully.

---

### Task 3: Implement the Super-Administrator Reset Transaction

**Files:**

- Modify: `backend/app/repositories/database_admin.py:1-295`
- Modify: `backend/app/api/routes/database_admin.py:1-92`

**Interfaces:**

- Produces: `reset_student_password(student_id: int, reason: str, actor_id: int) -> dict[str, object]`.
- Produces: `POST /api/admin/database/student-accounts/{student_id}/reset-password` with body `{ "reason": string }`.
- Returns: `{ "backupCreated": true, "reset": true }`.
- Error mapping: missing student `404`; preview student or blank reason `422`; non-super-admin remains `403` through router dependencies.

- [ ] **Step 1: Add a dedicated repository transaction instead of widening generic edit policy**

Import `hash_password` and `utc_now_iso` from `app.services.security`. Keep `password_hash` absent from `TABLE_POLICIES["student_accounts"].editable_columns` and present in `SENSITIVE_COLUMNS`.

Implement the dedicated operation:

```python
def reset_student_password(
    student_id: int,
    reason: str,
    actor_id: int,
) -> dict[str, object]:
    if not reason.strip():
        raise DatabaseAdminError("请填写重置原因")

    _backup_database()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        account = connection.execute(
            """
            SELECT id, student_no, name, account_kind, must_change_password
            FROM student_accounts WHERE id = ?
            """,
            (student_id,),
        ).fetchone()
        if account is None:
            raise KeyError(student_id)
        if account["account_kind"] != "normal":
            raise DatabaseAdminError("预览学生账号不能重置密码")

        session_count = int(connection.execute(
            "SELECT COUNT(*) AS count FROM student_sessions WHERE student_account_id = ?",
            (student_id,),
        ).fetchone()["count"])
        now = utc_now_iso()
        connection.execute(
            """
            UPDATE student_accounts
            SET password_hash = ?, must_change_password = 1, updated_at = ?
            WHERE id = ?
            """,
            (hash_password("123"), now, student_id),
        )
        connection.execute(
            "DELETE FROM student_sessions WHERE student_account_id = ?",
            (student_id,),
        )
        before_data = {
            "studentNo": account["student_no"],
            "name": account["name"],
            "mustChangePassword": bool(account["must_change_password"]),
            "activeSessionCount": session_count,
        }
        after_data = {
            "studentNo": account["student_no"],
            "name": account["name"],
            "mustChangePassword": True,
            "sessionsInvalidated": session_count,
        }
        connection.execute(
            """
            INSERT INTO audit_logs
                (actor_id, action, entity_type, entity_id,
                 before_data, after_data, reason, created_at)
            VALUES (?, 'student_password_reset', 'student_account', ?, ?, ?, ?, ?)
            """,
            (
                str(actor_id),
                str(student_id),
                json.dumps(before_data, ensure_ascii=False, sort_keys=True),
                json.dumps(after_data, ensure_ascii=False, sort_keys=True),
                reason.strip(),
                now,
            ),
        )
    return {"reset": True, "backupCreated": True}
```

The operation must not issue SQL against any flow-domain table.

- [ ] **Step 2: Expose the dedicated super-admin route**

Add an explicit request model and route:

```python
class ResetStudentPasswordRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=300)


@router.post("/student-accounts/{student_id}/reset-password")
def reset_password(
    student_id: int,
    payload: ResetStudentPasswordRequest,
    admin: dict[str, object] = Depends(get_current_super_admin),
) -> dict[str, object]:
    try:
        return reset_student_password(
            student_id=student_id,
            reason=payload.reason,
            actor_id=int(admin["id"]),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="学生账号不存在") from exc
    except DatabaseAdminError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
```

The router-level dependency remains the primary authentication check; the endpoint-level dependency supplies the actor ID for auditing.

- [ ] **Step 3: Statically verify protected-data invariants**

Read the complete new `reset_student_password()` body and confirm that its only writes are:

```text
UPDATE student_accounts
DELETE student_sessions
INSERT audit_logs
```

Confirm that it contains no reference to `flow_instances`, `node_instances`, `node_drafts`, `submissions`, `answer_sheet_grades`, `uploaded_files`, `audit_jobs`, or OSS operations.

---

### Task 4: Add the Shared Student Forced-Change Form and Route It from Both Entry Points

**Files:**

- Modify: `frontend/src/features/auth/authApi.ts:1-84`
- Create: `frontend/src/features/auth/StudentPasswordChangeForm.tsx`
- Modify: `frontend/src/features/auth/AuthPortal.tsx:21-79`
- Modify: `frontend/src/features/auth/StudentAccessGate.tsx:1-148`
- Modify: `frontend/src/features/academic-flow/api.ts:1-319`
- Modify: `frontend/src/features/academic-flow/runtimeTypes.ts:1-7`
- Modify: `frontend/src/App.tsx:1-225,254-280,490-565,661-687`
- Modify: `frontend/src/types.ts:1-16`
- Modify: `frontend/src/styles.css:6850-6952,9304-9540`

**Interfaces:**

- Produces: `AuthIdentity.mustChangePassword?: boolean`.
- Produces: `authApi.changeStudentPassword(newPassword: string) -> Promise<AuthIdentity>`.
- Produces: `StudentPasswordChangeForm` with `identity`, `onChanged`, and `onLogout` props.
- Produces: frontend route `/student/change-password` mapped to `Screen = "studentChangePassword"`.
- Removes: duplicated `workflowApi.me/register/login/logout` and unused `runtimeTypes.StudentIdentity`.

- [ ] **Step 1: Extend the centralized auth API**

Add the optional field to the shared identity because teacher identities do not return it:

```typescript
export type AuthIdentity = {
  employeeNo?: string;
  id: number;
  mustChangePassword?: boolean;
  name: string;
  role?: "super_admin" | "teacher";
  studentNo?: string;
};
```

Add:

```typescript
changeStudentPassword(newPassword: string) {
  return request<AuthIdentity>("/api/auth/student/change-password", {
    method: "POST",
    body: JSON.stringify({ newPassword }),
  });
},
```

- [ ] **Step 2: Build one reusable forced-change form**

Create `StudentPasswordChangeForm.tsx` with this public contract:

```typescript
export function StudentPasswordChangeForm({
  identity,
  onChanged,
  onLogout,
}: {
  identity: AuthIdentity;
  onChanged: (identity: AuthIdentity) => Promise<void> | void;
  onLogout: () => Promise<void> | void;
})
```

The component owns only `newPassword`, `confirmation`, `error`, and `submitting`. Before calling the API it must require:

```typescript
if (newPassword.length < 8) setError("新密码至少需要 8 位");
else if (newPassword === "123") setError("新密码不能与初始密码相同");
else if (newPassword !== confirmation) setError("两次输入的密码不一致");
```

On success, call `await onChanged(await authApi.changeStudentPassword(newPassword))`. The UI must state that当前仅可修改密码、流程数据仍保留，并 provide a secondary “退出登录” action wired to `onLogout`.

- [ ] **Step 3: Allow `123` only in student login forms**

In `AuthPortal`, compute:

```typescript
const minimumPasswordLength = role === "student" && mode === "login" ? 3 : 8;
```

Use it in the existing submit guard and error copy. Do not alter the teacher branch or registration confirmation logic.

In `StudentAccessGate`, apply the same `mode === "login" ? 3 : 8` rule.

- [ ] **Step 4: Route normal student login and refresh recovery through `/student/change-password`**

Add `studentChangePassword` to `Screen` and map `/student/change-password` in `getRouteFromPathname()`.

Update `completeAuthentication()`:

```typescript
setStudentIdentity(identity);
if (identity.mustChangePassword) {
  pushAppPath("/student/change-password");
  setScreen("studentChangePassword");
  return;
}
pushAppPath("/student");
setScreen("studentHome");
```

Treat `studentChangePassword` as a student-authenticated screen during initial `/me` loading. Render the shared form only when `studentIdentity?.mustChangePassword === true`; after success, replace the identity, navigate to `/student`, and render `StudentAccountPage`. If the route is opened with no student session, show student login; if a normal student opens it, normalize back to `/student` instead of calling the 409 endpoint.

The normalization effect must be limited to student screens, so an unrelated pending student cookie cannot replace a valid teacher/admin page.

- [ ] **Step 5: Keep the share URL in place and block `enterShared()` until password change succeeds**

Use `authApi` for `me`, login, register and logout inside `StudentAccessGate`. Track the returned pending identity:

```typescript
const [pendingIdentity, setPendingIdentity] = useState<AuthIdentity | null>(null);
```

On existing-session load and on form submission:

```typescript
const identity = await authApi.me("student"); // or login/register result
if (identity.mustChangePassword) {
  setPendingIdentity(identity);
  return;
}
onEntered(await workflowApi.enterShared(token));
```

When `authApi.me("student")` fails, treat only `AuthApiError` with status `401` as an unauthenticated visitor who should see the login form. Continue surfacing all other authentication errors; keep `ApiError` handling for public flow metadata and workflow-entry requests.

When `pendingIdentity` exists, render `StudentPasswordChangeForm` inside the existing share-page shell. Its `onChanged` callback clears pending state and only then calls `enterShared(token)`; its logout callback clears the session and returns to the share login form. Do not navigate away from `/s/{token}` during this flow.

- [ ] **Step 6: Remove duplicate share-auth methods and style the shared component**

After `StudentAccessGate` uses `authApi`, remove `workflowApi.me/register/login/logout`, its `StudentIdentity` import, and the now-unused `StudentIdentity` type. Do not change any workflow runtime method.

Add `.student-password-change-form` styles using the existing card dimensions, gray borders, 6–8 px radii, blue primary action, red error copy and responsive behavior. Reuse the same class in the standalone route and share-link shell; do not create a visually separate design language.

- [ ] **Step 7: Statically trace both entry paths**

Confirm these exact call sequences from the final source:

```text
/auth/login?role=student
  -> authApi.login(student)
  -> mustChangePassword true
  -> /student/change-password
  -> authApi.changeStudentPassword
  -> /student

/s/{token}
  -> authApi.me or authApi.login(student)
  -> mustChangePassword true
  -> shared StudentPasswordChangeForm
  -> authApi.changeStudentPassword
  -> workflowApi.enterShared(token)
```

Verify there is no `enterShared()` call on a branch where `mustChangePassword` is true.

---

### Task 5: Add the Administrator Reset Interaction

**Files:**

- Modify: `frontend/src/features/admin/databaseAdminApi.ts:1-77`
- Modify: `frontend/src/features/admin/DatabaseAdminPage.tsx:1-427`
- Modify: `frontend/src/styles.css:2211-2477`

**Interfaces:**

- Consumes: `POST /api/admin/database/student-accounts/{student_id}/reset-password` from Task 3.
- Produces: `databaseAdminApi.resetStudentPassword(studentId: number, reason: string)`.
- Produces: `StudentPasswordResetDialog` with target row, cancel and success callbacks.

- [ ] **Step 1: Add the typed admin API call**

Add:

```typescript
resetStudentPassword(studentId: number, reason: string) {
  return request<{ backupCreated: boolean; reset: boolean }>(
    `/api/admin/database/student-accounts/${studentId}/reset-password`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
},
```

- [ ] **Step 2: Expose the button only for a normal student row**

At page level add `resettingStudent`. Pass an optional `onResetPassword` callback to `DatabaseRowEditor` only when:

```typescript
activeTable === "student_accounts" && editingRow.account_kind === "normal"
```

Render “重置密码” as a separate footer action, not as an editable field and not as a generic save mutation. A preview row must not show the action even though the backend also rejects it.

- [ ] **Step 3: Add an explicit confirmation dialog with required reason**

Create a focused `StudentPasswordResetDialog` in the same file. It must display:

```text
学生：{name}（{student_no}）
临时密码将重置为 123
该学生现有登录状态将全部失效
已填写流程、草稿、提交、成绩和文件不会删除
```

Require a trimmed reason of at most 300 characters. On success, close both dialogs, reload the current `student_accounts` page and table counts, and show:

```text
学生密码已重置为 123；原流程数据保留，学生下次登录必须修改密码
```

Do not put `123` into the request body; it is a server-side fixed policy.

- [ ] **Step 4: Style within the existing database-admin language**

Reuse the centered confirmation-dialog structure. Use a red warning icon/copy for the security consequence, a blue confirmation button, and the existing white panel/gray border/radius values. Keep reset and row-save buttons visually and behaviorally separate.

- [ ] **Step 5: Statically inspect visibility and refresh behavior**

Confirm that `account_kind` comes from the redacted row response, that only numeric `row.id` is sent as `studentId`, that a successful reset closes both layers, and that API errors remain visible without closing the confirmation dialog.

---

### Task 6: Final Business-Logic Audit, Result Commit, and Local Restart

**Files:**

- Review all files listed in the File Map.
- Do not modify unrelated dirty files: `.gitignore`, `AGENTS.md`, `README.md`, `docker-compose.yml`, `storage/.gitkeep`, `INSTALL.md`, or `assets/` unless they independently changed before this task.

**Interfaces:**

- Consumes: all earlier tasks.
- Produces: one result commit containing only this task’s implementation and documentation files.
- Produces: locally restarted backend on `0.0.0.0:8000` and frontend on `0.0.0.0:5173`.

- [ ] **Step 1: Audit the backend access boundary**

Use read-only searches and source inspection:

```bash
rg -n "get_authenticated_student|get_current_student|get_current_runtime_student" backend/app
rg -n "must_change_password|mustChangePassword" backend/app frontend/src
```

Verify that pending sessions can only reach auth `/me`, `/change-password`, and `/logout`, while all business routes keep the formal dependency.

- [ ] **Step 2: Audit data preservation and secret redaction**

Inspect the two password transactions and confirm:

```text
Admin reset writes: student_accounts, student_sessions, audit_logs
Student change writes: student_accounts, student_sessions
```

Search the task diff for protected table names and verify none occur in write statements. Confirm `password_hash` remains sensitive/read-only and no response or audit payload includes a password or hash.

- [ ] **Step 3: Audit frontend branch completeness**

Trace normal login, refresh on `/student/change-password`, direct student runtime access, share-link login, logout, successful change, failed change, and normal registration. Confirm teacher login and preview entry paths do not read or react to `mustChangePassword`.

- [ ] **Step 4: Run formatting-only checks permitted by the project**

Run:

```bash
git diff --check
git status --short
```

Do not run pytest, Node tests, TypeScript compilation, Vite build, HTTP checks, or browser automation. Report this verification boundary explicitly.

- [ ] **Step 5: Inspect and clean only task-generated caches**

Check for `.pytest_cache`, `__pycache__`, and `*.egg-info` created during this task. Because the plan does not execute Python or tests, expect none; remove only paths confirmed to have been generated by this task and leave dependency directories untouched.

- [ ] **Step 6: Create the single result commit**

Stage only the implementation files in the File Map plus the already approved spec/plan documents, inspect the staged name list, then commit:

```bash
git commit -m "feat: add student password reset flow"
```

Do not stage any pre-existing unrelated worktree change.

- [ ] **Step 7: Restart the existing local services without Docker**

First resolve listeners, PIDs and working directories for ports `8000` and `5173`. Stop only processes confirmed to belong to `/ai/github-repo/moyin`. Then start:

```bash
cd /ai/github-repo/moyin/backend
./.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

```bash
cd /ai/github-repo/moyin
export PATH="$PWD/.local/node/bin:$PATH"
cd frontend
npm run dev -- --host 0.0.0.0 --port 5173
```

Re-check that the backend listener’s working directory is `backend/`, the frontend belongs to this repository, and both ports listen on `0.0.0.0`. Do not send HTTP requests unless the user separately asks for them.

- [ ] **Step 8: Report the exact verification boundary and URL**

State the result commit, changed behavior, preserved data tables, process-level restart result, and frontend URL `http://localhost:5173/`. Explicitly state that tests, build, HTTP checks and browser verification were not run because the project instructions prohibit them during this code-change workflow.
