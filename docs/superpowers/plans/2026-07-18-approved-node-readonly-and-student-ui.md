# Approved Node Readonly and Student UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let students reopen approved nodes in a strictly read-only view and modernize the student DAG page without changing workflow state transitions.

**Architecture:** The instance API will expose the immutable `submissions.payload_snapshot` for the node's current attempt as an additive `submission` field. The student page will distinguish editable drafts from read-only submissions, while the topology and stylesheet use the existing component structure for status-aware cards, progress metrics, and responsive dialogs.

**Tech Stack:** FastAPI repository layer, SQLite JSON text snapshots, React, TypeScript, CSS.

## Global Constraints

- Do not change database schema, audit behavior, DAG state transitions, or file-storage access.
- Do not add dependencies, routes, download/preview capability, or a separate submission-history UI.
- Keep `approved` rejected by draft, upload, and submit server-side paths.
- Do not run automated tests, builds, or browser tests; perform source-level static audit only.
- Preserve unrelated working-tree changes and create only the final feature commit after this plan checkpoint.

---

### Task 1: Return the current submission snapshot with each node instance

**Files:**
- Modify: `backend/app/repositories/flow_instances.py:129-166`

**Interfaces:**
- Consumes: the current-attempt `submissions` join keyed by `node_instances.attempt_no`.
- Produces: each `nodeInstances` item has `submission: dict[str, object]`, parsed from `s.payload_snapshot`, or `{}` when no current submission exists or its JSON is invalid.

- [ ] **Step 1: Extend the existing current-attempt query**

```sql
SELECT n.*, d.payload AS draft_payload,
       s.payload_snapshot AS submission_payload,
       j.status AS audit_job_status, j.attempt_count AS audit_attempt_count,
       j.result_json AS audit_result_json
```

- [ ] **Step 2: Parse the additive snapshot safely while serializing node instances**

```python
submission = _json_object(row["submission_payload"])
nodes.append({
    # existing fields
    "submission": submission,
})
```

Use a small local helper that returns `{}` for `None`, malformed JSON, or non-object JSON so old/corrupt history remains viewable but never editable.

- [ ] **Step 3: Perform source-level audit**

Run: `git diff --check -- backend/app/repositories/flow_instances.py`

Expected: no whitespace errors; only the response query and node-instance payload change.

### Task 2: Model the snapshot and reopen approved topology nodes

**Files:**
- Modify: `frontend/src/features/academic-flow/runtimeTypes.ts:66-78`
- Modify: `frontend/src/features/academic-flow/StudentFlowTopology.tsx:28-37, 172-188`

**Interfaces:**
- Consumes: `submission` returned by Task 1.
- Produces: `RuntimeNodeInstance.submission: Record<string, unknown>` and topology buttons that open `approved` nodes in addition to the existing viewable statuses.

- [ ] **Step 1: Add the runtime type field**

```ts
submission: Record<string, unknown>;
```

- [ ] **Step 2: Include approved nodes in the existing openable status set**

```ts
const openableStatuses = new Set<RuntimeNodeStatus>([
  "approved", "available", "audit_error", "draft", "rejected", "reviewing",
]);
```

- [ ] **Step 3: Give approved nodes an explicit accessible status label**

```tsx
<i>{runtime.status === "approved" ? "已完成 · 可查看" : statusLabels[runtime.status]}</i>
```

- [ ] **Step 4: Perform source-level audit**

Run: `git diff --check -- frontend/src/features/academic-flow/runtimeTypes.ts frontend/src/features/academic-flow/StudentFlowTopology.tsx`

Expected: no API write path changes; only data typing and openability/status copy change.

### Task 3: Render editable and read-only node content from separate values

**Files:**
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx:20-371`

**Interfaces:**
- Consumes: `runtime.draft` for writable statuses and `runtime.submission` for `approved`.
- Produces: an approved-node dialog with a completion banner, submitted timestamp, read-only form/confirmation/file summary, and no write actions.

- [ ] **Step 1: Remove automatic closing of approved dialogs**

Delete the effect that calls `setActiveNodeKey(null)` when `activeRuntime?.status === "approved"`.

- [ ] **Step 2: Derive the displayed payload once in `RuntimeNodeDialog`**

```ts
const readonly = runtime.status === "approved";
const displayedPayload = readonly ? runtime.submission : draft;
```

- [ ] **Step 3: Render a read-only completion block before the content**

```tsx
{readonly ? (
  <section className="runtime-completion-banner">
    <strong>已完成 · 提交内容已锁定</strong>
    <span>提交时间：{formatDateTime(runtime.submittedAt)}</span>
  </section>
) : null}
```

- [ ] **Step 4: Split content rendering by `readonly` without changing write handlers**

```tsx
{readonly ? (
  <ReadonlySubmission node={node} payload={displayedPayload} submittedAt={runtime.submittedAt} />
) : writable ? (
  <div className="runtime-node-form">{/* existing editable controls */}</div>
) : /* existing audit/error hint */ null}
```

`ReadonlySubmission` must render form field labels and values, confirmation text, or a file summary with `name`, formatted `size`, and `submittedAt`. Missing values display `未记录`; it must not render file input or action buttons.

- [ ] **Step 5: Add progress metrics from existing runtime statuses**

```ts
const progress = {
  approved: instance.nodeInstances.filter((node) => node.status === "approved").length,
  available: instance.nodeInstances.filter((node) => ["available", "draft", "rejected"].includes(node.status)).length,
  reviewing: instance.nodeInstances.filter((node) => node.status === "reviewing").length,
};
```

Render these as three text-labeled summary cards above `StudentFlowTopology`; do not make additional API requests.

- [ ] **Step 6: Perform source-level audit**

Run: `git diff --check -- frontend/src/features/academic-flow/StudentRuntimePage.tsx`

Expected: approved state has no save/upload/submit/retry event binding; existing editable paths keep their handlers unchanged.

### Task 4: Apply the modern status-card and dialog visual system

**Files:**
- Modify: `frontend/src/styles.css:3275-3995`

**Interfaces:**
- Consumes: existing `student-topology-node <status>` classes plus new `runtime-progress-grid`, `runtime-progress-card`, `runtime-completion-banner`, `runtime-readonly-submission`, and `runtime-file-summary` classes from Task 3.
- Produces: clear semantic status cards, keyboard focus feedback, completion/read-only emphasis, and a one-column narrow-screen layout.

- [ ] **Step 1: Add card treatment and interaction feedback to existing topology statuses**

```css
.student-topology-node:not(:disabled):is(:hover, :focus-visible) {
  transform: translateY(-2px);
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.12);
}
.student-topology-node:focus-visible { outline: 3px solid #84adff; outline-offset: 3px; }
```

- [ ] **Step 2: Style the progress cards and approved-node completion banner**

```css
.runtime-progress-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.runtime-completion-banner { border: 1px solid #86efac; background: #f0fdf4; color: #166534; }
```

Use the established blue, green, purple, red, and slate semantic palette; do not introduce animation libraries or non-semantic color-only controls.

- [ ] **Step 3: Style read-only values and file metadata as content cards**

```css
.runtime-readonly-submission,
.runtime-file-summary { border: 1px solid #d8dee8; border-radius: 12px; background: #fafbfc; }
```

- [ ] **Step 4: Extend the existing narrow-screen media query**

```css
@media (max-width: 760px) {
  .runtime-progress-grid { grid-template-columns: 1fr; }
}
```

- [ ] **Step 5: Perform final source-level audit**

Run: `git diff --check && git diff --stat`

Expected: no whitespace errors; no files outside the backend response, runtime types, student topology/page, stylesheet, and documentation change.
