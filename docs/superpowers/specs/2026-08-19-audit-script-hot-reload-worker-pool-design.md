# 审核脚本热加载与多 Worker 并发设计

> 状态：已批准并完成实现。本文定义当前热加载与并发审核架构的业务语义。

## 1. 背景

当前审核脚本位于 `backend/scripts/<script-id>/versions/<version>/`。流程发布时会把脚本版本、源码哈希、配置哈希、节点参数和运行配置固化到 `flow_versions.config_snapshot`；审核任务执行前再次与磁盘文件比较。

这种模型适合长期保留多个脚本版本，但不适合本项目现在的实际场景：

- 审核脚本由超级管理员集中维护，不需要教师在多个历史版本之间选择；
- 审核脚本源码由服务端部署维护，超级管理员只在前端修改脚本配置，配置保存后立即对线上新审核生效；
- 教师需要频繁追加或删除节点审核提示词，不应每次都重新发布整个流程；
- 多个节点可以使用同一种脚本，但提示词和节点参数不同；
- 多名学生可能同时提交，单一串行 worker 会形成等待队列；
- 脚本或节点审核策略变化后，已经通过的学生不重新审核，尚未完成的审核必须停止并由学生重新提交。

本设计以当前 FastAPI 单进程、SQLite、持久化 `audit_jobs` 和独立 Python/Node 子进程为基础，不引入外部消息队列、文件监听服务或脚本历史版本仓库。

## 2. 目标与非目标

### 2.1 目标

1. 删除审核脚本的业务版本概念和所有 `v1`、`v2` 用户界面。
2. 超级管理员可以在现有“审核脚本”管理界面查看基本信息，并修改参数默认值、运行配置和最大并发数；前端及管理 API 均不暴露或修改源码。
3. 管理端保存成功后无需重启 FastAPI，worker 自动使用新脚本。
4. 教师可以独立修改已发布节点的审核提示词和允许覆盖的节点参数。
5. 同一脚本可以服务多个配置不同的节点，任务之间不得共享可变配置。
6. 在一个 FastAPI 进程内启动多个 worker，并保证任务只被一个 worker 领取。
7. 脚本或节点策略更新时取消受影响的未完成审核，同时保护历史通过结果。
8. 教师预览与正式学生端共用同一套策略解析、任务创建和状态展示逻辑。

### 2.2 非目标

- 不保留旧源码，不提供脚本版本选择、历史版本回滚或灰度发布。
- 不允许任何用户通过前端或管理 API 读取、编辑脚本源码；普通教师也不能修改脚本全局配置或处理能力。
- 不允许发布后更换节点的脚本类型、模板、文件类型或流程拓扑。
- 不在本阶段支持多个 Uvicorn 进程或多台服务器共同消费 SQLite 队列。
- 不把脚本子进程描述为安全沙箱；源码修改属于服务端部署权限，不属于业务管理界面权限。
- 不增加外部队列、Redis、Celery 或文件系统 watcher。

## 3. 方案选择

### 3.1 采用：配置 API 激活、启动时源码同步、内部代际校验、单进程 WorkerPool

管理接口校验并原子写入新配置，再把脚本状态从 `updating` 切回 `ready`。源码由服务端部署替换，服务启动扫描发现源码哈希变化后同步为新代际。两种变化都会取消受影响的未完成任务；每次成功激活只增加内部 `generation`，不产生可选择的历史版本。

该方案与当前项目结构最接近；SQLite 仍负责原子领取和状态事务，Python/Node 子进程仍负责执行隔离。

### 3.2 不采用：保留 `v1/v2`，自动把节点升级到最新版

该方案仍然要求定义历史版本保留、升级、回滚和流程快照迁移规则，与用户要求的“固定脚本、随时热更新”相反，也会继续暴露无业务价值的版本字段。

### 3.3 不采用：直接监听 `backend/scripts` 文件变化

文件 watcher 无法可靠判断部署程序是否已经写完源码，也无法把磁盘替换、任务取消和数据库代际更新组合成明确的业务事务。配置修改以管理 API 为正式写入口；源码部署产生的文件变化只在服务启动扫描中处理。

## 4. 领域模型

系统将审核能力分为三层。

### 4.1 脚本运行定义

作用域为 `script_id`。源码和清单由服务端部署维护，超级管理员只维护配置：

