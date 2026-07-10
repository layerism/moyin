# Unique Flow Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent creation of new OA workflows whose trimmed names already exist.

**Architecture:** The repository performs the authoritative duplicate check inside an immediate SQLite transaction and raises a domain conflict. The API maps the conflict to HTTP 409, while the existing creation dialog provides a fast client-side check and renders backend errors without closing.

**Tech Stack:** FastAPI, SQLite, pytest, React, TypeScript, Vite

## Global Constraints

- Preserve all historical duplicate workflows.
- Compare exact trimmed names.
- Keep the creation dialog open on conflicts.

---

### Task 1: Backend duplicate protection

- [ ] Add failing API tests for exact and whitespace-normalized duplicates.
- [ ] Implement `DuplicateFlowNameError` and serialize create checks with `BEGIN IMMEDIATE`.
- [ ] Map the conflict to HTTP 409 with `已存在同名流程`.
- [ ] Run backend tests and Ruff.

### Task 2: Frontend conflict feedback

- [ ] Extend `NameDialog` with an optional inline error.
- [ ] Check the current process list before calling the API.
- [ ] Catch API conflicts, retain the dialog and input, and show the message.
- [ ] Run the frontend tests and production build.

### Task 3: Browser verification and commit

- [ ] Verify duplicate submission is blocked and a distinct name succeeds.
- [ ] Verify no console errors and clean temporary test data.
- [ ] Commit the verified change.
