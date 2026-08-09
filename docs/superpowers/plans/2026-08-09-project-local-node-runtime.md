# Project-local Node.js Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install the repository's fixed Node.js and npm runtime under `.local/node` and require all future project commands to use it.

**Architecture:** Use the official Linux x64 Node.js prebuilt archive, verify it against the official SHA-256 manifest, and extract it directly into the repository-local runtime directory. Keep platform binaries out of Git with a nested ignore file, and record the exact PATH contract in `AGENTS.md`.

**Tech Stack:** Node.js 24.18.0, npm 11.16.0, POSIX shell tools, Git

## Global Constraints

- The supported workspace platform is Linux x86_64.
- Node.js is fixed to `24.18.0`; npm is fixed to the bundled `11.16.0`.
- The runtime location is `<repository>/.local/node`.
- Do not install nvm or modify system Node.js/npm.
- Do not install npm dependencies or modify either `package-lock.json`.
- Do not run tests or use a browser; perform only version/path checks and business-logic auditing.
- Do not modify or commit unrelated `memory.md`, root `.gitignore`, or `outputs/pets/shuibao` changes.
- Use local non-Docker commands when starting services.

---

### Task 1: Install and document the project-local runtime

**Files:**
- Create: `.local/.gitignore`
- Create: `.local/node/` from the verified official binary archive; ignored by `.local/.gitignore`
- Modify: `AGENTS.md`
- Track: `docs/superpowers/plans/2026-08-09-project-local-node-runtime.md`

**Interfaces:**
- Consumes: official Node.js archive and SHA-256 manifest from `https://nodejs.org/dist/v24.18.0/`
- Produces: `.local/node/bin/node`, `.local/node/bin/npm`, `.local/node/bin/npx`, and the repository PATH contract

- [x] **Step 1: Add the local binary ignore boundary**

  Create `.local/.gitignore` with exactly:

  ```gitignore
  *
  !.gitignore
  ```

- [x] **Step 2: Download and verify the official archive**

  Run from the repository root:

  ```bash
  curl --fail --location --output /tmp/node-v24.18.0-linux-x64.tar.xz https://nodejs.org/dist/v24.18.0/node-v24.18.0-linux-x64.tar.xz
  curl --fail --location --output /tmp/node-v24.18.0-SHASUMS256.txt https://nodejs.org/dist/v24.18.0/SHASUMS256.txt
  cd /tmp
  grep ' node-v24.18.0-linux-x64.tar.xz$' node-v24.18.0-SHASUMS256.txt | sha256sum --check
  ```

  Expected: `node-v24.18.0-linux-x64.tar.xz: OK`.

- [x] **Step 3: Extract the runtime into `.local/node`**

  Run from the repository root after confirming `.local/node` does not already exist:

  ```bash
  mkdir -p .local/node
  tar --extract --file=/tmp/node-v24.18.0-linux-x64.tar.xz --strip-components=1 --directory=.local/node
  ```

- [x] **Step 4: Record the runtime contract in `AGENTS.md`**

  Add this section after `# 开发须知`:

  ```markdown
  ## Node.js 与 npm
  - 项目固定使用 `.local/node` 中的 Node.js `24.18.0` 与 npm `11.16.0`，不得依赖系统安装。
  - 执行 Node.js、npm 或 npx 命令前，必须先在项目根目录运行 `export PATH="$PWD/.local/node/bin:$PATH"`。
  ```

- [x] **Step 5: Check the installed versions and PATH resolution**

  Run from the repository root:

  ```bash
  .local/node/bin/node --version
  export PATH="$PWD/.local/node/bin:$PATH"
  npm --version
  command -v node
  command -v npm
  ```

  Expected outputs include `v24.18.0`, `11.16.0`, `<repository>/.local/node/bin/node`, and `<repository>/.local/node/bin/npm`.

- [x] **Step 6: Audit scope and clean development caches**

  Confirm with path-limited `git diff` that neither lockfile changed and that unrelated staged/unstaged files remain untouched. Remove the currently identified Python bytecode caches without deleting source files or dependency environments:

  ```bash
  rm -rf backend/app/__pycache__ backend/app/api/__pycache__ backend/app/api/routes/__pycache__ backend/app/core/__pycache__ backend/app/domain/__pycache__ backend/app/repositories/__pycache__ backend/app/services/__pycache__
  ```

- [x] **Step 7: Start the existing local services without Docker**

  No project service was running during planning. Start the backend from `backend/` with:

  ```bash
  PYTHONDONTWRITEBYTECODE=1 .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
  ```

  Start the frontend from `frontend/` with the repository-local runtime on PATH:

  ```bash
  export PATH="$PWD/../.local/node/bin:$PATH"
  npm run dev
  ```

  Do not open a browser or execute health/test requests.

- [x] **Step 8: Commit only task-owned tracked files**

  Commit only `.local/.gitignore`, `AGENTS.md`, the corrected design document, and this plan file. Use path-limited commit semantics so pre-existing staged changes are neither included nor unstaged.

  ```bash
  git commit --only -m "chore: add project-local Node runtime" -- .local/.gitignore AGENTS.md docs/superpowers/specs/2026-08-09-project-local-node-runtime-design.md docs/superpowers/plans/2026-08-09-project-local-node-runtime.md
  ```