- 脚本名称、说明、语言和入口文件；
- `handler.py` 或 `handler.js` 源码；
- 参数定义及其默认值；
- 脚本级运行配置；
- 文件扩展名能力；
- 单脚本最大并发数。

脚本目录扁平化为：

```text
backend/scripts/
└── confirmation-visual-audit/
    ├── manifest.json
    ├── config.json
    └── handler.py
```

`manifest.json` 不再包含 `version`。`config.json` 增加调度配置：

```json
{
  "acceptedExtensions": [".jpg", ".jpeg", ".png"],
  "parameters": [],
  "runtimeSettings": [],
  "execution": {
    "maxConcurrency": 2
  }
}
```

管理端只允许修改已有参数的默认值、已有运行配置的值和 `maxConcurrency`。参数键、类型、范围、源码、脚本名称与说明、脚本语言、入口文件名及文件扩展名能力均由服务端仓库结构定义，避免线上配置修改使全部节点失去结构兼容性。

### 4.2 节点审核策略

作用域为稳定键 `(flow_id, node_key)`，由流程所有者教师维护：

- `script_id`：发布后只读；
- 审核模式；
- 审核提示词；
- 脚本参数中明确允许节点覆盖的值；
- `generation`：每次成功保存递增；
- `policy_hash`：规范化策略内容的 SHA-256；
- 修改人和修改时间。

策略存入独立表 `node_audit_policies`，不直接覆盖不可变的 `flow_versions.config_snapshot`。流程快照继续固定流程拓扑、稳定节点 ID、模板资产、文件约束和脚本类型；运行时审核提示词及节点参数由策略表提供。

首次发布节点时，从发布配置建立策略。新增节点重新发布时建立新策略。已发布节点后续保存审核策略不创建新流程版本，也不触发已通过节点及下游节点重锁。

### 4.3 审核任务快照

作用域为单次学生提交，创建后不可变。`audit_jobs` 保存：

```text
flow_id
node_key
script_id
script_generation
script_content_hash
policy_generation
policy_hash
effective_params_json
effective_settings_json
status
cancellation_reason
```

`effective_params_json` 已包含该节点当时的审核模式、提示词和参数覆盖；`effective_settings_json` 是任务创建时的脚本全局运行配置。worker 不再从 `flow_versions.config_snapshot` 动态拼接任务参数。

这保证两个使用同一脚本的节点可以并发执行不同提示词和配置，也保证一次任务重试具有确定输入。

### 4.4 多流程、多节点共用同一脚本

脚本运行定义、节点审核策略和审核任务之间是“一对多再一对多”的关系：

```text
一份脚本运行定义
        ↓ 1:N
多个流程节点的审核策略
        ↓ 1:N
大量学生提交形成的审核任务快照
```

例如同一名教师可以这样配置：

| 流程节点 | `script_id` | 节点提示词 | 节点参数 |
|---|---|---|---|
| 流程 A / 节点 1 | `confirmation-visual-audit` | 检查签名和日期 | 阈值 80 |
| 流程 A / 节点 2 | `confirmation-visual-audit` | 检查公章 | 阈值 90 |
| 流程 B / 节点 5 | `confirmation-visual-audit` | 检查负责人签字 | 阈值 70 |

磁盘上只有一份 `confirmation-visual-audit/handler.py`。数据库中分别保存三条 `node_audit_policies`，因此共用脚本只表示共用处理程序，不表示共用提示词、节点参数或执行状态。

配置必须按作用域分类：

- 所有节点必须一致的模型地址、模型名称、超时等，属于脚本全局 `runtimeSettings`；
- 需要因流程或节点不同而变化的提示词、评分标准和阈值，必须定义为节点参数；
- 若一个字段需要每个节点取不同值，就不能放入全局 `runtimeSettings`。

一次“流程 A / 节点 2”的学生提交按以下方式绑定输入：

```text
读取 node_audit_policies(flow-A, node-2)
  → 得到提示词、阈值 90、policy_generation
读取 audit_script_runtime_states(confirmation-visual-audit)
  → 得到 generation、content_hash、全局运行配置
合并为一条不可变 audit_job
  → worker 只能使用该任务快照执行
```

另一名学生同时提交“流程 B / 节点 5”时，会生成另一条任务快照，其中保存阈值 70 和对应提示词。两条任务可以运行同一个入口文件，但其 JSON 输入完全独立。

