# Audit Script Hot Reload and Worker Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace version-pinned audit scripts with centrally managed hot-activated scripts, node-scoped audit policies, immutable job snapshots, and a concurrent in-process worker pool.

**Architecture:** The filesystem keeps one active handler and config per `script_id`; SQLite records the active script generation and one mutable policy per `(flow_id, node_key)`. Student submission snapshots both layers into `audit_jobs`, while a single FastAPI process runs a configurable worker pool whose child processes load the active handler for each claimed job.

**Tech Stack:** Python 3.11, FastAPI, SQLite WAL, React 18, TypeScript, Vite, Python/Node child processes.

**Spec:** `docs/superpowers/specs/2026-08-19-audit-script-hot-reload-worker-pool-design.md`

## Global Constraints

- Work on the current branch and preserve unrelated dirty-worktree changes.
- Do not run automated tests, frontend builds, or browser tools during implementation; use static business-logic review only, as required by `AGENTS.md`.
- Do not retain a second versioned runtime path or expose `v1/v2` in APIs or UI.
- Preserve all historical student submissions, files, approved nodes, rosters, and flow instances.
- Preview and formal student runtime must share policy resolution, cancellation state, and resubmission behavior.
- Use project Node.js `24.18.0` and npm `11.16.0` only if a Node command is required.
- Create only the pre-change checkpoint and final result checkpoint; do not commit between tasks.

---

### Task 1: Flatten the script contract and add persistent runtime state

**Files:**
- Modify: `backend/app/core/config.py`
- Modify: `backend/app/core/database.py`
- Modify: `backend/app/services/audit_script_parameters.py`
- Rewrite: `backend/app/services/audit_script_catalog.py`
- Rewrite: `backend/app/services/audit_script_runtime.py`
- Move: `backend/scripts/*/versions/1/handler.py` to `backend/scripts/*/handler.py`
- Move: `backend/scripts/*/versions/1/config.json` to `backend/scripts/*/config.json`
- Modify: `backend/scripts/*/manifest.json`

**Interfaces:**
- Produce `AuditScriptRecord` without a version field.
- Produce `find_audit_script(script_id)`, `synchronize_audit_script_states()`, `get_audit_script_editor(script_id)`, and `update_audit_script_editor(...)`.
- Produce runtime descriptors containing `script_id`, `generation`, `content_hash`, entry path, language, and normalized config.

- [ ] Add `AUDIT_WORKER_COUNT=4` support and `execution.maxConcurrency` normalization.
- [ ] Add migrations for `audit_script_runtime_states`, `node_audit_policies`, and the new `audit_jobs` snapshot/cancellation columns while preserving legacy rows.
- [ ] Flatten all three current script directories and remove manifest `version` fields.
- [ ] Make the catalog validate root-level handlers/configs, compute source/config/content/editor hashes, synchronize DB state, and atomically activate editor changes.
- [ ] Keep name/description-only saves outside generation changes; source/config saves set `updating`, cancel affected work, replace files, increment generation, then set `ready`.

### Task 2: Add node-scoped audit policies and publish integration

**Files:**
- Create: `backend/app/repositories/audit_policies.py`
- Modify: `backend/app/repositories/workflows.py`
- Modify: `backend/app/domain/workflow_revision.py`
- Modify: `backend/app/api/routes/workflows.py`

**Interfaces:**
- Produce `sync_published_audit_policies(connection, flow_id, config, actor_id, now)`.
- Produce `resolve_effective_audit_policy(connection, flow_id, node_key)`.
- Produce `get_node_audit_policy(flow_id, node_key, teacher_id)` and `update_node_audit_policy(...)`.
- Expose `GET/PUT /api/workflows/{flow_id}/nodes/{node_key}/audit-policy` with optimistic generation checks.

- [ ] Store one explicit policy per published script-bearing node; do not duplicate script source.
- [ ] Make publishing initialize new policies and preserve current policy values for already published nodes.
- [ ] Remove prompt and node audit parameters from published-revision invalidation semantics.
- [ ] On policy update, cancel only current `pending/running` jobs for the exact flow/node, preserve approved nodes, and return the new policy.

### Task 3: Snapshot policy inputs at submission and implement cancellation-safe jobs

**Files:**
- Rewrite: `backend/app/repositories/audit_jobs.py`
- Modify: `backend/app/repositories/flow_instances.py`
- Modify: `backend/app/api/routes/student_flows.py`

**Interfaces:**
- `create_audit_job(...)` consumes flow/node, script generation/hash, policy generation/hash, effective params/settings, and creates a complete immutable job.
- `claim_next_audit_job()` returns only snapshot data plus material metadata.
- `cancel_audit_jobs_for_script(...)` and `cancel_audit_jobs_for_policy(...)` return running job IDs for process signalling.
- Completion and failure writes are conditional on current job status, script generation/hash, and policy generation/hash.

