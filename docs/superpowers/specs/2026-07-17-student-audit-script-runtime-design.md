# 学生侧审核脚本运行时接入设计

## 目标

将现有本地审核脚本目录、脚本版本解析器和执行器接入学生文件节点运行时。学生提交配置了审核脚本的文件节点后，接口立即返回“自动审核中”；后台可靠执行固定版本脚本，并根据结果更新提交、节点和 DAG 下游状态。

本设计同时覆盖业务不通过、技术异常自动重试、学生手动重新审核、审核结果展示、服务重启恢复和脚本环境变量最小授权。

## 现状与缺口

当前教师端已能为文件节点选择预置审核脚本，流程版本快照保存 `auditScriptId`、`auditScriptVersion` 和 `auditScriptHash`。后端也已经具备：

- 按 ID、版本和 SHA-256 解析固定脚本；
- 从 OSS 下载并校验审核材料；
- 以 JSON stdin/stdout 协议运行 Python 或 JavaScript 脚本；
- 校验 `passed`、`reason` 和 `details` 输出。

学生节点提交逻辑尚未调用这些能力。当前仅通过 `autoApprove` 将节点直接设为 `approved` 或长期停留在 `reviewing`，没有审核任务、结果持久化、自动重试、失败原因或重新审核入口。

## 方案选择

采用 SQLite 持久化任务队列和应用内审核 worker。

未采用 FastAPI `BackgroundTasks`，因为进程退出会丢失任务；未采用 Redis 与 Celery/RQ，因为当前单机 FastAPI + SQLite 项目不需要新增独立基础设施。SQLite 方案以事务领取任务，在不增加部署组件的前提下提供重启恢复和多进程重复领取防护。

## 核心数据流

```text
学生提交文件节点
  -> 创建不可变 Submission
  -> 关联 uploaded_files
  -> 创建 audit_jobs(pending)
  -> NodeInstance/Submission = reviewing
  -> 提交接口立即返回

审核 worker 原子领取任务
  -> 校验脚本 ID、版本与 SHA-256
  -> 从 OSS 暂存并校验文件
  -> 按环境变量白名单运行脚本
  -> 校验输出协议

passed=true
  -> audit_jobs = succeeded
  -> Submission/NodeInstance = approved
  -> 计算并开放 DAG 下游

passed=false
  -> audit_jobs = succeeded
  -> Submission/NodeInstance = rejected
  -> 保存 reason/details，不开放下游

技术异常
  -> 1、5、15 秒退避重试
  -> 初次执行及三次重试仍失败：audit_jobs = failed
  -> Submission/NodeInstance = audit_error
  -> 保留原文件，允许学生重新审核
```

## 数据模型

新增 `audit_jobs` 表：

| 字段 | 约束 | 含义 |
|---|---|---|
| `id` | UUID 主键 | 审核任务 |
| `submission_id` | 唯一、外键 | 对应不可变提交 |
| `node_instance_id` | 外键、索引 | 对应学生节点 |
| `script_id` | 非空 | 固定脚本 ID |
| `script_version` | 正整数 | 固定脚本版本 |
| `script_sha256` | 非空 | 发布时固定的入口哈希 |
| `status` | `pending/running/succeeded/failed` | 任务状态 |
| `attempt_count` | 默认 0 | 已开始执行的次数 |
| `next_attempt_at` | 非空 | 可再次领取时间 |
| `result_json` | 可空 | 通过协议校验后的完整脚本结果 |
| `error_message` | 可空 | 脱敏技术错误，不返回详细内部异常 |
| `claimed_at` | 可空 | 最近领取时间 |
| `finished_at` | 可空 | 最终完成时间 |
| `created_at` | 非空 | 创建时间 |
| `updated_at` | 非空 | 更新时间 |

`audit_jobs(submission_id)` 唯一，保证同一提交只有一个当前审核任务。手动重新审核复用该记录并重置执行字段，不创建新的 Submission。

`submissions.status` 和 `node_instances.status` 使用现有文本字段，扩展状态值为 `reviewing`、`approved`、`rejected` 和 `audit_error`，无需改变列结构。

迁移只新增表、索引和迁移记录，不改写既有提交或附件。

## 状态机与一致性

### 提交

