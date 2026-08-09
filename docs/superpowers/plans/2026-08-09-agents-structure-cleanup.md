# AGENTS.md Structure Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize `AGENTS.md` into one primary title and seven responsibility-based sections without weakening existing project constraints.

**Architecture:** Replace the current mixed heading hierarchy with a complete, fixed Markdown document. Preserve each operational rule, resolve the documentation contradiction explicitly, and verify structure through static text inspection only.

**Tech Stack:** Markdown, Git

## Global Constraints

- `# 项目开发规范` is the only level-one heading.
- Use the seven approved level-two headings in the approved order.
- Keep Node.js `24.18.0`, npm `11.16.0`, and `.local/node` unchanged.
- Small changes do not require extra topic documentation, but still require the `docs/superpowers` development record.
- Do not run tests or use a browser; perform only Markdown and rule-consistency auditing.
- Do not modify or commit the unrelated untracked `memory.md`.

---

### Task 1: Replace and verify the project development rules

**Files:**
- Modify: `AGENTS.md`
- Track: `docs/superpowers/plans/2026-08-09-agents-structure-cleanup.md`

**Interfaces:**
- Consumes: approved structure in `docs/superpowers/specs/2026-08-09-agents-structure-design.md`
- Produces: a single, consistently structured instruction document for repository agents

- [x] **Step 1: Replace `AGENTS.md` with the approved content**

  Use exactly this content:

  ```markdown
  # 项目开发规范

  ## 工具与需求确认

  - 自动使用 Superpowers、build-web-app 和 Ponytail 插件。
  - 实现用户需求前，先检查并补全业务逻辑，避免因需求逻辑不完整产生开发冲突。
  - 小改动先列出实施计划，用户确认后再修改。

  ## 版本管理与协作

  - 用户未特别指定时，在当前分支完成开发或修改。
  - 实施前提交一次检查点，完成后再提交一次检查点，中间不提交。
  - 每项开发或修改任务最多启动一个 subagent。

  ## Node.js 运行环境

  - 项目固定使用 `.local/node` 中的 Node.js `24.18.0` 与 npm `11.16.0`，不得依赖系统安装。
  - 执行 Node.js、npm 或 npx 命令前，必须先在项目根目录运行 `export PATH="$PWD/.local/node/bin:$PATH"`。

  ## 开发文档

  - 每次开发或修改前，必须通过 Superpowers 明确用户需求和业务逻辑，并将开发文档整理到 `docs/superpowers`。
  - 小改动不编写额外专题文档，但仍须遵守上述 `docs/superpowers` 开发文档要求。

  ## 验证约束

  - 开发或修改过程中不运行测试、不使用浏览器插件，仅进行业务逻辑审计。

  ## 服务管理

  - 完成开发或修改后，自动以本地方式重启服务，不使用 Docker。

  ## 开发清理

  - 开发结束后，自动清理 `.pytest_cache`、`__pycache__` 和 `*.egg-info` 等中间缓存。
  ```

- [x] **Step 2: Audit the Markdown structure and rule coverage**

  Confirm statically that there is one level-one heading, the seven approved level-two headings appear once and in order, the Node/npm values are unchanged, and every source rule maps to one section. Run `git diff --check` for the two task-owned files. Do not run project tests or use a browser.

- [x] **Step 3: Clean caches and restart existing local services**

  Confirm that no cleanup target remains outside dependency environments:

  ```bash
  find . -path './.git' -prune -o -path './frontend/node_modules' -prune -o -path './backend/.venv' -prune -o -path './.local/node' -prune -o \( -type d -name .pytest_cache -o -type d -name __pycache__ -o -type d -name '*.egg-info' \) -print
  ```

  Expected: no output. Identify the listeners, confirm their working directories are this repository's `backend` and `frontend`, then terminate only those listeners:

  ```bash
  lsof -t -iTCP:8000 -sTCP:LISTEN | xargs -r pwdx
  lsof -t -iTCP:5173 -sTCP:LISTEN | xargs -r pwdx
  lsof -t -iTCP:8000 -sTCP:LISTEN | xargs -r kill
  lsof -t -iTCP:5173 -sTCP:LISTEN | xargs -r kill
  ```

  Start the backend from `backend/`:

  ```bash
  PYTHONDONTWRITEBYTECODE=1 .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
  ```

  Start the frontend from `frontend/`:

  ```bash
  export PATH="$PWD/../.local/node/bin:$PATH"
  npm run dev
  ```

  Do not use Docker or send browser/HTTP test requests.

- [x] **Step 4: Commit only task-owned files**

  Commit only `AGENTS.md` and this plan file with path-limited commit semantics, leaving `memory.md` untouched.

  ```bash
  git commit --only -m "docs: organize project development rules" -- AGENTS.md docs/superpowers/plans/2026-08-09-agents-structure-cleanup.md
  ```
