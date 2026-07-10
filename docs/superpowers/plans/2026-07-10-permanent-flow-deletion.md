# OA Flow Permanent Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permanently delete an OA flow and all workflow-owned database records only after the teacher types the exact flow name.

**Architecture:** Replace the repository archive operation with a transaction that deletes flow-owned records in foreign-key dependency order, records a minimal audit event, and deletes the `flows` row. Explicit ordered deletion supports existing SQLite databases whose original tables do not cascade every relationship. The existing React confirmation dialog becomes a controlled destructive-confirmation form.

**Tech Stack:** FastAPI, SQLite, pytest, React, TypeScript, Vite

## Global Constraints

- Preserve teacher and student account records.
- Retain only a minimal deletion audit record without student submission data.
- Require an exact trimmed flow-name match before enabling permanent deletion.
- Keep the existing `DELETE /api/workflows/{flow_id}` route and teacher authorization boundary.

---

### Task 1: Transactional database purge

**Files:**
- Modify: `backend/tests/test_flow_archiving.py`
- Modify: `backend/app/core/database.py`
- Modify: `backend/app/repositories/workflows.py`
- Modify: `backend/app/api/routes/workflows.py`

**Interfaces:**
- Produces: `delete_flow(flow_id: str, teacher_id: int) -> None`
- Preserves: `DELETE /api/workflows/{flow_id}` returning `204` on success and `404` when absent

- [ ] **Step 1: Write failing repository/API tests**

Create a published flow with a student instance, node draft, submission, deadline override, runtime config and share token. Delete it, then assert all flow-owned table counts are zero, account counts remain one, and one `delete` audit row retains only flow metadata. Assert a second delete returns `404`.

- [ ] **Step 2: Verify the tests fail**

Run: `cd backend && .venv/bin/python -m pytest tests/test_flow_archiving.py -q`

Expected: failures because the current endpoint only changes status to `archived`.

- [ ] **Step 3: Implement the transactional purge**

Implement `delete_flow` to select the flow, remove related audit and workflow-owned records in dependency order, insert the minimal audit record, and delete the parent row in one connection context. Update the API route to call it.

- [ ] **Step 4: Verify backend behavior**

Run: `cd backend && .venv/bin/python -m pytest tests/test_flow_archiving.py -q`

Expected: all deletion tests pass.

### Task 2: Strong destructive confirmation

**Files:**
- Modify: `frontend/src/features/home/HomeDialogs.tsx`
- Modify: `frontend/src/features/home/HomeView.tsx`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/features/academic-flow/api.ts`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- `FlowDeleteDialog` consumes flow name, submitting state, optional error, cancel callback and confirm callback.
- The API client exposes `remove(serverId: string): Promise<void>`.

- [ ] **Step 1: Add confirmation state and exact-name validation**

Keep the typed value local to the dialog, compare `value.trim() === name`, disable deletion until matched, and reset state when the dialog closes.

- [ ] **Step 2: Update destructive copy and styling**

List the deleted data categories, label the action “永久删除”, and use a high-contrast danger panel and irreversible-action notice.

- [ ] **Step 3: Preserve errors and loading state**

Catch deletion failures in `AcademicFlowView`, keep the dialog open, and render a concise error message while preventing duplicate submissions.

- [ ] **Step 4: Verify frontend compilation**

Run: `npm run build`

Expected: Vite production build succeeds without TypeScript errors.

### Task 3: End-to-end verification and commit

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update deletion semantics documentation**

Replace soft-delete language with the permanent-deletion scope and retained minimal audit record.

- [ ] **Step 2: Run complete verification**

Run: `cd backend && .venv/bin/python -m pytest -q`

Run: `cd backend && .venv/bin/python -m ruff check app tests`

Run: `npm run build`

Expected: all commands pass.

- [ ] **Step 3: Browser-check the interaction**

Open `/academic-flow`, verify the button remains disabled for a wrong name, becomes enabled for the exact name, then verify deletion removes the row and database records.

- [ ] **Step 4: Commit the completed feature**

```bash
git add backend frontend README.md docs/superpowers
git commit -m "Permanently delete OA workflows"
```
