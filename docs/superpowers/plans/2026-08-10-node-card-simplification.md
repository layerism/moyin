# Node Card Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove visual node numbering, clamp all overview-card titles to two lines, and rename scan-signing templates consistently.

**Architecture:** Delete numbering markup and its dedicated layout columns from the three overview card variants. Apply shared two-line clamp behavior within each existing typography scale, and update only user-facing template strings while preserving resource and workflow contracts.

**Tech Stack:** React, TypeScript, CSS.

## Global Constraints

- Do not add dependencies or change node, template, API, or database schemas.
- Keep teacher canvas width, minimum height, ResizeObserver measurement, ports, and edge geometry unchanged.
- Keep full titles available in teacher settings and student runtime dialogs.
- Do not run tests, builds, or browser automation; perform static business-logic audit only.

---

### Task 1: Remove node numbering and its layout space

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Modify: `frontend/src/features/academic-flow/StudentFlowTopology.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: teacher canvas, student topology, and teacher student-preview card markup.
- Produces: title/status cards without ordinal badges.

- [ ] **Step 1: Delete numbering markup**

Remove `.node-index`, `.student-topology-node-index`, and `.student-node-index` spans. Remove the now-unused `order` parameter from `StudentNode` and its call site.

- [ ] **Step 2: Collapse teacher and preview spacing**

Reduce `.flow-node` left padding from the numbered layout to ordinary card padding. Change `.student-node` from three columns to title/status columns.

- [ ] **Step 3: Collapse student topology spacing**

Change `.student-topology-node` to one content column, move metadata to column 1, and delete index base/state selectors.

### Task 2: Clamp overview titles to two lines

**Files:**
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: existing title elements in all three overview cards.
- Produces: two-line WebKit clamping with hidden overflow and ellipsis behavior.

- [ ] **Step 1: Clamp teacher titles**

Set `.flow-node strong` to `display: -webkit-box`, hidden overflow, vertical box orientation, and `-webkit-line-clamp: 2`; retain `17px` and current line height.

- [ ] **Step 2: Clamp student topology titles**

Replace single-line `white-space: nowrap` truncation with the same two-line box clamp while retaining `17px`.

- [ ] **Step 3: Clamp teacher student-preview titles**

Apply the two-line box clamp to `.student-node strong` while retaining its `16px` size.

### Task 3: Rename signing-template copy

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx`
- Modify: `frontend/src/features/academic-flow/ScanUploadWorkspace.tsx`
- Modify: `frontend/src/features/academic-flow/publishButtonState.ts`
- Modify: `backend/app/domain/workflow.py`

**Interfaces:**
- Consumes: existing scan audit template labels and validation messages.
- Produces: user-facing “签署文件模板” terminology with unchanged logic.

- [ ] **Step 1: Rename teacher configuration heading**

Change `承诺书模板（DOCX）` to `签署文件模板（DOCX）`.

- [ ] **Step 2: Rename student download copy**

Change `下载承诺书模板` and `请先下载承诺书模板` to the corresponding `签署文件模板` wording.

- [ ] **Step 3: Rename publish validation copy**

Change frontend and backend `需要上传 DOCX 承诺书模板` / `请上传 DOCX 承诺书模板` messages to the corresponding `签署文件模板` wording without changing validation conditions.

### Task 4: Static audit, cleanup, commit, and restart

**Files:**
- Modify: only files listed above and this plan.

**Interfaces:**
- Consumes: completed UI and copy changes.
- Produces: one implementation commit and restarted local services.

- [ ] **Step 1: Audit numbering, title, and copy boundaries**

Use `rg` to confirm node index markup/styles and user-facing `承诺书模板` strings are gone, while template actions and full-title detail surfaces remain.

- [ ] **Step 2: Review and clean**

Run `git diff --check`, inspect the scoped diff, preserve unrelated user files, stop services, and remove project source cache directories.

- [ ] **Step 3: Commit implementation**

Stage only this plan and the modified frontend files; commit with `feat: simplify flow node cards`.

- [ ] **Step 4: Restart services**

Restart Uvicorn on port `8000` and Vite on port `5173`, then confirm both local endpoints return HTTP `200`.
