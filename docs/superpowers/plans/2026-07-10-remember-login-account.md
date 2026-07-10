# Remember Login Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remember successful teacher and student account identifiers without storing passwords or session credentials.

**Architecture:** A focused storage helper owns the versioned localStorage schema and validation. `AuthPortal` reads the helper only for login mode and writes or removes the role-specific account only after successful authentication.

**Tech Stack:** React, TypeScript, Web Storage, Node test runner, Vite

## Global Constraints

- Never persist passwords, cookies, session IDs, or tokens in Web Storage.
- Persist only successful login identity input: role, name, and identifier.
- Keep teacher and student remembered accounts independent.
- Registration does not use remembered login data.

---

### Task 1: Versioned remembered-account storage

**Files:**
- Create: `frontend/src/features/auth/rememberedAccount.ts`
- Create: `frontend/tests/rememberedAccount.test.ts`
- Modify: `frontend/package.json`

- [ ] Write failing tests for empty state, malformed JSON, role isolation, save, overwrite and remove.
- [ ] Run `npm run test:auth` and confirm failure because the helper is absent.
- [ ] Implement strict parsing and storage operations for `oa.auth.remembered.v1`.
- [ ] Run `npm run test:auth` and confirm all tests pass.

### Task 2: Login form integration

**Files:**
- Modify: `frontend/src/features/auth/AuthPortal.tsx`
- Modify: `frontend/src/styles.css`

- [ ] Initialize login fields from the remembered account for the active role.
- [ ] Add a default-checked “记住账号” control and save or remove data after successful login.
- [ ] Add stable form and input attributes for password-manager compatibility.
- [ ] Style the checkbox as a compact binary control without affecting text inputs.

### Task 3: Verification and documentation

**Files:**
- Modify: `README.md`

- [ ] Document the storage boundary and localStorage key.
- [ ] Run `npm run test:auth` and `npm run build`.
- [ ] Browser-test role switching, successful-login restoration and absence of password data.
- [ ] Commit the verified feature.
