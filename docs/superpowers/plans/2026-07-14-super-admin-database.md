# Super Admin Database Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted super-admin role for employee `04170` and a protected database browser/editor.

**Architecture:** Add an idempotent SQLite migration and backend RBAC dependency. Expose schema-driven, policy-restricted administration endpoints and consume them from an isolated React administration module.

**Tech Stack:** FastAPI, SQLite, React 18, TypeScript.

## Global Constraints

- Never expose password or session/token hashes.
- Never accept arbitrary SQL, table identifiers, or column identifiers.
- Every update creates a backup and audit record.
- Existing student and teacher behavior remains unchanged.

### Task 1: Role migration and authorization

**Files:** `backend/app/core/database.py`, `backend/app/services/security.py`, `backend/app/api/routes/auth.py`, `backend/tests/test_role_auth.py`

- [ ] Add failing tests for persisted `super_admin` identity and teacher rejection.
- [ ] Add `teacher_accounts.role`, idempotent migration, and `get_current_super_admin`.
- [ ] Return `role` from teacher authentication endpoints.

### Task 2: Database administration API

**Files:** `backend/app/repositories/database_admin.py`, `backend/app/api/routes/database_admin.py`, `backend/app/api/router.py`, `backend/tests/test_database_admin.py`

- [ ] Add failing tests for table listing, redaction, forbidden teacher access and audited updates.
- [ ] Implement table policy, schema introspection, pagination and row updates.
- [ ] Create a backup before each update and append a redacted audit record.

### Task 3: Administration interface

**Files:** `frontend/src/features/admin/databaseAdminApi.ts`, `frontend/src/features/admin/DatabaseAdminPage.tsx`, `frontend/src/features/auth/TeacherAccountMenu.tsx`, `frontend/src/App.tsx`, `frontend/src/types.ts`, `frontend/src/styles.css`

- [ ] Add the `/admin/database` route and role guard.
- [ ] Add the super-admin account-menu entry.
- [ ] Implement the table directory, paginated rows and editable record drawer.

### Task 4: Verification

- [ ] Run all backend tests and Ruff.
- [ ] Run all frontend tests and production build.
- [ ] Verify the existing `04170` record has role `super_admin`.
- [ ] Verify frontend and backend services remain healthy.
- [ ] Commit the implementation checkpoint.
