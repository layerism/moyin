# Student Uploaded File Download and Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this single task with one subagent and a main-agent review. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow students to download the relevant uploaded file and require a genuinely new upload before resubmitting a rejected file node.

**Architecture:** Keep the backend unchanged because it already exposes an ownership-checked download endpoint and rejects reused submitted files. Add the missing frontend API method, derive current versus previous file state from `draft.file` and `runtime.submission.file`, and render one download action outside the file-picker label while using that same derivation to gate resubmission.

**Tech Stack:** React 18, TypeScript, existing Fetch API wrapper, existing CSS.

## Global Constraints

- Reuse `GET /api/student/files/{file_id}/download`; do not add backend endpoints or database fields.
- A rejected node is submittable only when `draft.file.fileId` exists and differs from `runtime.submission.file.fileId`.
- Download the new pending file first; otherwise download the previous submitted file.
- Do not add dependencies or visual assets.
- Modify only `frontend/src/features/academic-flow/api.ts`, `frontend/src/features/academic-flow/StudentRuntimePage.tsx`, and `frontend/src/styles.css`.
- Per `AGENTS.md`, do not run tests, builds, or browser automation; perform static business-logic audit only.
- Use exactly one implementation subagent, make no intermediate commit, create one final implementation commit, clean generated caches, and restart the local services after implementation.

---

## File Structure

- `frontend/src/features/academic-flow/api.ts`: expose the existing student uploaded-file download endpoint through `workflowApi`.
- `frontend/src/features/academic-flow/StudentRuntimePage.tsx`: resolve pending versus previous files, trigger downloads, render state-specific copy, and gate rejected resubmission.
- `frontend/src/styles.css`: style the rejected upload state and the separate download action using the existing visual system.

### Task 1: Implement uploaded-file download and rejected-file replacement gating

**Files:**

- Modify: `frontend/src/features/academic-flow/api.ts:229-254`
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx:175-278,329-405,412-431,547-627`
- Modify: `frontend/src/styles.css:5200-5399,5778-5794`

**Interfaces:**

- Consumes: existing backend response `GET /api/student/files/{file_id}/download` with `{ fileId, originalName, contentType, sizeBytes, url }`.
- Produces: `workflowApi.downloadNodeFile(fileId: string): Promise<{ fileId: string; originalName: string; contentType: string; sizeBytes: number; url: string }>`.
- Produces: `RuntimeNodeDialog` prop `onDownloadFile(fileId: string): void`.
- Preserves: existing `draft.file` shape `{ fileId, name, size, type }` and `runtime.submission.file` shape.

- [ ] **Step 1: Add the frontend API method for the existing download endpoint**

Add beside `uploadFile` and `downloadNodeTemplate`:

```ts
downloadNodeFile(fileId: string) {
  return request<{
    contentType: string;
    fileId: string;
    originalName: string;
    sizeBytes: number;
    url: string;
  }>(`/api/student/files/${encodeURIComponent(fileId)}/download`);
},
```

- [ ] **Step 2: Add the page-level download handler and dialog callback**

Add a handler beside `downloadTemplate` that uses the existing busy and warning state:

```ts
const downloadFile = async (runtime: RuntimeNodeInstance, fileId: string) => {
  setBusyNodeId(runtime.id);
  setNotice("");
  setActionWarning("");
  try {
    const result = await workflowApi.downloadNodeFile(fileId);
    const anchor = document.createElement("a");
    anchor.href = result.url;
    anchor.download = result.originalName;
    anchor.rel = "noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setNotice("文件下载已开始");
  } catch (reason) {
    setActionWarning(reason instanceof Error ? reason.message : "文件下载失败");
  } finally {
    setBusyNodeId(null);
  }
};
```

Pass it into the dialog without introducing new component state:

```tsx
onDownloadFile={(fileId) => void downloadFile(activeRuntime, fileId)}
```

Declare the prop as `onDownloadFile: (fileId: string) => void`.

- [ ] **Step 3: Derive the pending file, previous file, download target, and replacement requirement**

Replace the current single `fileReady` derivation with one source of truth:

```ts
const draftFile = getDraftFile(draft.file);
const submittedFile = getDraftFile(runtime.submission.file);
const needsFileReplacement = runtime.status === "rejected" && Boolean(
  submittedFile?.fileId
    && (!draftFile?.fileId || draftFile.fileId === submittedFile.fileId),
);
const pendingFile = needsFileReplacement ? null : draftFile;
const fileReady = Boolean(pendingFile?.fileId);
const downloadableFile = pendingFile ?? submittedFile;
const downloadingPreviousFile = Boolean(
  downloadableFile?.fileId
    && downloadableFile.fileId === submittedFile?.fileId
    && !fileReady,
);
```

Keep `submitDisabled` based on this corrected `fileReady`. This makes the live polling transition and a full page reload follow the same rule without clearing unrelated local draft state.

- [ ] **Step 4: Render the rejected state and separate download action**

Update the upload workspace class, icon, title, metadata, and action using `needsFileReplacement`:

```tsx
className={`runtime-file-workspace${isDraggingFile ? " is-dragging" : ""}${isUploadingFile ? " is-uploading" : ""}${needsFileReplacement ? " is-rejected" : ""}${fileReady ? " is-ready" : ""}${fileBusy ? " is-busy" : ""}`}
```

Use this exact precedence for the icon, title, metadata, and upload action: locked template, active upload, rejected replacement, ready file, then empty state.

```tsx
<span aria-hidden="true" className="runtime-file-workspace-icon">
  {needsFileReplacement ? "!" : fileReady ? "✓" : "↑"}
