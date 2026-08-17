# Preview Force Draft Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every teacher-side preview action persist the current workflow draft before creating and navigating to the preview.

**Architecture:** Keep the existing draft and preview APIs unchanged. Reorder the `openPreview` orchestration in `AcademicFlowDesigner` so a synchronously opened blank tab waits for `saveWorkingDraft`, then proceeds to `createPreview` only when saving succeeds.

**Tech Stack:** React 18, TypeScript, existing `workflowApi` client.

## Global Constraints

- Every preview click must execute the existing draft-save path, including when `revisionDirty` is false.
- A failed draft save must prevent preview creation and close the blank tab.
- A blocked popup must prevent both draft saving and preview creation.
- Do not change backend APIs, database structures, publishing behavior, or the standalone draft button.
- Preserve unrelated user changes in the working tree.
- Per project instructions, do not run tests or browser automation; perform source-level business-logic auditing only.
- The managed checkout currently exposes `.git` as read-only, so checkpoint and result commits cannot be created in this session.

---

### Task 1: Save the workflow before creating a preview

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:367`

**Interfaces:**
- Consumes: `saveWorkingDraft(candidate: AcademicProcess, successMessage?: string): Promise<AcademicProcess | null>` and `workflowApi.createPreview(serverFlowId: string)`.
- Produces: `openPreview(): Promise<void>` with ordered save-then-preview behavior.

- [x] **Step 1: Remove the dirty-state rejection**

Delete the early branch that reports `请先暂存当前修改后再预览`. Keep the synchronous `window.open("", "_blank")` call before the first `await`.

- [x] **Step 2: Lock the complete preview operation**

Set `previewCreating` and clear `actionNotice` immediately after confirming that the blank tab opened, so saving and preview creation share the existing operation lock.

- [x] **Step 3: Force the existing draft save**

At the start of the `try` block, add:

```tsx
const saved = await saveWorkingDraft(workingProcess, "");
if (!saved) {
  previewWindow.close();
  return;
}
```

This must execute unconditionally. `saveWorkingDraft` remains responsible for updating the global process, the working copy, `revisionDirty`, and the user-visible save error.

- [x] **Step 4: Create and navigate to the preview only after saving**

Retain the existing sequence after the new save guard:

```tsx
const preview = await workflowApi.createPreview(serverFlowId);
previewWindow.sessionStorage.setItem(FLOW_PREVIEW_TOKEN_KEY, preview.previewToken);
previewWindow.opener = null;
previewWindow.location.href = preview.previewUrl;
```

Retain the existing catch behavior that closes the blank tab and displays the preview-creation error, and retain the `finally` reset of `previewCreating`.

- [x] **Step 5: Audit the resulting source flow**

Read the complete `saveWorkingDraft` and `openPreview` functions and confirm these branches:

```text
popup blocked -> notice only; no save; no preview API
popup opened + save failed -> close tab; preserve save error; no preview API
popup opened + save succeeded + preview failed -> close tab; show preview error
popup opened + save succeeded + preview succeeded -> store token; detach opener; navigate
```

Run only non-test static checks permitted by the project:

```bash
sed -n '245,395p' frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
rg -n "请先暂存当前修改后再预览|saveWorkingDraft\(workingProcess, \"\"\)|createPreview" frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
git diff --check -- frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
git diff -- frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
```

Expected audit result: the obsolete notice is absent; the save call precedes `createPreview`; no whitespace errors are reported; the diff contains only the preview orchestration change.

- [x] **Step 6: Perform required project closeout**

Remove only project-generated `.pytest_cache`, `__pycache__`, and `*.egg-info` artifacts if present. Restart the existing local backend from `backend/` on port `8000` and frontend with the repository Node.js environment on port `5173`, stopping only processes confirmed to belong to this project. Report that no tests or browser checks were run.

If `.git` becomes writable, create the result checkpoint with only these task files:

```bash
git add frontend/src/features/academic-flow/AcademicFlowDesigner.tsx \
  docs/superpowers/specs/2026-08-17-preview-force-draft-save-design.md \
  docs/superpowers/plans/2026-08-17-preview-force-draft-save.md
git commit -m "feat: save workflow before preview"
```