### 4.5 更新影响范围

脚本更新和节点策略更新必须使用不同的筛选条件：

- 超级管理员修改全局配置，或服务重启时发现已部署源码变化：按 `script_id` 取消所有教师、所有流程和所有节点中尚未完成的相关任务；
- 教师修改某个节点策略：只按 `(flow_id, node_key)` 取消该节点尚未完成的任务；
- 两种更新均不改变已经 `approved` 的提交，也不回锁已经开放的下游节点；
- 修改“流程 A / 节点 2”的提示词，不得影响流程 A 的节点 1、流程 B 的节点 5 或其他教师的流程。

为避免随着教师和流程数量增长而全表扫描，至少建立以下索引：

```text
node_audit_policies: PRIMARY KEY(flow_id, node_key)
audit_jobs: INDEX(script_id, status)
audit_jobs: INDEX(flow_id, node_key, status)
audit_jobs: INDEX(status, next_attempt_at, created_at)
```

正常提交只按 `(flow_id, node_key)` 精确读取一条策略。只有超级管理员修改共享脚本时，才有意按 `script_id` 批量处理所有相关未完成任务。

## 5. 内部代际与内容哈希

数据库新增 `audit_script_runtime_states`：

```text
script_id             PRIMARY KEY
generation            INTEGER NOT NULL
content_hash          TEXT NOT NULL
source_hash           TEXT NOT NULL
config_hash           TEXT NOT NULL
status                ready | updating | error
error_message         TEXT NULL
updated_by            INTEGER NULL
updated_at             TEXT NOT NULL
```

`generation` 和哈希只承担并发控制与审计任务归属，不是脚本历史版本：

- 管理界面不显示“v1/v2”；
- 流程设计器不选择 generation；
- 系统不保存旧源码；
- generation 只递增，不支持回退；
- `content_hash` 由入口源码字节、规范化 `config.json` 以及语言、入口文件等运行身份共同计算；脚本名称和说明不参与运行内容哈希。

管理详情另外返回即时计算的 `editor_hash`，它覆盖名称、说明、源码和配置，但不返回这些源码内容。该哈希用于防止管理员基于过期配置覆盖服务端的新部署。`config.json` 保存成功时立即热激活；源码变化则由下一次服务启动同步为新代际。

启动时目录服务扫描全部脚本，建立缺失的状态记录。若部署文件与数据库哈希不一致，启动初始化把它视为一次新激活：递增 generation，并取消该脚本遗留的未完成任务。运行期间所有正式修改必须经过管理 API。

## 6. 超级管理员编辑与热加载

### 6.1 管理界面

现有“审核脚本管理”统一配置界面调整为：

1. 只读基本信息；
2. 节点参数默认值；
3. 运行配置；
4. 最大并发数；
5. 当前状态、内部 generation、最后更新时间。

界面不出现版本号、源码编辑区、服务器绝对路径、环境密钥或其他脚本文件。脚本名称、说明、语言和入口文件仅作为只读信息展示。

### 6.2 接口

版本路径改为：

```http
GET /api/workflow-admin/audit-scripts/{script_id}
PUT /api/workflow-admin/audit-scripts/{script_id}
```

权限均为 `get_current_super_admin`。保存请求携带：

```json
{
  "expectedEditorHash": "当前编辑内容哈希",
  "parameterDefaults": {},
  "runtimeSettings": {},
  "maxConcurrency": 2
}
```

请求模型禁止额外字段，因此提交 `source`、`name` 或 `description` 返回 `422`。`expectedEditorHash` 不一致返回 `409`，防止两个超级管理员互相覆盖；配置不合法返回 `422`，磁盘写入失败返回 `500`。GET 响应不包含源码。

### 6.3 激活顺序

保存操作在进程级脚本写锁内执行：

1. 读取当前内容并校验 `expectedEditorHash`；
2. 在内存中生成完整配置；
3. 执行配置结构及参数值校验；
4. 把脚本状态改为 `updating`，使领取查询暂时排除该脚本；
5. 在一个 SQLite 事务中取消该脚本全部 `pending`、`running` 任务并记录原因 `script_updated`；
6. 通知本进程正在运行的相关子进程停止；
7. 使用 `os.replace` 原子替换配置；替换期间脚本保持 `updating`，worker 不会读取半更新状态；
8. 重新从磁盘解析并计算哈希；
9. generation 递增，写入新哈希并把状态改为 `ready`；
10. 返回服务器重新读取后的完整详情。