- [ ] Resolve script state and node policy inside the student submission transaction.
- [ ] Reject submission when the script is not `ready`; otherwise snapshot all execution inputs in `audit_jobs`.
- [ ] Add `cancelled` job/submission behavior, return current nodes to `available`, preserve files/history, and expose a resubmission reason in runtime responses.
- [ ] Stop rebuilding missing jobs from flow snapshots; cancel inconsistent reviewing submissions and require a new attempt.
- [ ] Keep `passed=false` distinct from script execution failure and keep approved/downstream state unchanged during hot updates.

### Task 4: Replace the serial worker with a concurrent, cancellable pool

**Files:**
- Rewrite: `backend/app/services/audit_job_worker.py`
- Modify: `backend/app/services/audit_script_executor.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Produce `start_audit_worker_pool(worker_count)` and `stop_audit_worker_pool(pool)`.
- Produce a process-local cancellation registry keyed by job ID.
- Extend `execute_audit_script(..., cancelled: Callable[[], bool])` so the existing selector loop terminates cancelled children.

- [ ] Run script-state synchronization and job recovery exactly once before spawning worker loops.
- [ ] Atomically claim the oldest eligible job while respecting `ready` and per-script concurrency limits.
- [ ] Register each running job before process launch and recheck execution eligibility to close update races.
- [ ] Signal running jobs after script/policy cancellation; always discard stale output through repository commit guards.
- [ ] Stop all loops and child processes cleanly from FastAPI lifespan.

### Task 5: Replace versioned management APIs and UI

**Files:**
- Modify: `backend/app/api/routes/workflow_admin.py`
- Modify: `frontend/src/features/academic-flow/auditScripts.ts`
- Modify: `frontend/src/features/academic-flow/auditScriptConfig.ts`
- Modify: `frontend/src/features/academic-flow/api.ts`
- Modify: `frontend/src/features/academic-flow/AuditScriptMetadataDialog.tsx`
- Modify: `frontend/src/features/academic-flow/AuditScriptSelector.tsx`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Replace versioned endpoints with `GET/PUT /api/workflow-admin/audit-scripts/{script_id}`.
- Management detail includes source, editor hash, runtime state, generation, counts, values, and max concurrency.
- Script selection values use `script_id` only and nodes no longer carry version/hash/config-hash fields.

- [ ] Remove every `v1` label and versioned URL from active backend/frontend paths.
- [ ] Add a source textarea and max-concurrency control to the existing super-admin editor.
- [ ] Save metadata, source, and config through one optimistic request and retain conflict/validation/failure feedback.
- [ ] Keep the existing white panels, gray borders, blue primary actions, red error semantics, radii, and spacing.

### Task 6: Add published-node policy editing and align preview/formal behavior

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Modify: `frontend/src/features/academic-flow/flowRevision.ts`
- Modify: `frontend/src/features/academic-flow/api.ts`
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Add `getNodeAuditPolicy(flowId, nodeKey)` and `updateNodeAuditPolicy(...)`.
- Published node inspector provides an independently saved audit-rule editor for prompt/mode/node parameters.
- Student runtime maps `script_updated`, `policy_updated`, and integrity cancellation to one resubmission interaction.

- [ ] Allow published audit rules to be saved without creating a flow revision.
- [ ] Do not allow script selection, templates, file contracts, or topology to change through the policy editor.
- [ ] Update the local published node after a successful policy save so preview and teacher-visible configuration stay aligned.
- [ ] Remove `scanAuditPrompt` from ordinary revision patches and revise the explanatory copy.
- [ ] Reuse the formal student runtime component for preview-visible cancellation and resubmission behavior.

### Task 7: Static audit, final checkpoint, cleanup, and local restart

**Files:**
- Review all task files and `docs/superpowers/specs/2026-08-19-audit-script-hot-reload-worker-pool-design.md`.

**Interfaces:**
- No stale active reference may require `auditScriptVersion`, `script_version`, `/versions/1`, or `find_audit_script_version`.

- [ ] Inspect the full submission → job → worker → result transaction and both update cancellation paths.
- [ ] Inspect flow ownership, super-admin authorization, roster authorization, file ownership, and preview expiry boundaries.
- [ ] Run `git diff --check` and targeted `rg` audits only; do not run tests, builds, or browser tools.
- [ ] Clean only `.pytest_cache`, `__pycache__`, and `*.egg-info` created in project source paths.
- [ ] Create the final task-only checkpoint commit.
- [ ] Restart backend and frontend locally without Docker and verify listeners on ports `8000` and `5173`.
