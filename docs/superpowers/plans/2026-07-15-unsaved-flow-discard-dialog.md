# Unsaved Flow Discard Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flow designer's native internal-navigation confirmation with an accessible project-styled warning dialog.

**Architecture:** Store one pending navigation action and destination label in `AcademicFlowDesigner`. Render a focused `UnsavedChangesDialog`; cancel clears the pending action, while confirm clears it and executes the original navigation callback.

**Tech Stack:** React 18, TypeScript, existing project CSS.

## Global Constraints

- Do not change the browser `beforeunload` protection.
- Do not show the dialog for submit publish or republish.
- Do not run automated tests until the user authorizes them.
- Preserve unrelated user files.

---

### Task 1: Add the internal-navigation warning dialog

**Files:**
- Create: `frontend/src/features/academic-flow/UnsavedChangesDialog.tsx`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: `destination`, `onCancel`, and `onConfirm`.
- Produces: an accessible modal and a deferred navigation callback.

- [ ] **Step 1: Create the dialog component**

```tsx
<section aria-labelledby="unsaved-changes-title" aria-modal="true" role="dialog">
  <h2 id="unsaved-changes-title">放弃未发布的修改？</h2>
  <p>当前修改仅保存在本页面。离开后将无法恢复，但已发布版本不会受到影响。</p>
  <p>即将前往：{destination}</p>
  <button autoFocus onClick={onCancel}>继续编辑</button>
  <button className="danger-action" onClick={onConfirm}>放弃修改并离开</button>
</section>
```

Handle `Escape` as cancel, provide a close button, and prevent backdrop clicks from dismissing the dialog.

- [ ] **Step 2: Replace `window.confirm` with deferred navigation state**

```ts
type PendingNavigation = { destination: string; run: () => void };
const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
```

`requestNavigation(destination, run)` executes immediately when clean; otherwise it stores the action. Bind the three destinations to `教务流程列表`, `首页`, and `学生填写页面`.

- [ ] **Step 3: Add project-consistent styling**

Reuse the revision-impact backdrop and dialog visual language with a narrower width, warning block, right-aligned actions, responsive padding, and red danger button.

- [ ] **Step 4: Perform static review only**

Run `git diff --check` and search for remaining internal `window.confirm` usage. Do not run tests or build commands.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/academic-flow/UnsavedChangesDialog.tsx frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/styles.css
git commit -m "Add unsaved flow warning dialog"
```

- [ ] **Step 6: Ask whether to test**

Offer manual browser verification or automated frontend checks after implementation.