- 仅文件节点且同时具有合法的 `auditScriptId`、`auditScriptVersion`、`auditScriptHash` 时创建审核任务。
- 配置审核脚本的节点始终进入 `reviewing`，不受 `autoApprove` 影响。
- 未配置审核脚本的节点保持现有 `autoApprove` 行为。
- Submission、文件关联、节点状态和审核任务必须在同一 SQLite 事务中提交。
- 重复 `idempotencyKey` 不创建第二个 Submission 或审核任务。

### 任务领取

worker 仅领取 `pending` 且 `next_attempt_at <= now` 的任务。领取在 `BEGIN IMMEDIATE` 事务中完成，并将任务置为 `running`、增加 `attempt_count` 和写入 `claimed_at`；多个 worker 只能有一个成功领取同一任务。

执行脚本和 OSS 下载在事务外完成，避免长事务阻塞学生提交。结果落库时重新开启事务，并校验：

- Submission 仍属于该 NodeInstance；
- NodeInstance 当前 `attempt_no` 等于该 Submission 的 `attempt_no`；
- 节点仍处于 `reviewing` 或同一任务的 `audit_error` 恢复流程。

旧任务不得覆盖后续重新提交的节点状态。

### 审核结果

- `passed=true`：提交和节点进入 `approved`，写入 `approved_at`，随后在同一事务中开放所有前置节点已通过的下游节点。
- `passed=false`：提交和节点进入 `rejected`，保存完整协议结果；学生重新上传并提交时产生新的 Submission 和新的审核任务。
- 技术异常：初次执行失败后，分别等待 1、5、15 秒进行三次自动重试；第四次执行仍失败时记录最终 `failed/audit_error`。因此单次任务最多执行四次。
- 学生手动重新审核：仅允许当前节点为 `audit_error`、任务属于当前 Submission 且文件仍存在时执行；任务重置为 `pending`、`attempt_count=0`，节点与提交恢复为 `reviewing`。

### 服务恢复

服务启动时：

1. 将遗留 `running` 任务恢复为 `pending`；
2. 扫描处于 `reviewing`、流程快照配置了审核脚本、存在当前 Submission 和已关联文件但没有 `audit_jobs` 的旧节点；
3. 为这些旧节点补建 `pending` 任务；
4. 没有配置审核脚本的 `reviewing` 节点保持不变。

## Worker 生命周期

FastAPI 应用启动时创建一个审核 worker 循环，关闭时通过停止事件等待当前循环安全退出。阻塞的 OSS 下载和子进程执行通过线程执行，不阻塞应用事件循环。

worker 每秒检查一个到期任务；没有任务时等待停止事件或下一轮间隔。任务领取和结果写入由仓储层负责，worker 只负责调度解析器、执行器和错误分类。

该设计兼容多个 Uvicorn worker：SQLite 原子领取避免重复执行。当前部署仍以单 worker 为默认，不新增独立守护进程。

## 脚本输入与环境变量

执行输入沿用现有 `schemaVersion = "1.0"` 协议。`context` 至少包含：

```json
{
  "flowId": "...",
  "flowVersionId": "...",
  "flowInstanceId": "...",
  "nodeInstanceId": "...",
  "nodeKey": "...",
  "submissionId": "...",
  "attemptNo": 1
}
```

不向脚本输入学生密码、会话令牌、OSS 密钥或数据库路径。

新增配置：

```env
AUDIT_SCRIPT_ENV_ALLOWLIST=OPENAI_API_KEY
```

执行器只从后端实际环境和 `backend/.env` 中读取名单内的变量，并与现有 `PATH`、`LANG`、`PYTHONUTF8`、`PYTHONNOUSERSITE`、`NODE_PATH` 运行变量合并。空名称、重复名称和不符合环境变量命名规则的项被忽略。允许项不存在时不传入空值；密钥不得写入任务表、结果、错误消息或日志。

审核脚本属于本地管理员预置信任代码，学生不能上传、修改或选择脚本。环境变量白名单是密钥最小授权，不构成操作系统级沙箱。

## API 与学生端响应

保留现有提交和实例读取接口，新增：

```text
POST /api/student/node-instances/{nodeInstanceId}/audit/retry
```

重新审核接口继续验证登录学生、实例所有权、有效名单、当前节点状态和当前 Submission，不接受客户端传入 Submission ID、学生 ID 或脚本标识。