</span>
<strong>
  {!uploadUnlocked
    ? "请先下载填写模板"
    : isUploadingFile
      ? "正在上传文件"
      : needsFileReplacement
        ? "审核未通过，请重新上传文件"
        : fileReady
          ? "文件已上传，可提交"
          : "点击选择或拖拽文件到此处"}
</strong>
<small>
  {!uploadUnlocked
    ? "下载成功后自动解锁上传"
    : isUploadingFile
      ? `${uploadingFileName}，请勿关闭窗口`
      : needsFileReplacement
        ? `${getDraftFileName(runtime.submission.file)} · ${formatFileSize(submittedFile?.size)}`
        : fileReady
          ? `${getDraftFileName(draft.file)} · ${formatFileSize(pendingFile?.size)}`
          : "选择后将自动上传"}
</small>
{fileReady || needsFileReplacement ? (
  <span className="runtime-file-workspace-action">
    {needsFileReplacement ? "重新上传" : "更换文件"}
  </span>
) : null}
```

After the closing `</label>`, render the download button outside the label:

```tsx
{downloadableFile?.fileId ? (
  <div className="runtime-uploaded-file-actions">
    <button
      disabled={busy}
      onClick={() => onDownloadFile(downloadableFile.fileId)}
      type="button"
    >
      {downloadingPreviousFile ? "下载上次提交文件" : "下载已上传文件"}
    </button>
  </div>
) : null}
```

Change the submit hint to:

```tsx
{node.kind === "file" && !fileReady ? (
  <small>{needsFileReplacement ? "请重新上传文件" : "请先上传文件"}</small>
) : null}
```

- [ ] **Step 5: Add focused CSS for the rejected state and download action**

Add an amber rejected state without changing the existing ready state:

```css
.runtime-file-workspace.is-rejected {
  border-color: #f59e0b;
  background: #fffbeb;
}

.runtime-file-workspace.is-rejected .runtime-file-workspace-icon {
  background: #fef3c7;
  color: #b45309;
}

.runtime-uploaded-file-actions {
  display: flex;
  justify-content: flex-end;
}

.runtime-uploaded-file-actions button {
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid #84adff;
  border-radius: 6px;
  background: #eff6ff;
  color: #175cd3;
  font-size: 13px;
  font-weight: 700;
}

.runtime-uploaded-file-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}
```

- [ ] **Step 6: Perform the required static business-logic audit**

Run only read-only/static checks permitted by the project:

```bash
git diff --check
git diff -- frontend/src/features/academic-flow/api.ts frontend/src/features/academic-flow/StudentRuntimePage.tsx frontend/src/styles.css
rg -n "downloadNodeFile|needsFileReplacement|downloadableFile|请重新上传文件" frontend/src/features/academic-flow
```

Confirm manually from the diff:

- rejected plus old/missing draft file disables submission;
- rejected plus a different new `fileId` enables submission;
- new pending file wins as the download target;
- previous submitted file remains downloadable before replacement;
- the download button is outside the file-picker label;
- backend, database, and unrelated user changes are untouched.

- [ ] **Step 7: Clean caches, restart services, and create the single final commit**

Remove only generated caches under source and test directories, excluding the virtual environment and `node_modules`:

```bash
find backend/app backend/tests frontend/src frontend/tests -type d \
  \( -name __pycache__ -o -name .pytest_cache -o -name '*.egg-info' \) \
  -prune -exec rm -r {} +
```

The main agent then stops the tracked local service processes and restarts without Docker:

```bash
cd backend
./.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

```bash
cd frontend
../.local/node/bin/node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 5173
```

Verify from process output that FastAPI completed application startup and Vite reports port `5173` ready. Do not run browser automation.

Stage only the three implementation files and commit once:

```bash
git add frontend/src/features/academic-flow/api.ts frontend/src/features/academic-flow/StudentRuntimePage.tsx frontend/src/styles.css
git commit -m "feat: add uploaded file download and replacement gating"
```

Do not stage the user's existing `AGENTS.md`, `INSTALL.md`, or `MEMORY.md` changes.
