# Student Audit Script Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将固定版本审核脚本可靠接入学生文件提交节点，并提供持久化重试、结果展示和学生手动重新审核能力。

**Architecture:** 文件提交事务同步创建 SQLite `audit_jobs`，FastAPI lifespan 内的异步 worker 原子领取任务，在事务外执行 OSS 下载和脚本，在新事务中落库并推进 DAG。学生端在存在 `reviewing` 节点时按 2 秒轮询，展示业务驳回原因，并对最终技术异常提供不重新上传文件的重试入口。

**Tech Stack:** FastAPI、Python 3.11、SQLite、Pydantic Settings、React、TypeScript、原生 CSS。

## Global Constraints

- 当前分支内实施；开始和完成各一个 Git 检查点，中间不提交。
- 不引入 Redis、Celery、RQ 或新的前端状态库。
- 仅允许 `AUDIT_SCRIPT_ENV_ALLOWLIST` 明确列出的环境变量进入脚本。
- 初次执行加三次重试，退避为 1、5、15 秒；第四次失败进入 `audit_error`。
- 保留未配置审核脚本节点的现有 `autoApprove` 行为。
- 按项目规则不运行自动化测试、构建或浏览器验证，仅做静态业务逻辑审计。
- 不修改或提交用户已有的 `AGENTS.md`、`docs/05_oa_graph.md` 和 `.superpowers/` 变更。
- 开发完成后清理 `.pytest_cache`、`__pycache__`、`*.egg-info`，提交最终检查点并重启服务。

---

## File Map

- `backend/app/core/database.py`：新增任务表和索引。
- `backend/app/core/config.py`、`backend/.env.example`：声明脚本环境变量白名单。
- `backend/app/repositories/flow_runtime_state.py`：共享 DAG 推进和流程完成逻辑，避免仓储循环依赖。
- `backend/app/repositories/audit_jobs.py`：任务创建、领取、恢复、完成、失败、手动重试。
- `backend/app/repositories/flow_instances.py`：提交时创建任务，实例响应组合审核摘要。
- `backend/app/services/audit_job_worker.py`：后台循环和错误分类。
- `backend/app/services/audit_script_executor.py`：构建最小脚本环境。
- `backend/app/api/routes/student_flows.py`：重新审核 API。
- `backend/app/main.py`：worker 生命周期。
- `frontend/src/features/academic-flow/runtimeTypes.ts`：状态和审核摘要类型。
- `frontend/src/features/academic-flow/api.ts`：重试请求。
- `frontend/src/features/academic-flow/StudentFlowTopology.tsx`：状态可视化与节点可点击性。
- `frontend/src/features/academic-flow/StudentRuntimePage.tsx`：轮询、结果展示和重试交互。
- `frontend/src/styles.css`：审核状态样式。

### Task 1: 持久化模型与配置

**Files:**
- Modify: `backend/app/core/database.py`
- Modify: `backend/app/core/config.py`
- Modify: `backend/.env.example`

**Interfaces:**
- Produces: `audit_jobs` 表；`settings.audit_script_env_allowlist: str`。

- [ ] **Step 1: 增加审核任务表**

在数据库 schema 中增加带唯一提交约束和到期领取索引的表：

```sql
CREATE TABLE IF NOT EXISTS audit_jobs (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
    node_instance_id TEXT NOT NULL REFERENCES node_instances(id) ON DELETE CASCADE,
    script_id TEXT NOT NULL,
    script_version INTEGER NOT NULL CHECK (script_version > 0),
    script_sha256 TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    result_json TEXT,
    error_message TEXT,
    claimed_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_jobs_claim
ON audit_jobs(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_jobs_node
ON audit_jobs(node_instance_id);
```

- [ ] **Step 2: 暴露白名单配置**

```python
audit_script_env_allowlist: str = "OPENAI_API_KEY"
```

并在 `.env.example` 中加入 `AUDIT_SCRIPT_ENV_ALLOWLIST=OPENAI_API_KEY`。

- [ ] **Step 3: 静态核对**

使用 `rg "audit_jobs|audit_script_env_allowlist" backend`，确认字段名一致且不修改既有表。