若第 7 至第 9 步失败，脚本保持 `error`，不接受新任务。管理员修正并再次成功保存后才能恢复 `ready`，系统不把部分更新宣称为成功。源码部署若包含语法或业务错误，将在任务执行时按现有“审核服务异常”处理，不能伪装成业务审核不通过。

## 7. 教师修改节点审核策略

### 7.1 编辑边界

发布后节点审核设置从流程修订中分离：

- 标题、说明、起止时间继续走流程修订与重新发布；
- 审核提示词、审核模式和允许覆盖的节点参数通过独立“保存审核规则”即时生效；
- 脚本类型、模板、文件扩展名、审核开关和拓扑仍锁定；
- 普通教师只能修改自己流程中的策略。

保存接口：

```http
PUT /api/workflows/{flow_id}/nodes/{node_key}/audit-policy
```

请求携带 `expectedGeneration`、提示词、审核模式和节点参数。后端重新校验流程归属、节点稳定 ID、脚本参数定义和教师可覆盖范围；代际冲突返回 `409`。

### 7.2 保存影响

策略保存成功时，在同一数据库事务中：

1. policy generation 递增并写入新 hash；
2. 只取消该 `(flow_id, node_key)` 下 `pending`、`running` 的任务；
3. 取消原因记录为 `policy_updated`；
4. 已经 `approved` 的提交和节点不变；
5. 不影响同一脚本在其他流程或节点上的任务。

教师预览中，已发布节点读取同一份当前策略；未发布的新节点读取草稿配置。正式学生端只读取当前策略。两者最终通过同一个 `resolve_effective_audit_policy()` 生成任务输入。

## 8. 多 Worker 并发模型

### 8.1 生命周期

FastAPI lifespan 不再为每个 worker 单独恢复任务，而是启动一个池：

```text
initialize_database()
  → synchronize_audit_script_states()
  → recover_audit_jobs()       只执行一次
  → start_audit_worker_pool(4)
      ├── audit-worker-1
      ├── audit-worker-2
      ├── audit-worker-3
      └── audit-worker-4
```

全局 worker 数由后端设置 `AUDIT_WORKER_COUNT` 控制，默认值为 `4`。它表示同一时刻最多执行四个审核子进程，不等同于 Uvicorn 进程数。

### 8.2 原子领取

每个 worker 使用现有 SQLite `BEGIN IMMEDIATE` 模式领取任务：

1. 查询最早的、状态为 `pending`、已到执行时间的任务；
2. 排除脚本状态不是 `ready` 的任务；
3. 排除该脚本当前 `running` 数量已经达到 `maxConcurrency` 的任务；
4. 条件更新 `pending → running`；
5. 只有更新一行成功的 worker 获得任务。

领取顺序仍按 `next_attempt_at, created_at`，不引入复杂的权重调度。单脚本并发上限防止一个慢脚本占用全部执行资源；管理员可以根据外部模型限流调整该值。

### 8.3 任务执行

worker 领取后按以下链路执行：

```text
学生提交
  → 在提交事务中解析脚本状态和节点策略
  → 创建 submission(reviewing) 与 audit_job(pending)
  → worker 原子领取
  → 校验任务 generation/hash 仍为当前值
  → 为本任务建立独立临时目录
  → 下载并校验本任务材料
  → 启动独立 Python/Node 子进程
  → 通过 stdin 传入任务自己的参数与配置快照
  → 校验 stdout JSON 协议
  → 在完成事务中再次校验任务状态和 generation/hash
  → 写入通过、不通过或执行异常结果
```

每个任务拥有独立子进程、临时目录和 JSON 输入。脚本代码不会作为 Python 模块导入 FastAPI，因此不存在模块级 import 缓存；新任务每次都从当前 `ready` 脚本入口启动进程。

### 8.4 同一脚本的并发执行

脚本不会在服务启动时常驻加载到 worker 内存。每个 worker 领取任务后，都为该任务启动一个新的 Python/Node 子进程。因此多个 worker 可以同时执行同一个 `handler.py`：

