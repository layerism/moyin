### Task 1: Replace the table-row editor with an isolated secondary modal

**Files:**
- Modify: `frontend/src/features/academic-flow/TeacherProgressPanel.tsx:1-228`
- Modify: `frontend/src/styles.css:4712-4811`
- Modify: `frontend/src/styles.css:4936-4943`
- Reference: `docs/superpowers/specs/2026-07-23-student-deadline-modal-redesign-design.md`

**Interfaces:**
- Consumes: `WorkflowProgressStudent`, `WorkflowProgressNode`, `workflowApi.setStudentDeadline(instanceId, nodeKey, deadlineAt, reason)`, and the existing `extension` draft shape.
- Produces: local `editingInstanceId: string | null`, `openExtension(student)`, `clearExtension()`, trigger-button focus restoration, and the CSS hooks `.student-extension-backdrop`, `.student-extension-dialog`, `.student-extension-dialog-body`, `.student-extension-fields`, and `.student-extension-actions`.

- [ ] **Step 1: Reconfirm the implementation boundary before editing**

Run:

```bash
git status --short
git diff -- frontend/src/features/academic-flow/TeacherProgressPanel.tsx frontend/src/styles.css
```

Expected:

- Existing unrelated changes remain limited to files already present before this task.
- Neither target file contains an uncommitted user edit. If either target file is already modified, stop and reconcile that overlap before editing.

- [ ] **Step 2: Convert the component state and trigger from row expansion to modal editing**

In `TeacherProgressPanel.tsx`, replace the React import and the expansion state with refs and modal state:

```tsx
import { useEffect, useRef, useState } from "react";
```

```tsx
const [editingInstanceId, setEditingInstanceId] = useState<string | null>(null);
const [savingExtension, setSavingExtension] = useState(false);
const dialogRef = useRef<HTMLElement>(null);
const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
```

Replace `clearExtension` and `toggleExtension` with:

```tsx
const clearExtension = () => {
  const trigger = editingInstanceId
    ? triggerRefs.current.get(editingInstanceId)
    : undefined;
  setEditingInstanceId(null);
  setExtension({ deadline: "", nodeKey: "", reason: "批准个别延期" });
  if (trigger) {
    window.requestAnimationFrame(() => trigger.focus());
  }
};

const openExtension = (student: WorkflowProgressStudent) => {
  const eligibleNodes = student.nodes.filter(
    (node) => node.status !== "approved" && node.effectiveDeadline,
  );
  setEditingInstanceId(student.instanceId);
  setExtension({
    deadline: "",
    nodeKey: eligibleNodes[0]?.nodeKey ?? "",
    reason: "批准个别延期",
  });
};
```

Add a modal lifecycle effect after the existing progress-loading effect:

```tsx
useEffect(() => {
  if (!editingInstanceId) {
    return;
  }
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  const focusFrame = window.requestAnimationFrame(() => dialogRef.current?.focus());
  return () => {
    window.cancelAnimationFrame(focusFrame);
    document.body.style.overflow = previousOverflow;
  };
}, [editingInstanceId]);
```

Derive the selected student and node once, before `return`:

```tsx
const editingStudent = progress?.students.find(
  (student) => student.instanceId === editingInstanceId,
) ?? null;
const eligibleNodes = editingStudent?.nodes.filter(
  (node) => node.status !== "approved" && node.effectiveDeadline,
) ?? [];
const currentNode = eligibleNodes.find((node) => node.nodeKey === extension.nodeKey);
```

This preserves the current filtering and save API contract while removing duplicated per-row editor state.

- [ ] **Step 3: Render plain student rows and add the modal as a sibling of the progress backdrop**

Inside `progress.students.map`, replace the `Fragment`, `isExpanded`, per-row node calculations, and conditional extension row with one keyed `<tr>`. The action cell must be:

```tsx
<button
  aria-haspopup="dialog"
  className="progress-extension-trigger"
  onClick={() => openExtension(student)}
  ref={(element) => {
    if (element) {
      triggerRefs.current.set(student.instanceId, element);
    } else {
      triggerRefs.current.delete(student.instanceId);
    }
  }}
  type="button"
>
  设置延期
</button>
```

Wrap the existing progress backdrop and the new modal in a React fragment. Mark the progress panel unavailable to assistive technology while the secondary modal is open:

```tsx
<aside
  aria-hidden={editingStudent ? true : undefined}
  className="teacher-progress-panel"
  role="dialog"
  aria-modal="true"
  onMouseDown={(event) => event.stopPropagation()}
>
```

After the closing tag of `.inspector-backdrop`, render:

