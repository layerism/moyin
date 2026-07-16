# OA 流程发布、填写与状态追踪设计

## 1. 目标

教师通过现有低代码设计器配置 OA DAG 流程。流程发布后生成高熵共享链接；学生打开链接时必须注册或登录，登录成功后进入统一的学生填写页面。所有学生共享同一份流程定义，但系统为每名学生维护独立的流程实例、节点状态、填写数据与审核记录。

本设计采用“版本化流程定义 + 关系型运行实例”方案。流程定义以 JSON 快照保存，运行状态使用关系表保存，以同时满足灵活配置、状态约束、统计查询和审计追踪要求。

## 2. 核心规则

1. 教师可反复编辑草稿；草稿不对学生开放。
2. 发布时生成不可变的流程版本，冻结节点、连线、表单字段、附件规则及审核规则。
3. 已发布版本不允许修改节点结构，只允许修改节点统一截止时间。
4. 每次截止时间修改必须记录修改人、原值、新值、原因和修改时间。
5. 教师可以为个别学生设置延期时间；个别延期优先于节点统一截止时间。
6. 超过有效截止时间后禁止提交；教师延期后，尚未提交的节点恢复为可填写。
7. 一个学生在一个流程版本下仅有一个流程实例，可暂存并继续填写。
8. 学生最终提交节点后，该次提交形成不可变版本；被退回后以新版本再次提交。
9. 所有学生共享流程结构，但节点进度、填写内容、附件、审核结果相互隔离。
10. 已产生的提交、审核及逾期事实不因后续截止时间调整而回溯改写。
11. 每个流程维护独立学生名单；学生姓名和学号必须同时匹配有效名单记录。
12. 名单权限持续校验，教师移除学生后，其既有实例保留但立即停止访问。

## 3. 系统边界

### 3.1 教师设计域

- 负责流程草稿、DAG 校验、节点配置、发布和停用。
- 发布前校验无环图、连接完整性、必填字段、节点标识唯一性和截止时间合法性。
- 发布操作将当前草稿转换为不可变 `FlowVersion` 快照。

### 3.2 共享访问域

- 每个已发布流程生成至少一个高熵访问令牌。
- URL 仅包含随机令牌，不包含流程 ID、学生 ID、学号等业务标识。
- 数据库保存校验用令牌哈希及教师恢复链接所需的令牌值；数据库管理界面对令牌值脱敏。
- 未认证的分享元数据接口只返回流程名称和说明，不返回节点、连线或名单。
- 令牌支持启用、停用、失效时间和重新生成；重新生成后旧令牌立即失效。

### 3.3 学生运行域

- 未登录用户访问共享链接时，将令牌保存到短期服务端会话并跳转登录或注册。
- 登录成功后恢复原始访问意图，校验令牌并进入填写页面。
- 首次进入时，以 `(flow_version_id, student_user_id)` 幂等创建 `FlowInstance`。
- 后续访问复用原实例，恢复各节点状态及暂存数据。

### 3.4 审核与追踪域

- 节点提交、审核、退回、重新提交、延期和截止时间修改全部产生审计事件。
- 教师端支持流程级进度统计和学生级节点追踪。
- 审核脚本只输出结构化结果，不直接修改数据库；业务服务验证结果后执行状态迁移。

## 4. 数据模型

### 4.1 流程定义

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `flows` | `id`, `name`, `description`, `owner_id`, `status`, `draft_config`, `created_at`, `updated_at` | 流程主体和当前草稿 |
| `flow_versions` | `id`, `flow_id`, `version_no`, `config_snapshot`, `config_hash`, `published_by`, `published_at`, `status` | 不可变发布快照 |
| `flow_node_runtime_configs` | `flow_version_id`, `node_key`, `deadline_at`, `updated_by`, `updated_at` | 发布后允许修改的节点运行参数 |
| `share_tokens` | `id`, `flow_version_id`, `token_hash`, `token_value`, `status`, `expires_at`, `created_by`, `created_at` | 高熵共享链接 |
| `flow_roster_entries` | `id`, `flow_id`, `student_no`, `name`, `status`, `updated_by`, `created_at`, `updated_at` | 流程级学生访问名单 |

`config_snapshot` 保存设计器导出的完整配置，包括：

- 流程元数据与配置格式版本；
- 节点稳定标识、类型、位置、字段、附件和审核规则；
- 边稳定标识、源节点、目标节点和端口；
- DAG 入口、条件分支和节点开放规则。

发布快照中的节点必须使用稳定 `node_key`。运行表只引用 `node_key`，不得依赖节点标题或画布坐标。