### Task 2: 共享状态推进与审核任务仓储

**Files:**
- Create: `backend/app/repositories/flow_runtime_state.py`
- Create: `backend/app/repositories/audit_jobs.py`
- Modify: `backend/app/repositories/flow_instances.py`

**Interfaces:**
- Produces: `create_audit_job(connection, *, submission_id, node_instance_id, script_id, script_version, script_sha256, now) -> str`。
- Produces: `claim_next_audit_job() -> ClaimedAuditJob | None`、`complete_audit_job(job_id, result) -> None`、`fail_audit_job(job_id, message) -> None`、`recover_audit_jobs() -> None`、`retry_audit_job(node_instance_id, student_id) -> str`。
- Produces: `advance_downstream(connection, flow_instance_id, now) -> None`、`complete_flow_if_ready(connection, flow_instance_id, now) -> None`。

- [ ] **Step 1: 提取现有 DAG 状态逻辑**

将 `flow_instances.py` 现有下游开放和流程完成 SQL 原样迁移到 `flow_runtime_state.py`，由提交和 worker 共用，避免 `audit_jobs.py` 反向导入 `flow_instances.py`。

- [ ] **Step 2: 实现原子领取**

`claim_next_audit_job()` 使用独立连接执行 `BEGIN IMMEDIATE`，选择首个到期 `pending` 任务并执行：

```sql
UPDATE audit_jobs
SET status = 'running', attempt_count = attempt_count + 1,
    claimed_at = ?, updated_at = ?
WHERE id = ? AND status = 'pending';
```

同一事务读取当前 Submission、节点、流程和附件 OSS 元数据，返回不可变 `ClaimedAuditJob`；缺失上下文作为技术失败处理。

- [ ] **Step 3: 实现结果与失败状态机**

`complete_audit_job` 解析 `passed`：通过则更新 job/submission/node 并调用共享 DAG 推进；业务不通过则写入 `rejected` 和 `result_json`。落库前校验当前节点 `attempt_no` 与任务 Submission 一致，旧任务只终结 job，不覆盖新提交。

`fail_audit_job` 对执行次数 1、2、3 分别设置 1、5、15 秒后的 `pending`；第 4 次设置 job `failed` 且当前 submission/node 为 `audit_error`。只保存稳定脱敏消息。

- [ ] **Step 4: 实现恢复和手动重试**

启动恢复将 `running` 置回 `pending`，并只为“当前提交有附件、节点 reviewing、快照存在完整脚本三元组、无 job”的旧节点补任务。`retry_audit_job` 验证学生所有权、有效名单、当前 `audit_error`、当前提交和附件后重置同一任务。

- [ ] **Step 5: 接入提交事务**

在 `submit_node` 中将脚本三元组分为全空、全有、部分配置三类；部分配置抛出 `RuntimeConflictError("审核脚本配置无效，请联系教师")`。全有时忽略 `autoApprove`，在原事务内创建 `reviewing` submission/node/job；全空保持既有行为。

### Task 3: 实例响应与重试 API

**Files:**
- Modify: `backend/app/repositories/flow_instances.py`
- Modify: `backend/app/api/routes/student_flows.py`

**Interfaces:**
- Consumes: `retry_audit_job(node_instance_id: str, student_id: str) -> str`。
- Produces: 节点 `audit: {status, reason, details, attemptCount, canRetry} | null`；`POST /api/student/node-instances/{node_instance_id}/audit/retry`。

- [ ] **Step 1: 合并当前审核摘要**

实例查询只关联当前 `attempt_no` 的 Submission 与其 audit job。`result_json` 仅解析协议结果；`audit_error` 返回固定 `reason="自动审核暂时失败，请重新审核"`，不返回 `error_message`。

- [ ] **Step 2: 增加重试路由**

路由从认证上下文取学生 ID，调用仓储重试并以返回的 flow instance ID 再执行 `get_instance`，复用现有异常到 HTTP 状态映射。

- [ ] **Step 3: 审计越权和泄密边界**

确认 API 不接受 submission、student 或 script 参数，且响应中不存在 stderr、临时路径、白名单值或内部错误。