流程实例中的节点增加可空 `audit`：

```json
{
  "status": "rejected",
  "reason": "材料缺少签名",
  "details": {
    "checkedFileCount": 1,
    "issues": []
  },
  "attemptCount": 1,
  "canRetry": false
}
```

响应规则：

- `reviewing`：返回审核中和当前自动执行次数，不返回内部错误；
- `rejected`：返回脚本的 `reason/details`，`canRetry=false`，学生通过重新上传和提交开始新一轮；
- `audit_error`：返回统一提示“自动审核暂时失败，请重新审核”，不返回内部异常，`canRetry=true`；
- `approved`：可返回通过结果摘要，`canRetry=false`；
- 无审核任务：`audit=null`。

## 前端交互

- 提交接口返回后立即显示“自动审核中”，学生可以离开当前节点页面。
- 只要当前流程存在 `reviewing` 节点，页面每 2 秒重新读取流程实例；不存在时停止轮询。
- `rejected` 节点显示醒目提示；点击后弹窗展示 `reason` 和问题列表，然后允许重新上传。
- `audit_error` 节点显示统一技术异常提示和“重新审核”按钮；按钮调用重试接口，不重新上传文件。
- `approved` 后关闭当前节点编辑区域并自动展示新开放的下游节点。
- 轮询失败只显示非阻断提示，并按后续轮询恢复，不覆盖已有实例数据。

前端运行时类型增加 `audit_error` 和节点审核摘要，不改变教师设计器中的脚本选择结构。

## 错误处理

- 脚本版本或哈希无法解析、OSS 下载失败、文件完整性失败、运行时不可用、超时、非零退出、输出协议错误均归类为技术异常并进入重试。
- `passed=false` 是正常业务结果，不自动重试。
- 最终技术错误仅保存稳定、脱敏的分类文案；stderr、临时路径、环境变量值和第三方响应不得返回学生端。
- 临时审核目录继续由 `TemporaryDirectory` 在成功、业务失败和异常路径清理。
- 状态冲突不覆盖新提交；任务保留最终记录供管理员排查。

## 文件边界

- `backend/app/core/database.py`：表结构与迁移；
- `backend/app/core/config.py`、`backend/.env.example`：环境变量白名单；
- `backend/app/repositories/flow_instances.py`：提交建任务、实例审核摘要；
- `backend/app/repositories/audit_jobs.py`：任务领取、恢复、结果落库、手动重试；
- `backend/app/services/audit_job_worker.py`：worker 生命周期和调度；
- `backend/app/services/audit_script_executor.py`：白名单环境构建；
- `backend/app/api/routes/student_flows.py`：重新审核接口；
- `backend/app/main.py`：启动和停止 worker；
- `frontend/src/features/academic-flow/runtimeTypes.ts`：运行时类型；
- `frontend/src/features/academic-flow/api.ts`：重新审核请求；
- `frontend/src/features/academic-flow/StudentRuntimePage.tsx`：轮询、结果弹窗和重试；
- `frontend/src/styles.css`：审核状态样式。

不修改脚本 manifest 和现有示例脚本协议，不引入 Redis、Celery 或新的前端状态库。

## 验收标准

1. 配置审核脚本的文件节点提交后立即返回 `reviewing`，并产生一条持久化审核任务。
2. 预置脚本实际读取 OSS 文件并执行固定版本；哈希不一致时不执行错误脚本。
3. 通过后节点进入 `approved` 并开放下游；业务不通过进入 `rejected` 并展示脚本 `reason`。
4. 技术异常在初次执行后最多自动重试三次，仍失败则进入 `audit_error`；学生可在不重新上传的情况下重新审核。
5. 服务重启后恢复未完成任务，并为符合条件的既有 `reviewing` 节点补建任务。
6. 重复提交或重复领取不产生重复 Submission、任务或 DAG 推进。
7. 只有白名单环境变量进入脚本，敏感配置和技术异常不暴露给学生。
8. 未配置脚本的节点保持现有提交流程。

## 验证边界

按照本项目约定，实施阶段不由 Codex 运行自动化测试、浏览器测试或构建验证。Codex 完成业务逻辑静态审计、缓存清理、目标文件提交和服务重启后，由用户手动验证完整学生流程。
