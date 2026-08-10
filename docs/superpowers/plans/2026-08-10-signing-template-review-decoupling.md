# Signing Template Review Decoupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DOCX signing templates and scan submission independent from AI visual review, while allowing direct pass, AI pass/fail, or AI score review.

**Architecture:** `templateAsset` determines whether a confirmation node requires scan submission; `scanAuditEnabled` determines only whether an AI script is bound and executed. A shared backend predicate prevents repository-specific interpretations, while the frontend derives student scan requirements from the published runtime template.

**Tech Stack:** Python, SQLite repositories, React, TypeScript, existing workflow JSON schema.

## Global Constraints

- Reuse `templateAsset`, `scanAuditEnabled`, `scanAuditMode`, and `scanAuditPrompt`; do not add database columns or workflow JSON fields.
- Confirmation-node teacher templates remain DOCX-only.
- Direct pass means scans are validated, persisted, and submitted before the node becomes `approved`; it never creates an audit job.
- AI review without a template is invalid at publication.
- Student template download remains required before scan upload and remains subject to existing roster, predecessor, time-window, and version access controls.
- AI score and scoring explanation remain hidden from students; pass/fail rejection reasons remain visible.
- Do not change the configured visual-model provider or add dependencies.
- Per repository policy, do not run tests, builds, or browser automation during implementation; perform static business-logic audit only.
- Preserve all unrelated working-tree changes and create no intermediate commit.

---

### Task 1: Define the canonical scan-requirement predicate

**Files:**
- Modify: `backend/app/domain/workflow.py:83-132`
- Modify: `backend/app/repositories/flow_templates.py:1-32`

**Interfaces:**
- Produces: `confirmation_requires_scans(node: dict[str, Any]) -> bool`.
- Consumes later: template validation, upload context, and submission assembly.

- [ ] **Step 1: Add the shared predicate in the workflow domain**

```python
def confirmation_requires_scans(node: dict[str, Any]) -> bool:
    return node.get("kind") == "confirmation" and node.get("templateAsset") is not None
```

- [ ] **Step 2: Allow every confirmation node to carry a template**

In `_validate_node_template`, replace the AI-dependent confirmation branch with:

```python
is_scan_confirmation = node.get("kind") == "confirmation"
```

Keep metadata validation and the DOCX suffix rule unchanged.

- [ ] **Step 3: Decouple editable-template support from AI review**

Import no new dependency into `flow_templates.py`; simplify the existing function to:

```python
def supports_template(node: dict[str, Any]) -> bool:
    return node.get("kind") in {"file", "confirmation"}
```

Keep `_validate_template_name` and all historical-version protections unchanged.

### Task 2: Require scans by template presence in backend runtime

**Files:**
- Modify: `backend/app/repositories/flow_files.py:1-105`
- Modify: `backend/app/repositories/flow_instances.py:1-40`
- Modify: `backend/app/repositories/flow_instances.py:548-582`

**Interfaces:**
- Consumes: `confirmation_requires_scans(node: dict[str, Any]) -> bool` from Task 1.
- Produces: direct-pass confirmation submissions with normalized `confirmed` and `scans` payloads; existing AI submissions continue to enter `reviewing` through `has_audit_script`.

- [ ] **Step 1: Use the predicate when authorizing scan uploads**

Import the helper in `flow_files.py` and replace the local AI-dependent `is_scan` expression with:

```python
is_scan = confirmation_requires_scans(config_node)
```

Keep template-download enforcement, allowed statuses, and `upload_mode="scan_set"` unchanged.

- [ ] **Step 2: Use the predicate when assembling confirmation submissions**

Import the helper in `flow_instances.py` and replace:

```python
if node.get("kind") == "confirmation" and node.get("scanAuditEnabled") is True:
```

with:

```python
if confirmation_requires_scans(node):
```

Retain confirmation validation, pending-scan lookup, normalized scan metadata, and file-to-submission binding.

- [ ] **Step 3: Preserve existing direct-pass and AI status routing**

Do not change the existing status expression:

```python
submission_status = (
    "approved"
    if approved_form_amendment
    else "reviewing"
    if has_audit_script
    else "approved"
)
```

This makes template-only confirmation submissions pass directly because `_bind_confirmation_visual_audits` creates scripts only when `scanAuditEnabled is True`.

