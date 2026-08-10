# Form and Flow Node Visual Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove choice-field “other” answers, compact uploaded template rows, and keep every canvas node at `280 × 126` while fitting long text predictably.

**Architecture:** Preserve existing React state, API schemas, and geometry helpers. Normalize selection fields at the frontend boundary, reuse the current template row component structure with one explicit DOCX badge, and derive a deterministic node-density class from title and description length so CSS owns fixed sizing and truncation.

**Tech Stack:** React, TypeScript, CSS, existing academic-flow components.

## Global Constraints

- Do not add dependencies or change backend/database interfaces.
- Keep backend `allowOther` parsing for historical compatibility.
- Keep node geometry at exactly `280 × 126` pixels.
- Do not run tests, builds, or browser automation during implementation; perform static business-logic audit only, as required by project instructions.
- Create only the final implementation commit after the existing design checkpoint.

---

### Task 1: Remove frontend “other” choice behavior

**Files:**
- Modify: `frontend/src/features/academic-flow/FormFieldEditor.tsx`
- Modify: `frontend/src/features/academic-flow/RuntimeFormFields.tsx`
- Modify: `frontend/src/features/academic-flow/formFields.ts`

**Interfaces:**
- Consumes: existing `FormFieldDefinition`, `normalizeFormFields()` and `onChange(nextFields)` contracts.
- Produces: selection fields whose normalized `allowOther` value is always `false`, with no teacher or student “other” controls.

- [ ] **Step 1: Remove the teacher-side “other” action**

Delete the button that toggles `allowOther` in the selection option action row. Keep the ordinary “添加选项” button and option sorting unchanged.

- [ ] **Step 2: Normalize selection fields without “other”**

In `normalizeFieldSettings()`, return `allowOther: false` for both radio and checkbox fields regardless of historical input. Preserve options and checkbox selection limits.

- [ ] **Step 3: Remove student-side “other” rendering**

Delete the radio and checkbox `ChoiceOther` branches and the now-unused component. Simplify checkbox answer construction to include only valid ordinary option IDs and return `otherText: null`.

- [ ] **Step 4: Perform static contract audit**

Use `rg` to verify there is no visible “添加‘其他’项”, “移除‘其他’项”, or `ChoiceOther` reference in frontend source. Confirm backend compatibility code was not modified.

### Task 2: Compact uploaded template rows

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: existing `TemplateAsset.originalName`, `TemplateAsset.sizeBytes`, `formatTemplateSize()` and template actions.
- Produces: shared compact `.node-template-file` markup with `.node-template-file-icon` and `.node-template-file-copy` elements.

- [ ] **Step 1: Add explicit file-row semantics**

For ordinary templates and confirmation scan templates, render a `DOCX` file badge, a copy container, a filename with `title={originalName}`, and the existing size or disabled-state caption. Preserve current upload, replace, and delete callbacks.

- [ ] **Step 2: Apply compact shared styling**

Use a 34-pixel file badge, 13-pixel filename, 11-pixel caption, and compact action buttons. Keep filename single-line ellipsis and reserve action width using the existing two-column grid.

- [ ] **Step 3: Perform static template audit**

Confirm all `.node-template-file` call sites use the new copy wrapper and no upload callback or disabled branch was removed.

### Task 3: Fix canvas nodes and fit long text

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: existing `AcademicFlowNode.title`, `requirement`, `nodeSize`, connection ports and metadata markup.
- Produces: `getFlowNodeDensity(node): "normal" | "compact" | "dense"` and matching CSS modifier classes.

- [ ] **Step 1: Derive deterministic text density**

Add `getFlowNodeDensity()` using trimmed title plus description length. Return `dense` above 70 characters, `compact` above 42 characters, otherwise `normal`.

- [ ] **Step 2: Fix node dimensions in render output**

Append `flow-node-density-*` to every node class and set both inline width and height from `nodeSize`. Do not change port, edge, drag, or canvas calculations.

- [ ] **Step 3: Constrain and scale typography**

Make `.flow-node` use fixed height and hidden overflow. Clamp title and description lines; use `17/13`, `14/11`, and `12/10` pixel title/description sizes for normal, compact, and dense modes. Reserve the final row for `.node-meta`.

- [ ] **Step 4: Perform geometry and overflow audit**

Confirm every geometry helper still consumes `nodeSize`, every node receives fixed width and height, and long text cannot alter the card box dimensions.

### Task 4: Final static audit, cleanup, commit, and restart

**Files:**
- Modify: only files listed above.

**Interfaces:**
- Consumes: completed frontend changes.
- Produces: one implementation checkpoint and restarted local backend/frontend services.

- [ ] **Step 1: Review scoped diff**

Run `git diff --check` and inspect the exact frontend/doc diff. Confirm unrelated `AGENTS.md`, `INSTALL.md`, and `MEMORY.md` changes remain unstaged.

- [ ] **Step 2: Clean generated caches**

Remove project-local `.pytest_cache`, `__pycache__`, and `*.egg-info` directories if present, without touching dependencies or user files.

- [ ] **Step 3: Commit the completed implementation**

Stage only the plan and modified frontend files, then commit with `feat: refine form and flow node visuals`.

- [ ] **Step 4: Restart local services**

Stop only processes bound to this project’s ports, start Uvicorn on `0.0.0.0:8000` and Vite on `0.0.0.0:5173`, then verify both endpoints return HTTP 200. Do not use Docker.
