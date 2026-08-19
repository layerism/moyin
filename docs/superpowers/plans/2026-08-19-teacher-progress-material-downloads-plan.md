# Teacher Progress Material Downloads and Manual Approval Implementation Plan

> **For Codex:** Follow the repository `AGENTS.md`: perform static business-logic audit only, do not run tests, frontend builds, or browser automation; create exactly the pre-implementation and final checkpoint commits, then restart the local non-Docker services.

**Goal:** Extend the existing teacher progress panel with single-node/all-node material ZIP downloads, one-student one-node downloads, and transactional manual approval without changing the database schema.

**Architecture:** A focused repository resolves teacher-owned, published-version material selections from current submissions. A ZIP service downloads the selected OSS objects into an isolated temporary directory and streams a `FileResponse` whose background cleanup removes the directory. Manual approval remains in the audit-job repository so the job result, submission, node, downstream advancement, and audit log change atomically; the route only signals cancellation after commit.

**Tech Stack:** FastAPI, SQLite, Python `zipfile`/`tempfile`, React, TypeScript, existing object-storage service.

---

## Global constraints

- [ ] Do not add or alter database tables, columns, indexes, or migrations.
- [ ] Do not expose audit-script source editing in the frontend.
- [ ] Preserve the existing progress table and student deadline interaction.
- [ ] Exclude preview instances, drafts, cancelled submissions, and historical attempts from archives.
- [ ] Do not run tests, frontend builds, or browser automation; use source inspection and `git diff --check` only.

## Task 1: Resolve materials and build ZIP archives

**Files:**

- Create: `backend/app/repositories/teacher_materials.py`
- Create: `backend/app/services/material_archive.py`
- Modify: `backend/app/api/routes/workflow_admin.py`

- [ ] Add immutable selection records containing flow name, node order/title, student number/name, original filename, and internal storage key.
- [ ] Implement `get_version_materials(version_id, teacher_id, node_key=None)` with flow ownership and `published` version checks. Treat file nodes and template-backed confirmation nodes as material-producing nodes.
- [ ] Query only uploaded files attached to the current node attempt and submissions in `reviewing`, `approved`, `rejected`, or `audit_error`.
- [ ] Implement `get_node_instance_materials(node_instance_id, teacher_id)` for one student and one current node submission.
- [ ] Implement path-component sanitization, stable duplicate-name suffixes, OSS download, ZIP creation, and cleanup on both errors and response completion.
- [ ] Use these archive paths:
  - selected node: `节点名称/学号-姓名/原文件名`;
  - all nodes: `流程名称/序号-节点名称/学号-姓名/原文件名`;
  - one student/node: original files at the archive root.
- [ ] Add `GET /versions/{version_id}/materials/download` with optional `nodeKey` and `GET /node-instances/{node_instance_id}/materials/download`.
- [ ] Return `404` for inaccessible resources, `422` for an empty selection, and `503` when object storage is unavailable.

## Task 2: Make manual approval atomic and race-safe

**Files:**

- Modify: `backend/app/repositories/audit_jobs.py`
- Modify: `backend/app/repositories/flow_instances.py`
- Modify: `backend/app/api/routes/workflow_admin.py`

- [ ] Implement `manual_approve_audit_job(node_instance_id, submission_id, teacher_id, reason)` inside one `BEGIN IMMEDIATE` transaction.
- [ ] Revalidate teacher ownership, published version, current attempt, at least one attached file, and node status in `reviewing`, `rejected`, or `audit_error`.
- [ ] Overwrite the existing job with `status='succeeded'`, the canonical manual result, cleared error/cancellation fields, and finished timestamps.
- [ ] Set submission and node to `approved`, call `advance_downstream()` and `complete_flow_if_ready()`, and write the manual note only to `audit_logs.reason`.
- [ ] Return any formerly running job ID and call `signal_audit_job_cancellations()` after the transaction. Existing worker completion remains guarded by `status='running'`.
- [ ] Extend submission detail with `submissionId`, `reviewSource`, and `canManualApprove`.
- [ ] Add `POST /node-instances/{node_instance_id}/manual-approve` with a strict payload containing current `submissionId` and a 1–500-character reason.

## Task 3: Add the teacher controls without redesigning the page

**Files:**

- Modify: `frontend/src/features/academic-flow/api.ts`
- Modify: `frontend/src/features/academic-flow/runtimeTypes.ts`
- Modify: `frontend/src/features/academic-flow/TeacherProgressPanel.tsx`
- Modify: `frontend/src/styles.css`

- [ ] Add a blob-download request helper that preserves session authentication, extracts the response filename, and surfaces structured API errors.
- [ ] Add API methods for version material download, node-instance material download, and manual approval.
- [ ] Add a compact toolbar above the table with scope options “全部节点（按层级整理）” and each material-producing node.
- [ ] Trigger browser ZIP download with a temporary object URL and prevent repeated clicks while packaging.
- [ ] Add “下载本节点全部材料” to the existing submission-detail dialog.
- [ ] Show “人工审核通过” only when `canManualApprove` is true; collect a required 1–500-character note in a small confirmation dialog.
- [ ] After approval, refresh both the detail and progress. Display the manual result as “经由人工审核通过”, without an obsolete score.
- [ ] Change `.teacher-progress-panel` to `width: min(1100px, 96vw)` and reuse existing control/button styling.

## Task 4: Static audit, cleanup, checkpoint, and restart

**Files:** all files above.

- [ ] Review every new SQL join for owner, published-version, current-attempt, submission-status, and uploaded-file constraints.
- [ ] Review ZIP path sanitization and temporary-directory cleanup for traversal and file-leak risks.
- [ ] Review the manual-approval transaction for late-worker overwrite protection and downstream advancement.
- [ ] Run `git diff --check` and inspect the final scoped diff; do not run tests or builds.
- [ ] Remove `.pytest_cache`, `__pycache__`, and `*.egg-info` artifacts without touching user files.
- [ ] Create the final checkpoint commit containing only this task's files.
- [ ] Restart backend on port 8000 and frontend on port 5173 using the project-local Node.js environment, then verify both ports are listening.