### Task 3: Replace the teacher AI switch with three review choices

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:1948-2020`
- Modify: `frontend/src/features/academic-flow/publishButtonState.ts:72-86`

**Interfaces:**
- Consumes: existing `AcademicFlowNode` fields and template upload/delete callbacks.
- Produces: direct mode as `{scanAuditEnabled: false, scanAuditMode: undefined, scanAuditPrompt: ""}`; AI modes as enabled plus `pass_fail` or `score`.

- [ ] **Step 1: Render the DOCX template card independently of review mode**

Remove the visual-audit switch and the warning that an AI-disabled template must be deleted. Always render the existing `node-template-card`, upload input, file metadata, replace action, and delete action.

Use the section heading and description:

```tsx
<h3>扫描件提交与审核</h3>
<small>学生下载模板并上传签署扫描件，教师可选择直接通过或 AI 审核。</small>
```

- [ ] **Step 2: Render three mutually exclusive review radio options**

```tsx
<fieldset className="scan-audit-mode" disabled={disabled}>
  <legend>审核方式</legend>
  <label><input checked={!enabled} name={`scan-mode-${node.id}`} onChange={() => onUpdate({ scanAuditEnabled: false, scanAuditMode: undefined, scanAuditPrompt: "" })} type="radio" />上传后直接通过</label>
  <label><input checked={enabled && node.scanAuditMode === "pass_fail"} name={`scan-mode-${node.id}`} onChange={() => onUpdate({ scanAuditEnabled: true, scanAuditMode: "pass_fail" })} type="radio" />AI 通过 / 不通过</label>
  <label><input checked={enabled && node.scanAuditMode === "score"} name={`scan-mode-${node.id}`} onChange={() => onUpdate({ scanAuditEnabled: true, scanAuditMode: "score" })} type="radio" />AI 评分（0–100 分）</label>
</fieldset>
```

Render the existing prompt textarea only when `enabled` is true. Keep the 2,000-character limit and mode-specific label.

- [ ] **Step 3: Align frontend publication validation with backend semantics**

In `getScanAuditConfigError`, return no error immediately when `scanAuditEnabled` is false. When it is true, retain the DOCX template, mode, and non-empty prompt checks:

```ts
if (!node.scanAuditEnabled) return undefined;
```

- [ ] **Step 4: Preserve the existing responsive radio layout**

Do not modify `frontend/src/styles.css`: the existing `.scan-audit-mode` already uses `display: flex`, `flex-wrap: wrap`, and scoped label/input sizes, so it supports the third option without a new style rule.

### Task 4: Drive student and teacher scan UI from template presence

**Files:**
- Modify: `frontend/src/features/academic-flow/ScanUploadWorkspace.tsx:7-22`
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx:468-485`
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx:682-716`
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx:845-866`
- Modify: `frontend/src/features/academic-flow/TeacherProgressPanel.tsx:43-49`

**Interfaces:**
- Produces: `getScanSubmitBlocker({ confirmed, scanRequired, scans, templateDownloaded, uploading }): string | null`.
- Consumes: `runtime.template`, `runtime.templateDownloaded`, submission `scans`, and draft confirmation state.

- [ ] **Step 1: Rename the blocker input from AI-enabled to scan-required**

```ts
export function getScanSubmitBlocker(input: {
  confirmed: boolean;
  scanRequired: boolean;
  scans: RuntimeScanFile[];
  templateDownloaded: boolean;
  uploading: boolean;
}): string | null {
  if (!input.scanRequired) return null;
```

Keep all four existing blocker messages and their order unchanged.

- [ ] **Step 2: Derive student submission blocking from the runtime template**

Pass:

```tsx
scanRequired: Boolean(runtime.template),
```

Render the template-download and `ScanUploadWorkspace` block when `node.kind === "confirmation" && runtime.template`, not when AI is enabled.

- [ ] **Step 3: Show submitted scans whenever the submission contains them**

Change the read-only confirmation branch to:

```tsx
if (node.kind === "confirmation" && Array.isArray(payload.scans)) {
```

Keep scan names, page counts, and download buttons unchanged. Ordinary confirmations without `scans` continue to use the final confirmation-only summary.

- [ ] **Step 4: Let teachers open scan details for template-backed confirmation nodes**

Build `scanNodeKeys` with:

```tsx
nodes.filter((node) => node.kind === "confirmation" && Boolean(node.templateAsset))
```

The detail API already lists submission-bound uploaded files and must remain unchanged.

### Task 5: Perform one cross-layer static audit

**Files:**
- Inspect all files modified by Tasks 1–4.

**Interfaces:**
- Confirms that `templateAsset` governs scan requirement and `scanAuditEnabled` governs only AI behavior.

- [ ] **Step 1: Search for stale AI-dependent scan requirements**

```bash
rg -n "kind.*confirmation.*scanAuditEnabled|scanAuditEnabled.*templateAsset|scanAuditEnabled" backend/app frontend/src/features/academic-flow
```

Every remaining occurrence must concern AI configuration, script binding, result presentation, or teacher mode selection—not template support, scan upload permission, scan submission requirements, or scan-list visibility.

- [ ] **Step 2: Check patch integrity without running tests or builds**

```bash
git diff --check -- backend/app/domain/workflow.py backend/app/repositories/flow_templates.py backend/app/repositories/flow_files.py backend/app/repositories/flow_instances.py frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/features/academic-flow/StudentRuntimePage.tsx frontend/src/features/academic-flow/ScanUploadWorkspace.tsx frontend/src/features/academic-flow/TeacherProgressPanel.tsx frontend/src/features/academic-flow/publishButtonState.ts
```

- [ ] **Step 3: Confirm compatibility paths from the diff**

Verify four cases explicitly: ordinary confirmation without template, template plus direct pass, template plus AI pass/fail, and template plus AI score. Confirm file-upload node templates and AI provider configuration are untouched.