### Task 4: Worker 与受限执行环境

**Files:**
- Create: `backend/app/services/audit_job_worker.py`
- Modify: `backend/app/services/audit_script_executor.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Consumes: `ClaimedAuditJob` 和审核任务仓储函数。
- Produces: `start_audit_job_worker() -> asyncio.Task[None]`、`stop_audit_job_worker(task) -> None`。

- [ ] **Step 1: 构建脚本环境白名单**

使用正则 `^[A-Za-z_][A-Za-z0-9_]*$` 解析逗号白名单并去重；只从应用已加载的 `os.environ` 取值，合并现有 `PATH/LANG/PYTHONUTF8/PYTHONNOUSERSITE/NODE_PATH`。不记录名称对应的值。

- [ ] **Step 2: 实现 worker 循环**

启动先通过 `asyncio.to_thread(recover_audit_jobs)` 恢复任务。循环每次在线程中领取一个任务、解析固定脚本 descriptor、执行现有 executor，并调用 complete/fail；无任务时等待停止事件最多 1 秒。错误日志只记录 job ID 和异常类型。

- [ ] **Step 3: 接入 FastAPI lifespan**

数据库初始化后启动 worker；`yield` 的 `finally` 中设置停止事件并等待 worker 结束，避免新建独立进程和部署配置。

### Task 5: 学生端轮询、结果与重新审核

**Files:**
- Modify: `frontend/src/features/academic-flow/runtimeTypes.ts`
- Modify: `frontend/src/features/academic-flow/api.ts`
- Modify: `frontend/src/features/academic-flow/StudentFlowTopology.tsx`
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Produces: `RuntimeNodeStatus` 增加 `audit_error`；`RuntimeNodeAudit`；`retryAudit(nodeInstanceId) -> Promise<RuntimeFlowInstance>`。

- [ ] **Step 1: 扩展类型与 API**

```ts
export type RuntimeNodeAudit = {
  status: RuntimeNodeStatus
  reason: string | null
  details: unknown
  attemptCount: number
  canRetry: boolean
}
```

节点增加 `audit: RuntimeNodeAudit | null`，API POST 重试后直接返回刷新后的实例。

- [ ] **Step 2: 增加有限轮询**

从 `instance.nodes.some(node => node.status === "reviewing")` 派生布尔值；仅为真时注册 2 秒 interval。轮询成功替换实例，失败只更新非阻断提示，并在 effect cleanup 清除 interval，防止重复定时器。

- [ ] **Step 3: 增加审核交互**

拓扑为 `audit_error` 增加标签、样式和可点击状态。节点弹窗中：`rejected` 展示 reason/details 并保留重新上传；`audit_error` 展示固定提示和“重新审核”按钮；`reviewing` 只读展示执行次数；approved 不再可编辑。

- [ ] **Step 4: 增加最小样式**

复用现有对话框和按钮规则，只新增 `audit_error` 节点配色、审核结果块和错误提示，避免新组件库或动画。

### Task 6: 静态验收、清理、提交与重启

**Files:**
- Review: all files above

**Interfaces:**
- Produces: 可供用户手动验收的已重启开发服务和最终 Git 检查点。

- [ ] **Step 1: 执行业务逻辑静态审计**

用 `rg` 核对状态字符串、API 路径、脚本字段与白名单；检查领取事务、旧任务保护、四次执行边界、DAG 推进和幂等约束。按项目规则不运行测试、构建和浏览器。

- [ ] **Step 2: 检查补丁完整性**

运行 `git diff --check`，并用 `git status --short` 确认仅暂存本功能文件，不包含用户现有改动。

- [ ] **Step 3: 清理开发缓存**

删除工作区内 `.pytest_cache`、`__pycache__` 和 `*.egg-info`，不删除应用数据和用户文件。

- [ ] **Step 4: 创建最终检查点**

仅添加本计划列出的文件，提交信息为：

```bash
git commit -m "feat: connect student audit script runtime"
```

- [ ] **Step 5: 重启服务**

停止当前后端与前端开发进程，按仓库既有命令重新启动；确认进程保持运行，将地址与提交哈希交付用户手动验证。
