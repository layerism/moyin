# Node Time Field Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add independent webpage-level confirmation buttons for the node start and deadline fields so native date-time selections do not update the node until explicitly confirmed.

**Architecture:** Keep the browser-native `datetime-local` inputs and the existing `onUpdateNode` data path. Store one local draft string per field inside `NodeInspector`, synchronize each draft independently with its confirmed node value, and commit only the selected field when its adjacent confirmation button is clicked.

**Tech Stack:** React 18 hooks, TypeScript, native `datetime-local`, CSS Grid, Vite.

## Global Constraints

- Work on the current branch.
- Preserve the existing user changes in `AGENTS.md`, `docs/05_oa_graph.md`, and `.superpowers/`.
- Modify only `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx` and `frontend/src/styles.css`.
- Do not modify the browser-native date-time panel; the confirmation buttons belong to the webpage.
- Do not modify backend files, API signatures, `AcademicFlowNode`, `commitDesignChange`, database state, or publication rules.
- Do not add dependencies, custom calendar components, shared abstractions, or new source files.
- Start and deadline must keep independent draft and confirmation behavior.
- Confirmation must update only its own field and must not close the node settings modal.
- Closing the node settings modal must discard unconfirmed draft values.
- Clearing a field must immediately clear both its confirmed node value and local draft.
- Existing time status, summary validation, revision permissions, and outer `fieldset` locking must remain.
- Desktop and narrow layouts must show the input, “确认”, and “清除” without clipping.
- Do not run automated tests, builds, TypeScript compilation, browser automation, or Browser-plugin validation.
- Perform only static state-flow/style inspection, cache cleanup outside `backend/.venv`, local service restart, and listener checks.
- Make one implementation commit after all code changes; do not make intermediate implementation commits.

---

### Task 1: Add independent draft-and-confirm behavior to both node time fields

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:1361-1471`
- Modify: `frontend/src/styles.css:2346-2372`
- Modify: `frontend/src/styles.css:4960-4973`
- Reference: `docs/superpowers/specs/2026-07-24-node-time-field-confirmation-design.md`

**Interfaces:**
- Consumes: `node.startAt`, `node.deadlineAt`, `toLocalDateTime(value)`, and `onUpdateNode(nodeId, patch)`.
- Produces: `startAtDraft: string`, `deadlineAtDraft: string`, field-local confirmation actions, `.node-time-window-confirm`, and responsive three-control field layouts.

- [ ] **Step 1: Reconfirm the implementation boundary before editing**

Run:

```bash
git status --short
git diff -- frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/styles.css
```

Expected:

- Existing unrelated changes remain limited to files already present before this task.
- Neither target file contains an uncommitted user edit. If either target file is already modified, stop and reconcile the overlap before editing.

- [ ] **Step 2: Add independent local drafts and synchronization effects**

Inside `NodeInspector`, after the existing body-scroll `useEffect` and before `if (!node)`, add:

```tsx
const [startAtDraft, setStartAtDraft] = useState("");
const [deadlineAtDraft, setDeadlineAtDraft] = useState("");

useEffect(() => {
  setStartAtDraft(node?.startAt ? toLocalDateTime(node.startAt) : "");
}, [node?.id, node?.startAt]);

useEffect(() => {
  setDeadlineAtDraft(node?.deadlineAt ? toLocalDateTime(node.deadlineAt) : "");
}, [node?.id, node?.deadlineAt]);
```

Use separate effects. A start-time confirmation must not overwrite an unconfirmed deadline draft, and a deadline confirmation must not overwrite an unconfirmed start draft.

After the null guard and existing capability derivations, derive the confirmed local values:

```tsx
const confirmedStartAt = node.startAt ? toLocalDateTime(node.startAt) : "";
const confirmedDeadlineAt = node.deadlineAt ? toLocalDateTime(node.deadlineAt) : "";
```

These strings are the comparison baseline for enabling each confirmation button.

- [ ] **Step 3: Replace immediate start-time updates with draft, confirm, and synchronized clear**

Replace the current start-time `<label>` with:

```tsx
<label>
  <span>起始时间</span>
  <input
    type="datetime-local"
    value={startAtDraft}
    onChange={(event) => setStartAtDraft(event.target.value)}
  />
  <button
    className="node-time-window-confirm"
    disabled={!startAtDraft || startAtDraft === confirmedStartAt}
    onClick={() => onUpdateNode(node.id, {
      startAt: new Date(startAtDraft).toISOString(),
    })}
    type="button"
  >
    确认
  </button>
  {node.startAt ? (
    <button
      onClick={() => {
        setStartAtDraft("");
        onUpdateNode(node.id, { startAt: null });
      }}
      type="button"
    >
      清除
    </button>
  ) : null}