### 4.2 学生实例

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `flow_instances` | `id`, `flow_version_id`, `student_user_id`, `status`, `started_at`, `completed_at`, `last_active_at` | 学生流程实例 |
| `node_instances` | `id`, `flow_instance_id`, `node_key`, `status`, `opened_at`, `submitted_at`, `approved_at`, `attempt_no` | 学生节点状态 |
| `node_drafts` | `node_instance_id`, `payload`, `updated_at` | 当前暂存数据 |
| `submissions` | `id`, `node_instance_id`, `attempt_no`, `payload_snapshot`, `submitted_at`, `status` | 不可变提交版本 |
| `uploaded_files` | `id`, `node_instance_id`, `student_account_id`, `submission_id`, `storage_key`, `original_name`, `content_type`, `size_bytes`, `sha256`, `etag` | OSS 附件元数据；上传后暂存，提交成功后关联 submission |
| `student_deadline_overrides` | `flow_instance_id`, `node_key`, `deadline_at`, `reason`, `created_by`, `created_at` | 个别学生延期 |
| `audit_logs` | `id`, `actor_id`, `action`, `entity_type`, `entity_id`, `before_data`, `after_data`, `reason`, `created_at` | 统一审计记录 |

数据库约束：

- `flow_versions(flow_id, version_no)` 唯一；
- `flow_instances(flow_version_id, student_user_id)` 唯一；
- `node_instances(flow_instance_id, node_key)` 唯一；
- `submissions(node_instance_id, attempt_no)` 唯一；
- `uploaded_files(storage_key)` 唯一；未提交附件只能被所属学生和节点引用；
- 所有状态迁移在数据库事务中完成。

## 5. 状态模型

### 5.1 流程版本

```text
draft -> published -> disabled
```

`published` 版本的结构快照不可更新。教师需要修改结构时，从既有版本复制出新草稿，重新发布为下一版本；已有学生实例继续引用原版本。

### 5.2 学生流程实例

```text
not_started -> in_progress -> completed
                         \-> closed
```

### 5.3 学生节点实例

```text
locked -> available -> draft -> submitted -> reviewing -> approved
                   \                         \-> rejected -> available
                    \-> expired
```

- `locked`：上游条件尚未满足。
- `available`：允许填写和提交。
- `draft`：已暂存但未提交。
- `submitted/reviewing`：禁止学生修改，等待审核。
- `rejected`：保留原提交版本，创建新的填写尝试。
- `approved`：节点完成，并触发下游节点开放计算。
- `expired`：超过有效截止时间且尚未提交；教师延期后可恢复为 `available` 或 `draft`。

有效截止时间计算：

```text
effective_deadline = student_override.deadline_at ?? node_runtime.deadline_at
```

所有截止时间以 UTC 存储，前端按 `Asia/Shanghai` 展示。服务端时间是提交是否合法的唯一判定依据。

## 6. 主要流程

### 6.1 发布

1. 教师请求发布草稿。
2. 服务端进行 JSON Schema、DAG、字段和规则校验。
3. 校验流程至少存在一名有效名单学生。
4. 在事务中创建 `flow_versions`、节点运行配置和共享令牌。
5. 返回共享 URL；教师后续可从流程详情恢复同一有效链接。

### 6.2 学生访问与登录回跳

1. 学生访问 `/s/{token}`。
2. 服务端哈希令牌并校验状态、失效时间和流程版本状态。
3. 未登录时记录短期 `return_ticket`，跳转注册或登录。
4. 登录成功后消费 `return_ticket`，再次校验共享令牌。
5. 按当前账号的姓名和学号校验 `flow_roster_entries` 有效记录。
6. 幂等创建或读取学生流程实例，并重定向至 `/student/flows/{instanceId}`。

`return_ticket` 必须一次性使用、短期有效，并与浏览器会话绑定，防止开放重定向和令牌固定攻击。

### 6.3 暂存与提交

1. 暂存接口验证字段格式，但允许必填字段暂时不完整。
2. 提交接口重新读取节点状态、上游条件和有效截止时间。
3. 服务端校验完整数据和附件，创建不可变 `Submission`。
4. 节点进入 `submitted` 或 `reviewing`；审核完成后更新为 `approved` 或 `rejected`。
5. 节点通过后，DAG 执行服务计算可开放的下游节点。

提交接口必须使用幂等键，避免网络重试生成重复提交。

文件节点先调用 `POST /api/student/node-instances/{nodeInstanceId}/file`，后端校验学生权限、文件后缀、大小和 SHA-256 后，将二进制写入阿里云 OSS 私有前缀 `coze/files/`，并返回 `fileId`。提交接口只接受同一学生、同一节点且尚未关联提交的 `fileId`，服务端重新读取附件元数据后写入提交快照。下载通过 `GET /api/student/files/{fileId}/download` 生成 600 秒有效的签名 URL。

### 6.4 截止与延期

1. 教师修改统一截止时间时，仅更新 `flow_node_runtime_configs`。
2. 教师为个别学生延期时，写入 `student_deadline_overrides`。
3. 请求时实时计算有效截止时间；后台任务仅负责批量标记和提醒，不作为权限判定依据。
4. 延期后，未提交节点根据原暂存状态恢复为 `available` 或 `draft`。

