# Student Answer Sheet Header Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the visually empty answer-sheet metadata strip and place score/attempt information as compact tags inside the student node header.

**Architecture:** Reuse the existing `StudentRuntimePage` rendering path shared by teacher preview and formal student entry. Move the existing derived score and attempt text into the dialog header, then scope compact tag and answer-sheet form-spacing styles without changing runtime state or grading logic.

**Tech Stack:** React 18, TypeScript, CSS.

**Spec:** Approved in-chat design from 2026-08-25.

## Global Constraints

- Teacher real-student preview and formal student entry must retain identical visible content and interaction behavior.
- Do not change score calculation, attempt limits, deadlines, grading, answer inputs, draft saving, or submission behavior.
- Keep deadline and scheduled-time notices in their existing operational notice rows.
- Follow the existing white panel, gray border, blue accent, and compact radius/spacing language.
- Per project rules, do not run tests, builds, or browser checks; use TypeScript syntax parsing, CSS parsing, diff checks, and source-level business audits only.

---

### Task 1: Move answer-sheet metadata into the shared node header

**Files:**
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx`

**Interfaces:**
- Consumes: `node.answerSheet.questions` and `runtime.attemptsRemaining`
- Produces: `.runtime-answer-sheet-header-meta` containing two compact metadata tags

- [ ] **Step 1: Preserve the existing derived values**

Keep the current total-score reduction and the existing unlimited/remaining-attempt branches. Do not introduce state, effects, or a second preview-specific rendering path.

- [ ] **Step 2: Render metadata under the requirement**

Inside the existing dialog header copy container, render `总分 N 分` and either `截止前不限次` or `剩余 N 次` only for answer-sheet nodes.

- [ ] **Step 3: Remove the standalone metadata paragraph**

Delete the separate `.runtime-answer-sheet-meta` block between operational notices/grade output and the writable or readonly content branches.

### Task 2: Compact the header tags and remove the empty strip

**Files:**
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: `.runtime-answer-sheet-header-meta` and existing `.runtime-node-dialog`, `.runtime-node-form`, and `.runtime-answer-sheet` classes
- Produces: compact neutral tags in the header and a single divider before answer-sheet content

- [ ] **Step 1: Style the metadata row**

Use an inline wrapping row with an 8 px gap and 10 px top margin. Each tag uses a 24 px minimum height, compact horizontal padding, neutral gray background, 12 px text, and existing border radius.

- [ ] **Step 2: Remove the obsolete strip style**

Delete `.runtime-answer-sheet-meta`; do not leave an empty placeholder or dedicated row.

- [ ] **Step 3: Avoid a redundant answer-sheet divider**

For writable answer-sheet content only, remove the form container's top border because the header already supplies the section divider. Preserve deadline, scheduled, audit, grade, completion, and readonly separators.

- [ ] **Step 4: Perform permitted verification and checkpoint**

Parse the modified TSX with the project TypeScript package, parse CSS with PostCSS, run `git diff --check`, and audit the shared `StudentRuntimePage` entry path. Stage only the task files, create the final checkpoint, restart frontend/backend locally without Docker, and clean project-source caches only.

## Test Decision

No automated test is added because the requested change is CSS layout and JSX placement with no new behavioral contract. A source-text assertion would be a change detector rather than a user-behavior test, while the project explicitly forbids browser checks during code changes.