```text
worker-1 → confirmation-visual-audit / 流程 A / 节点 1 / 提示词 A
worker-2 → confirmation-visual-audit / 流程 A / 节点 2 / 提示词 B
worker-3 → confirmation-visual-audit / 流程 B / 节点 5 / 提示词 C
worker-4 → docx-word-count-check    / 流程 C / 节点 3
```

四个 worker 使用四个独立子进程、临时目录和 stdin JSON，不共享脚本内部变量。`maxConcurrency` 只限制同一 `script_id` 最多同时占用多少 worker；在不超过外部模型限流和服务器资源的前提下，同一脚本可以并发占用多个 worker。

这里的“热加载”准确含义是“脚本文件热激活”：worker 不缓存脚本模块，超级管理员完成原子替换并把脚本状态恢复为 `ready` 后，下一条任务启动的新子进程自然读取新入口文件，不需要重启 FastAPI 或重建 worker 池。

## 9. 运行中取消与结果提交保护

`audit_jobs.status` 扩展为：

```text
pending | running | succeeded | failed | cancelled
```

任务取消时：

- job 改为 `cancelled` 并记录 `cancellation_reason`、`finished_at`；
- 当前提交改为 `cancelled`；
- 仅当它仍是节点当前 attempt 时，节点从 `reviewing` 恢复为 `available`；
- 历史提交、文件和审核记录不删除；
- 学生必须创建新的 attempt 重新上传并提交；
- 已通过节点不回退，已经开放的下游节点不重锁。

WorkerPool 维护一个仅限当前进程的取消注册表：`job_id → threading.Event`。worker 在启动子进程前注册，激活脚本或更新策略后对受影响的运行任务设置事件。执行器在现有子进程输出轮询中检查事件，收到后终止子进程并释放 worker 槽位。

无论进程是否及时停止，`complete_audit_job()` 和 `fail_audit_job()` 都必须使用条件写入并重新检查：

```text
job.status == running
任务仍是节点当前 attempt
script_generation 与当前脚本一致
script_content_hash 与当前脚本一致
policy_generation 与当前策略一致
policy_hash 与当前策略一致
```

任一条件不满足，旧结果直接丢弃，不得覆盖新提交或改变节点状态。

学生端对取消原因显示统一业务文案：

- `script_updated`：审核程序已更新，请重新提交材料。
- `policy_updated`：审核要求已更新，请重新提交材料。

预览端和正式学生端必须使用相同状态映射与重新提交交互。

## 10. 重试与故障恢复

- 业务结果 `passed=false` 仍然是正常审核结果，节点进入 `rejected`。
- 子进程异常、超时、输出协议错误按现有重试间隔重试；耗尽后进入 `audit_error`。
- `cancelled` 任务不允许点击“重新审核”，必须产生新的学生提交。
- 服务重启时只由 WorkerPool supervisor 调用一次 `recover_audit_jobs()`。
- 恢复前先同步脚本状态；若任务 generation 已过期，直接取消而不是恢复为 `pending`。
- 对于仍有效的遗留 `running` 任务，恢复为 `pending`。
- 若发现节点为 `reviewing` 但没有对应任务，系统不从流程快照猜测脚本配置；当前提交改为 `cancelled`，节点恢复为 `available`，并提示审核任务异常、需要重新提交。
- 过期预览的任务继续沿用当前清理规则，不得被正式 worker 恢复。

## 11. 数据迁移

### 11.1 脚本目录

每个脚本只迁移当前实际入口：

```text
versions/1/handler.py  → handler.py
versions/1/config.json → config.json
```

随后删除 manifest 中的 `version`，删除空的 `versions/` 目录。代码和接口不再接受版本参数。

### 11.2 数据库

1. 新建 `audit_script_runtime_states` 和 `node_audit_policies`。
2. 重建 `audit_jobs`，删除 `script_version`，增加任务快照、generation、hash 和取消字段。
3. 从每个已发布流程当前节点配置初始化节点审核策略。
4. 已经 `approved`、`rejected`、`audit_error` 的历史提交保持原状态。
5. 部署切换时取消所有旧 `pending`、`running` 审核任务，原因记为 `script_updated`，避免旧模型和新模型混跑。
6. 老流程快照中的 `auditScriptVersion`、`auditScriptHash`、`auditScriptConfigHash` 暂时保留为历史 JSON，不再参与运行和修订比较；新发布快照不再写入这些字段。
7. 删除未被当前运行代码使用的 `audit_script_versions` 版本表；`audit_scripts` 旧表在迁移确认无业务引用后删除，脚本目录和新的运行状态表成为唯一来源。