## 7. API 边界

### 7.1 教师端

- `POST /api/flows`
- `PUT /api/flows/{flowId}/draft`
- `POST /api/flows/{flowId}/publish`
- `POST /api/flow-versions/{versionId}/share-tokens`
- `DELETE /api/share-tokens/{tokenId}`
- `PATCH /api/flow-versions/{versionId}/nodes/{nodeKey}/deadline`
- `PUT /api/flow-instances/{instanceId}/nodes/{nodeKey}/deadline-override`
- `GET /api/flow-versions/{versionId}/progress`
- `GET /api/flow-instances/{instanceId}`
- `GET /api/workflows/{flowId}/roster`
- `POST /api/workflows/{flowId}/roster/import`
- `DELETE /api/workflows/{flowId}/roster/{entryId}`

### 7.2 学生端

- `GET /s/{token}`
- `GET /api/student/flow-instances/{instanceId}`
- `PUT /api/student/node-instances/{nodeInstanceId}/draft`
- `POST /api/student/node-instances/{nodeInstanceId}/files`
- `POST /api/student/node-instances/{nodeInstanceId}/submit`

所有学生接口必须从登录会话取得 `student_user_id`，并同时验证实例所有权和当前有效名单；客户端传入的学生标识不参与授权。

## 8. 安全与一致性

- 共享令牌至少包含 128 位随机熵，使用密码学安全随机数生成器。
- 令牌在日志、监控、分析参数和 Referer 中必须脱敏。
- 登录密码使用成熟密码哈希算法；认证会话使用 `HttpOnly`、`Secure`、`SameSite` Cookie。
- 附件保存至对象存储或受控文件存储，数据库只保存存储键和校验信息。
- 当前实现使用阿里云 OSS：`OSS_ENDPOINT`、`OSS_BUCKET`、`OSS_PREFIX`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET` 和 `OSS_SIGNED_URL_EXPIRES_SECONDS` 从后端 `.env` 读取；AccessKey 不下发到浏览器。
- OSS 上传成功但数据库写入失败时删除对象；同一节点重新上传时清理未关联 submission 的旧对象。
- 上传接口校验扩展名、MIME、大小和内容安全策略。
- 流程发布、截止时间更新、提交与审核必须使用事务和乐观锁。
- 教师只能访问自己管理范围内的流程；学生只能访问自己的实例。
- 名单外或已移除学生统一返回 `403`，不泄露其他名单记录。

## 9. 教师追踪界面

流程级列表至少显示：学生、整体状态、当前可操作节点、已完成节点数、逾期节点数、最后活动时间。

学生详情至少显示：DAG 节点状态、每次提交版本、附件、审核结论、截止时间、个别延期和完整操作时间线。

统计数据从关系型运行表查询，不从流程 JSON 快照反向推断。

## 10. 错误处理

- 共享令牌无效或停用：返回统一的链接不可用页面，避免泄露流程存在性。
- 登录回跳失效：要求用户重新打开共享链接。
- 流程已停用：保留历史记录，但禁止创建新实例和新提交。
- 状态冲突：返回 `409 Conflict` 及最新节点状态，前端刷新数据。
- 截止时间已过：返回 `422` 和有效截止时间，不接受客户端时间覆盖。
- 附件上传失败：保持草稿和已成功附件，不生成提交记录。
- 审核脚本异常：节点保持 `reviewing`，记录异常并允许教师人工处理。

## 11. 测试策略

### 11.1 单元测试

- DAG 校验、节点开放计算和条件分支。
- 有效截止时间及个别延期优先级。
- 节点状态迁移合法性。
- 令牌生成、哈希、停用和失效判定。

### 11.2 集成测试

- 发布事务及配置快照不可变性。
- 未登录访问、注册登录和原链接回跳。
- 同一学生重复访问只创建一个流程实例。
- 暂存、提交、审核、退回和重新提交。
- 并发提交、重复请求和幂等键。
- 统一截止时间调整及个别延期恢复。
- 名单导入、更新、撤销、恢复及审计记录。
- 名单外学生拒绝进入；撤销后既有实例的读取、暂存和提交均被拒绝。

### 11.3 端到端测试

- 教师设计并发布流程，复制共享链接。
- 新学生通过链接注册登录并完成多节点填写。
- 两名学生共享同一流程结构但具有独立进度。
- 教师查看总体进度并为单个学生延期。
- 截止后禁止提交，延期后允许继续提交。

## 12. 分阶段实施

1. 建立流程定义、发布快照、共享令牌及数据库迁移。
2. 完成学生登录回跳、流程实例和节点状态机。
3. 完成表单暂存、附件、提交、审核和 DAG 推进。
4. 完成教师进度追踪、截止时间和个别延期。
5. 补充审计、安全加固、并发测试和端到端测试。
