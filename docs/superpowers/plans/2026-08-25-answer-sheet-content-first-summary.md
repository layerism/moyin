# Answer Sheet Content-First Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the control-heavy answer-sheet question summary with a compact content-first summary and move editable question properties into the expanded panel.

**Architecture:** Keep the existing accordion, stable question IDs, grading data, and action menu. Add one pure summary helper beside the existing editor-state helpers, then render the summary as navigation-only content while reusing the current question update callbacks in a compact settings row inside the expanded panel.

**Tech Stack:** React 18, TypeScript, CSS, Node.js built-in test runner.

**Spec:** Approved in-chat design from 2026-08-25 and `docs/07_answer_sheet_node_design.md`.

## Global Constraints

- Do not change answer-sheet data structures, backend interfaces, automatic grading, or student rendering.
- Keep Markdown source-on-focus and rendered-on-blur behavior; do not add symbol, format, or image controls.
- Collapsed summaries remain approximately 44 px high and preserve stable-ID drag sorting and the three-dot action menu.
- Follow the existing white panel, gray border, red error, blue primary action, radius, and spacing language.
- Per project rules, write tests first but do not execute tests, builds, or browser checks; use static syntax, CSS, diff, and business-logic audits only.

---

### Task 1: Derive a readable question excerpt

**Files:**
- Modify: `frontend/src/features/academic-flow/answerSheetEditorState.ts`
- Test: `frontend/tests/answerSheet.test.ts`

**Interfaces:**
- Consumes: `AnswerSheetQuestion.content: string`
- Produces: `getAnswerSheetQuestionExcerpt(question: AnswerSheetQuestion): string`

- [ ] **Step 1: Write the failing behavior test**

Add literal assertions showing that whitespace and leading level-one/level-two heading markers collapse into a one-line excerpt, while empty content returns `未填写题干`.

- [ ] **Step 2: Record the RED limitation**

Do not execute the test because the project prohibits test runs during code changes. Confirm statically that the imported helper is absent before implementation.

- [ ] **Step 3: Implement the pure helper**

Normalize whitespace, remove only leading `# ` or `## ` heading markers, and return `未填写题干` when the normalized content is empty. Preserve math and code source text so the summary does not reinterpret teacher content.

- [ ] **Step 4: Statically verify the test contract**

Use TypeScript transpilation to confirm the production and test files parse, without claiming runtime test success.

### Task 2: Recompose the question summary and expanded settings

**Files:**
- Modify: `frontend/src/features/academic-flow/AnswerSheetEditor.tsx`

**Interfaces:**
- Consumes: `getAnswerSheetQuestionExcerpt`, `getAnswerSheetQuestionMeta`, and existing `updateQuestion` / `changeQuestionType` callbacks
- Produces: content-first collapsed summary and a compact expanded settings row

- [ ] **Step 1: Make the summary navigation-only**

Render drag handle, question number, a truncated题干 excerpt, type/score/count metadata, error badge, chevron, and three-dot menu. Remove the select and required checkbox from the collapsed row.

- [ ] **Step 2: Add the expanded settings row**

Render the question type selector and required checkbox together. Render a question-level points input only for single-choice and multiple-choice questions; fill-blank scores remain configured per blank.

- [ ] **Step 3: Preserve interaction boundaries**

The main summary toggle expands or collapses the card, while the drag handle and three-dot menu remain independent controls. Keep one expanded question, auto-expand on add, and stable-ID sorting unchanged.

### Task 3: Compact the visual layout and synchronize documentation

**Files:**
- Modify: `frontend/src/styles.css`
- Modify: `docs/07_answer_sheet_node_design.md`

**Interfaces:**
- Consumes: the new summary and settings class names from Task 2
- Produces: a 44 px desktop summary, standard 16 px required checkbox, compact expanded controls, and a bounded narrow-screen layout

- [ ] **Step 1: Define the desktop grid**

Allocate flexible width to the excerpt and only intrinsic width to metadata/actions. Truncate the excerpt with ellipsis and size the checkbox explicitly so generic input styles cannot enlarge it.

- [ ] **Step 2: Tighten the expanded panel**

Use a compact settings strip and reduce the main Markdown source minimum height from 84 px to 64 px while leaving compact option editors unchanged.

- [ ] **Step 3: Define narrow-width behavior**

Allow metadata to move to a second row only below the existing 760 px breakpoint; do not move editable controls back into the collapsed summary.

- [ ] **Step 4: Update the design document**

Replace the control-heavy wireframe and interaction text with the content-first summary and expanded settings layout.

- [ ] **Step 5: Perform permitted verification and commit**

Run TypeScript transpilation, PostCSS parsing, `git diff --check`, and a targeted business-logic review. Stage only task files, create the final checkpoint commit, restart the local frontend/backend without Docker, and clean project-source caches only.