数据库迁移不得删除历史学生提交、上传文件、审核结果、名单或流程实例。

## 12. 发布修订语义调整

本设计有意替代当前“提示词变化必须重新发布且使节点及下游失效”的规则：

- 流程发布版本继续不可变；
- 已发布流程的标题、说明、时间及结构变化仍按现有修订影响分析处理；
- 审核提示词和允许覆盖的节点参数改由可变策略管理；
- 策略修改只取消未完成审核，不使已通过节点和下游重新完成；
- `workflow_revision.BUSINESS_NODE_FIELDS` 不再用提示词和节点审核参数判断流程版本差异；
- 设计器应把“流程修订保存”和“审核规则热更新”呈现为两个明确动作。

## 13. 权限与安全边界

- 源码与脚本基本信息：仅由服务端部署维护，前端及管理 API 不提供写入口。
- 全局配置和最大并发：仅超级管理员可修改。
- 节点提示词及允许覆盖的节点参数：流程所有者教师。
- 后端权限和资源归属是最终边界，不能只依赖前端隐藏控件。
- 脚本 ID 必须经过目录服务解析，接口不能接收相对路径或入口文件名。
- 源码继续受 `audit_script_max_bytes` 限制；配置继续执行类型、范围和大小校验。
- 子进程继续只获得环境变量白名单，不把完整 `.env` 传入脚本。
- 任务输出继续校验 `schemaVersion`、`passed`、`reason` 和 `details`，学生文案不得泄露内部路径、对象键和技术异常。

## 14. 可观测性

服务日志记录以下结构化事件，但不记录材料内容、提示词全文、源码或密钥：

- 脚本激活成功或失败：script ID、旧/新 generation、操作者、哈希前缀；
- 策略更新：flow ID、node key、旧/新 generation、操作者；
- 任务领取、完成、重试、取消：job ID、script ID、取消原因、耗时；
- worker 池启动和停止：worker 数量；
- 脚本并发上限命中。

超级管理员列表显示脚本状态、当前运行数、等待数和最大并发数，便于判断学生是否因脚本限流排队。

## 15. 验收标准

1. 项目源码、API、界面和新流程快照中不再产生审核脚本版本字段或 `v1` 文案。
2. 超级管理员修改全局配置并保存后，不重启服务即可让新提交使用新配置；服务端部署的新源码在服务重启同步后生效。
3. 修改期间 worker 不会领取该脚本的新任务，也不会执行半写入文件。
4. 脚本更新只取消使用该脚本的未完成任务；节点策略更新只取消对应流程节点的未完成任务。
5. 已审核通过的学生节点、下游开放状态和历史结果不受脚本或策略更新影响。
6. 被取消审核的学生看到明确原因，并能创建新的提交。
7. 同一脚本下两个节点使用不同提示词和参数并发执行时，子进程输入互不污染。
8. 默认四个 worker 能同时处理四个符合调度条件的任务，且同一任务不会被重复领取。
9. 脚本达到自身并发上限时，其他脚本的符合条件任务仍可被领取。
10. 脚本更新发生在任务执行中时，旧子进程被终止或其结果被提交保护拒绝。
11. 服务重启只恢复一次任务；过期 generation 和已取消任务不会重新进入队列。
12. 教师预览和正式学生端显示相同的审核策略、取消状态和重新提交操作。
13. 普通教师不能修改脚本全局配置；包括超级管理员在内的前端用户均不能通过脚本接口读取或修改源码，也不能访问脚本目录文件。

## 16. 实施边界

该能力涉及目录契约、数据库迁移、发布修订、管理端编辑器、学生提交事务、worker 池和取消状态，实施计划应拆成连续但可分别审查的任务，并以一次完整切换交付，不保留新旧两套运行链路。

按照项目 `AGENTS.md`，实施阶段只进行业务逻辑审计，不运行自动化测试、前端构建或浏览器插件；完成后进行任务范围结果提交、清理限定缓存、本地非 Docker 服务重启以及 `8000`、`5173` 端口进程核对，并明确说明未执行的运行时验证。
