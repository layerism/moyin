# Runtime Confirmation Attention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent unconfirmed announcement and confirmation nodes from submitting, while directing the student to the checkbox with local motion, error styling, text, and focus.

**Architecture:** Keep the submit API and runtime state model unchanged. Add a local confirmation-validation state and input ref inside `RuntimeNodeDialog`, then express the feedback through existing React rendering and project CSS, including a reduced-motion override.

**Tech Stack:** React 18, TypeScript, CSS.

## Global Constraints

- Apply the confirmation requirement to both `confirmation` and `announcement` nodes.
- Do not change draft saving, backend APIs, database structures, node state transitions, or scan submission rules.
- Preserve the existing form, file, and scan validation order.
- Use the existing red error language and do not introduce a new visual system.
- Preserve unrelated user changes in the working tree.
- Per project instructions, do not run tests or browser automation; perform source-level business-logic auditing only.
- The managed checkout exposes `.git` as read-only, so checkpoint and result commits cannot be created in this session.

---

### Task 1: Add local confirmation validation and attention feedback

**Files:**
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx:1,440-542,686-695`
- Modify: `frontend/src/styles.css:5681-5689`

**Interfaces:**
- Consumes: `draft.confirmed`, `node.kind`, `onUpdate(field, value)`, and the existing `handleSubmit()` path.
- Produces: local `confirmationAttempted: boolean`, `confirmationInputRef: RefObject<HTMLInputElement>`, and confirmation error markup/styles.

- [x] **Step 1: Add confirmation state and input focus support**

Import `useRef` from React. In `RuntimeNodeDialog`, add:

```tsx
const [confirmationAttempted, setConfirmationAttempted] = useState(false);
const confirmationInputRef = useRef<HTMLInputElement>(null);
```

Derive the validation state next to the existing submit blockers:

```tsx
const confirmationRequired = node.kind === "confirmation" || node.kind === "announcement";
const confirmationMissing = confirmationRequired && draft.confirmed !== true;
const confirmationInvalid = confirmationAttempted && confirmationMissing;
```

- [x] **Step 2: Preserve scan blockers while allowing confirmation feedback**

Change the final scan blocker term in `submitDisabled` to:

```tsx
|| Boolean(scanBlocker && !confirmationMissing);
```

This keeps non-confirmation scan prerequisites disabled. When confirmation is the first unresolved condition, the button remains clickable so `handleSubmit` can show the local checkbox feedback; after the checkbox is selected, any remaining scan blocker disables submission as before.

- [x] **Step 3: Stop unconfirmed submissions and focus the checkbox**

After the existing form-field error branch and before `onSubmit()`, add:

```tsx
if (confirmationMissing) {
  setConfirmationAttempted(true);
  window.requestAnimationFrame(() => confirmationInputRef.current?.focus());
  return;
}
```

The early return must prevent `onSubmit` and therefore prevent the submission API call.

- [x] **Step 4: Render the accessible local error state**

Replace the existing confirmation label with a wrapper and error-aware markup:

```tsx
<div className="runtime-confirmation-field">
  <label className={`runtime-confirmation${confirmationInvalid ? " is-invalid" : ""}`}>
    <input
      aria-describedby={confirmationInvalid ? "runtime-confirmation-error" : undefined}
      aria-invalid={confirmationInvalid || undefined}
      checked={Boolean(draft.confirmed)}
      ref={confirmationInputRef}
      type="checkbox"
      onChange={(event) => {
        if (event.target.checked) setConfirmationAttempted(false);
        onUpdate("confirmed", event.target.checked);
      }}
    />
    <span>我已阅读并确认以上内容</span>
  </label>
  {confirmationInvalid ? (
    <p id="runtime-confirmation-error" role="alert">请先勾选确认</p>
  ) : null}
</div>
```

Only one runtime node dialog is open at a time, so the fixed error ID remains unique in the rendered document.

- [x] **Step 5: Add red highlight, shake animation, and reduced-motion handling**

Extend the existing confirmation styles with:

```css
.runtime-confirmation-field {
  display: grid;
  gap: 6px;
}

.runtime-confirmation {
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
}

.runtime-confirmation.is-invalid {
  border-color: #f04438;
  background: #fff5f5;
  animation: runtime-confirmation-attention 320ms ease-in-out;
}

.runtime-confirmation-field > p {
  margin: 0;
  color: #d92d20;
  font-size: 13px;
  font-weight: 700;
}

@keyframes runtime-confirmation-attention {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-5px); }
  75% { transform: translateX(5px); }
}

@media (prefers-reduced-motion: reduce) {
  .runtime-confirmation.is-invalid {
    animation: none;
  }
}
```

Keep the existing `.runtime-confirmation span` rule after these declarations.

- [x] **Step 6: Audit all behavior branches**

Read the completed `RuntimeNodeDialog` validation, confirmation markup, and CSS. Confirm:

```text
form invalid -> existing field error flow runs first
announcement/confirmation unchecked -> no onSubmit; focus checkbox; highlight and message
checkbox checked -> clear local error immediately
confirmation with scan blockers unchecked -> button can expose confirmation feedback
confirmation checked with scan blocker -> existing blocker disables submission
form/file nodes -> existing submission behavior unchanged
reduced motion -> no shake; red highlight and message remain
```

Run only the non-test checks permitted by the project:

```bash
sed -n '1,20p;435,555p;675,715p' frontend/src/features/academic-flow/StudentRuntimePage.tsx
sed -n '5675,5745p' frontend/src/styles.css
rg -n "confirmationAttempted|confirmationMissing|runtime-confirmation-error|runtime-confirmation-attention|prefers-reduced-motion" frontend/src/features/academic-flow/StudentRuntimePage.tsx frontend/src/styles.css
git diff --check -- frontend/src/features/academic-flow/StudentRuntimePage.tsx frontend/src/styles.css
git diff -- frontend/src/features/academic-flow/StudentRuntimePage.tsx frontend/src/styles.css
```

Expected result: the missing-confirmation branch precedes `onSubmit`; the checkbox clears the local error; CSS includes both motion and reduced-motion behavior; the diff contains no unrelated source changes.

- [x] **Step 7: Perform project closeout**

Remove only project-generated `.pytest_cache`, `__pycache__`, and `*.egg-info` artifacts if present. Restart the existing backend from `backend/` on port `8000` and frontend with the repository Node.js environment on port `5173`, stopping only processes confirmed to belong to this project. Report that tests and browser checks were not run.

If `.git` becomes writable, create the result checkpoint with only this task's files:

```bash
git add frontend/src/features/academic-flow/StudentRuntimePage.tsx \
  frontend/src/styles.css \
  docs/superpowers/specs/2026-08-17-runtime-confirmation-attention-design.md \
  docs/superpowers/plans/2026-08-17-runtime-confirmation-attention.md
git commit -m "feat: highlight missing node confirmation"
```