</label>
```

The input now changes only `startAtDraft`. The existing node value, status badge, and summary remain unchanged until “确认” calls `onUpdateNode`.

- [ ] **Step 4: Replace immediate deadline updates with draft, confirm, and synchronized clear**

Replace the current deadline `<label>` with:

```tsx
<label>
  <span>截止时间</span>
  <input
    type="datetime-local"
    value={deadlineAtDraft}
    onChange={(event) => setDeadlineAtDraft(event.target.value)}
  />
  <button
    className="node-time-window-confirm"
    disabled={!deadlineAtDraft || deadlineAtDraft === confirmedDeadlineAt}
    onClick={() => onUpdateNode(node.id, {
      deadlineAt: new Date(deadlineAtDraft).toISOString(),
    })}
    type="button"
  >
    确认
  </button>
  {node.deadlineAt ? (
    <button
      onClick={() => {
        setDeadlineAtDraft("");
        onUpdateNode(node.id, { deadlineAt: null });
      }}
      type="button"
    >
      清除
    </button>
  ) : null}
</label>
```

The two fields remain independent. Confirming one field must not close `NodeInspector` or commit the other field’s draft.

- [ ] **Step 5: Extend the time-field CSS for confirm and clear controls**

In `frontend/src/styles.css`, replace:

```css
.node-time-window-fields label {
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto;
}
```

with:

```css
.node-time-window-fields label {
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto auto;
}
```

Keep the existing shared button rule, then add:

```css
.node-time-window-fields label > .node-time-window-confirm {
  border-color: #2874f6;
  background: #2874f6;
  color: #fff;
}

.node-time-window-fields label > .node-time-window-confirm:disabled {
  cursor: not-allowed;
  border-color: #cbd5e1;
  background: #e2e8f0;
  color: #94a3b8;
}
```

Inside the existing `@media (max-width: 760px)` block, after `.node-time-window-fields`, add:

```css
.node-time-window-fields label {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.node-time-window-fields label > input {
  grid-column: 1 / -1;
}

.node-time-window-fields label > button {
  width: 100%;
}

.node-time-window-fields label > button:only-of-type {
  grid-column: 1 / -1;
}
```

On narrow screens, the input occupies the full first row. “确认”和“清除” share the second row; when only “确认” exists, it spans the full row.

- [ ] **Step 6: Perform the project-approved static audit**

Run:

```bash
rg -n "startAtDraft|deadlineAtDraft|confirmedStartAt|confirmedDeadlineAt|node-time-window-confirm" frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/styles.css
rg -n "type=\"datetime-local\"|setStartAtDraft|setDeadlineAtDraft|onUpdateNode\\(node.id, \\{ startAt|onUpdateNode\\(node.id, \\{ deadlineAt" frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
git diff --check -- frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/styles.css
git diff -- frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/styles.css
```

Expected:

- Two independent draft states and two independent synchronization effects exist.
- The `datetime-local` `onChange` handlers update only local draft state.
- `onUpdateNode` for `startAt` and `deadlineAt` appears only in the corresponding confirm and clear actions within the time card.
- Confirm buttons are disabled for empty or unchanged drafts.
- The status badge and `getTimeWindowSummary(node)` still consume confirmed node values.
- `git diff --check` produces no output.
- The diff contains only the approved component and time-window CSS changes.

Do not run `npm test`, `npm run build`, TypeScript compilation, Playwright, Browser-plugin actions, or browser automation.

- [ ] **Step 7: Clean project-generated caches without touching the virtual environment**

Enumerate only project caches outside `backend/.venv`:

```bash
find backend frontend \
  -path 'backend/.venv' -prune -o \
  -type d \( -name '.pytest_cache' -o -name '__pycache__' -o -name '*.egg-info' \) \
  -print
```

Remove only the exact paths printed by that command. Do not remove anything inside `backend/.venv`, `frontend/node_modules`, or the user-owned `.superpowers` tree.

- [ ] **Step 8: Restart local services without Docker**

Resolve exact listeners:

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

Confirm listener ownership:

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

Expected: Uvicorn listens on `127.0.0.1:8000` and Vite listens on `127.0.0.1:5173`. Do not use Docker and do not open or automate a browser.

- [ ] **Step 9: Create the single final implementation checkpoint**

Reconfirm the exact staged scope:

```bash
git status --short
git diff -- frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/styles.css
git add frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/styles.css
git diff --cached --stat
git diff --cached --check
```

Expected: only the two approved frontend files are staged; pre-existing changes remain unstaged.

Commit:

```bash
git commit -m "feat: confirm node time changes explicitly"
```

Hand the running application back to the user for manual verification against the eleven acceptance criteria in the design document.
