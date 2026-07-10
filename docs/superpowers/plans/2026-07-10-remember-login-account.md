# Remember Login Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offer role-specific account history from an explicit input dropdown without automatic field population or credential storage.

**Architecture:** A focused storage helper owns a versioned, bounded account-history schema and legacy migration. `AuthPortal` starts empty, opens a custom account picker on field focus, fills the selected name/identifier pair, and records successful logins only.

**Tech Stack:** React, TypeScript, Web Storage, Node test runner, Vite

## Global Constraints

- Never persist passwords, cookies, session IDs, or tokens in Web Storage.
- Persist only successful login identity input: role, name, and identifier.
- Keep teacher and student remembered accounts independent.
- Never populate login fields until the user selects a history item.
- Keep at most 5 accounts per role, ordered by recent successful use.
- Registration does not use remembered login data.

---

### Task 1: Versioned remembered-account storage

**Files:**
- Create: `frontend/src/features/auth/rememberedAccount.ts`
- Create: `frontend/tests/rememberedAccount.test.ts`
- Modify: `frontend/package.json`

- [ ] Write failing tests for empty state, malformed JSON, role isolation, legacy migration, deduplication, five-item limit and single-item removal.
- [ ] Run `npm run test:auth` and confirm failure because the helper is absent.
- [ ] Implement strict parsing and storage operations for `oa.auth.account-history.v2`, including migration from `oa.auth.remembered.v1`.
- [ ] Run `npm run test:auth` and confirm all tests pass.

### Task 2: Login form integration

**Files:**
- Modify: `frontend/src/features/auth/AuthPortal.tsx`
- Modify: `frontend/src/styles.css`

- [ ] Keep login fields empty and load role-specific history separately.
- [ ] Add an account-history dropdown that opens on field focus, fills both fields on selection, closes on outside focus, and removes individual items.
- [ ] Keep the default-checked “记住账号” control; checked adds a successful login to history and unchecked does not alter existing history.
- [ ] Add stable form and input attributes for password-manager compatibility.
- [ ] Style the checkbox as a compact binary control without affecting text inputs.

### Task 3: Verification and documentation

**Files:**
- Modify: `README.md`

- [ ] Document the storage boundary and localStorage key.
- [ ] Run `npm run test:auth` and `npm run build`.
- [ ] Browser-test blank initial fields, explicit dropdown selection, role isolation and absence of password data.
- [ ] Commit the verified feature.