```tsx
{editingStudent ? (
  <div className="student-extension-backdrop" role="presentation">
    <section
      aria-labelledby="student-extension-dialog-title"
      aria-modal="true"
      className="student-extension-dialog"
      ref={dialogRef}
      role="dialog"
      tabIndex={-1}
    >
      <header>
        <div>
          <span>个别节点延期</span>
          <h3 id="student-extension-dialog-title">设置节点延期</h3>
          <p>{editingStudent.name}（{editingStudent.studentNo}）</p>
        </div>
        <button
          aria-label="关闭节点延期设置"
          onClick={clearExtension}
          type="button"
        >
          ×
        </button>
      </header>

      <div className="student-extension-dialog-body">
        {eligibleNodes.length === 0 ? (
          <p className="student-extension-empty">该学生当前没有可延期节点</p>
        ) : (
          <div className="student-extension-fields">
            <label className="student-extension-field">
              <span>节点</span>
              <select
                value={extension.nodeKey}
                onChange={(event) => setExtension({
                  ...extension,
                  nodeKey: event.target.value,
                  deadline: "",
                })}
              >
                {eligibleNodes.map((node) => (
                  <option key={node.nodeKey} value={node.nodeKey}>
                    {node.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="student-extension-field">
              <span>当前生效截止时间</span>
              <output className="student-extension-deadline">
                {currentNode?.effectiveDeadline
                  ? new Date(currentNode.effectiveDeadline).toLocaleString("zh-CN")
                  : "未设置"}
              </output>
            </div>
            <label className="student-extension-field">
              <span>新截止时间</span>
              <input
                min={currentNode?.effectiveDeadline
                  ? minimumExtensionValue(currentNode.effectiveDeadline)
                  : undefined}
                type="datetime-local"
                value={extension.deadline}
                onChange={(event) => setExtension({
                  ...extension,
                  deadline: event.target.value,
                })}
              />
            </label>
            <label className="student-extension-field">
              <span>延期原因</span>
              <input
                maxLength={500}
                value={extension.reason}
                onChange={(event) => setExtension({
                  ...extension,
                  reason: event.target.value,
                })}
              />
            </label>
          </div>
        )}
      </div>

      <footer className="student-extension-actions">
        <button
          className="student-extension-cancel"
          onClick={clearExtension}
          type="button"
        >
          取消
        </button>
        {eligibleNodes.length > 0 ? (
          <button
            className="primary-action"
            disabled={savingExtension}
            onClick={() => void saveExtension(editingStudent.instanceId, currentNode)}
            type="button"
          >
            {savingExtension ? "保存中…" : "保存延期"}
          </button>
        ) : null}
      </footer>
    </section>
  </div>
) : null}
```

Do not attach a click or mouse-down close handler to `.student-extension-backdrop`. This is the mechanism that makes backdrop clicks inert.

- [ ] **Step 4: Replace the row-card CSS with modal, fixed-header/footer, and explicit button styles**

Keep `.progress-extension-trigger`, then replace the old rules from `.student-extension-row > td` through `.student-extension-cancel` with:

```css
.student-extension-backdrop {
  position: fixed;
  z-index: 150;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(16 24 40 / 48%);
}

.student-extension-dialog {
  width: min(680px, 100%);
  max-height: calc(100vh - 48px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  border: 1px solid #d8dee8;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 24px 64px rgb(16 24 40 / 28%);
  outline: none;
}

.student-extension-dialog > header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 18px;
  padding: 20px 22px 16px;
  border-bottom: 1px solid #e4e7ec;
}

.student-extension-dialog > header span {
  color: #175cd3;
  font-size: 12px;
  font-weight: 800;
}

.student-extension-dialog > header h3 {
  margin: 4px 0 0;
  font-size: 20px;
}

.student-extension-dialog > header p {
  margin: 5px 0 0;
  color: #667085;
  font-size: 13px;
}

.student-extension-dialog > header button {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border: 1px solid #d8dee8;
  border-radius: 6px;
  background: #fff;
  color: #344054;
  font-size: 22px;
}

.student-extension-dialog-body {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 20px 22px;
}

.student-extension-empty {
  margin: 0;
  padding: 18px;
  border: 1px dashed #b2ccff;
  border-radius: 8px;
  background: #f5f8ff;
  color: #475467;
}

.student-extension-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.student-extension-field {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.student-extension-field > span {
  color: #344054;
  font-size: 13px;
  font-weight: 700;
}

.student-extension-field > input,
.student-extension-field > select {
  width: 100%;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid #cfd7e5;
  border-radius: 6px;
  background: #fff;
  color: #172033;
}

.student-extension-deadline {
  min-height: 40px;
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 0 12px;
  overflow-wrap: anywhere;
  border: 1px solid #d0d5dd;
  border-radius: 6px;
  background: #fff;
}

.student-extension-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin: 0;
  padding: 14px 22px;
  border-top: 1px solid #e4e7ec;
  background: #f8fafc;
}

.student-extension-actions button {
  min-width: 92px;
  min-height: 38px;
  padding: 0 16px;
  border-radius: 6px;
  font-weight: 700;
  white-space: nowrap;
}

.student-extension-actions .primary-action {
  border: 1px solid #2874f6;
  background: #2874f6;
  color: #fff;
}

.student-extension-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.student-extension-cancel {
  border: 1px solid #98a2b3;
  background: #fff;
  color: #344054;
}
```

Update the focus-visible selector to cover the new close button:

```css
.progress-extension-trigger:focus-visible,
.student-extension-dialog > header button:focus-visible,
.student-extension-actions button:focus-visible {
  outline: 2px solid #84adff;
  outline-offset: 2px;
}
```

Inside the existing `@media (max-width: 760px)` block, replace the old extension rules with:

```css
.student-extension-backdrop {
  padding: 12px;
}

.student-extension-dialog {
  max-height: calc(100vh - 24px);
}

.student-extension-dialog > header,
.student-extension-dialog-body {
  padding-right: 16px;
  padding-left: 16px;
}

.student-extension-fields {
  grid-template-columns: 1fr;
}

.student-extension-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding-right: 16px;
  padding-left: 16px;
}

.student-extension-actions button {
  width: 100%;
  min-width: 0;
}
```

- [ ] **Step 5: Perform the project-approved static audit**

Run:

```bash
rg -n "expandedInstanceId|toggleExtension|student-extension-row|student-extension-card" frontend/src/features/academic-flow/TeacherProgressPanel.tsx frontend/src/styles.css
rg -n "editingInstanceId|openExtension|student-extension-backdrop|student-extension-dialog|student-extension-actions" frontend/src/features/academic-flow/TeacherProgressPanel.tsx frontend/src/styles.css
rg -n "setStudentDeadline|minimumExtensionValue|请选择新的截止时间|请填写延期原因|新的截止时间必须晚于" frontend/src/features/academic-flow/TeacherProgressPanel.tsx
git diff --check -- frontend/src/features/academic-flow/TeacherProgressPanel.tsx frontend/src/styles.css
git diff -- frontend/src/features/academic-flow/TeacherProgressPanel.tsx frontend/src/styles.css
```

Expected:

- The first `rg` produces no matches.
- The second `rg` shows one coherent modal state/render/style path.
- The third `rg` confirms all existing validation and API calls remain.
- `git diff --check` produces no output.
- The diff contains only the modal refactor and related CSS; no backend, API, data model, or unrelated UI changes.

Do not run `npm test`, `npm run build`, TypeScript compilation, Playwright, Browser-plugin actions, or browser automation.

- [ ] **Step 6: Clean project-generated caches without touching the virtual environment**

First enumerate only project caches outside `backend/.venv`:

```bash
find backend frontend \
  -path 'backend/.venv' -prune -o \
  -type d \( -name '.pytest_cache' -o -name '__pycache__' -o -name '*.egg-info' \) \
  -print
```

Remove only the exact paths printed by that command. Do not remove any `__pycache__` directory inside `backend/.venv`, and do not remove `frontend/node_modules`.

Expected: no implementation-generated `.pytest_cache`, `__pycache__`, or `*.egg-info` directories remain outside the virtual environment.

- [ ] **Step 7: Restart the existing local services without Docker**

Resolve only the exact listeners:

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

Send `TERM` only to the PIDs returned for those two ports. Then start:

```bash
cd backend
.venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

```bash
cd frontend
npm run dev -- --host 127.0.0.1
```

Confirm listener ownership without exercising the UI:

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

Expected: local Uvicorn listens on `127.0.0.1:8000` and Vite listens on `127.0.0.1:5173`. Do not use Docker and do not open or automate a browser.

- [ ] **Step 8: Create the single final implementation checkpoint**

Reconfirm the exact staged scope:

```bash
git status --short
git diff -- frontend/src/features/academic-flow/TeacherProgressPanel.tsx frontend/src/styles.css
git add frontend/src/features/academic-flow/TeacherProgressPanel.tsx frontend/src/styles.css
git diff --cached --stat
git diff --cached --check
```

Expected: only the two approved frontend files are staged; pre-existing changes remain unstaged.

Commit:

```bash
git commit -m "fix: move student deadline editor into modal"
```

After the commit, hand the running application back to the user for manual verification against the ten acceptance criteria in the design document.
