# 阿里云 OSS 文件托管设计

## 目标

为流程中的“文件上传”节点提供真实附件持久化：学生上传的非结构化文件保存至阿里云 OSS，关系型元数据、流程关联与审计信息继续保存在 SQLite。

## 已确认约束

- 存储桶：`aidata-lm`。
- 对象键统一位于 `oss://aidata-lm/coze/files/` 前缀下。
- OSS 访问凭证仅在后端运行环境以环境变量配置；不得写入源码、测试数据、文档或 Git 历史。
- 上传采用“浏览器 -> FastAPI -> OSS”的后端中转方式；浏览器不持有 OSS AccessKey。
- 流程节点仍以 DAG 的节点状态推进；文件上传本身不改变节点审批或开放规则。

## 方案比较

| 方案 | 优点 | 局限 | 结论 |
| --- | --- | --- | --- |
| 后端中转上传 | AccessKey 不离开后端；权限可复用现有学生会话；可在写入 OSS 前完成节点、名单、后缀、大小与哈希校验 | 上传流量经过后端 | 采用 |
| 浏览器直传 + STS | 后端带宽压力较低 | 需要额外 RAM/STS 配置与临时策略管理 | 不采用 |
| 浏览器直传长期 AccessKey | 实现表面简单 | 会泄露高权限密钥 | 禁止 |

## 架构与数据流

1. 学生在已开放的文件节点选择附件；前端以 `multipart/form-data` 调用节点上传接口。
2. 后端通过学生会话和名单核验其对节点实例的写入权限，再读取已发布版本中的文件后缀与大小限制。
3. 后端流式读取附件，计算 SHA-256，并通过阿里云 OSS SDK 上传到下列键空间：

   ```text
   coze/files/{flow_version_id}/{flow_instance_id}/{node_key}/{upload_id}/{sanitized_filename}
   ```

4. OSS 上传成功后，后端将对象键、原始文件名、内容类型、字节数、SHA-256、ETag、上传人和节点实例写入 SQLite。
5. 前端仅保留 `fileId` 与可展示元数据；提交节点时后端只接受属于该学生和该节点的已上传 `fileId`。不能伪造对象键、文件名或大小。
6. 文件节点提交成功后，上传记录关联本次 submission；重新选择文件时，未关联提交的旧对象和元数据由后端删除，以避免无主对象积累。
7. 下载接口在重新校验所属学生与节点权限后，生成短时 OSS 签名 URL；对象保持私有，不开放公共读。

## 后端边界

| 单元 | 职责 |
| --- | --- |
| `app/core/config.py` | 读取 `OSS_ENDPOINT`、`OSS_BUCKET`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`OSS_PREFIX=coze/files` 与签名 URL 有效期；缺失配置时明确拒绝真实上传。 |
| `app/services/object_storage.py` | 封装 OSS 客户端、对象键生成、上传、删除与签名下载；不感知 HTTP 或 SQLite。 |
| `app/repositories/flow_files.py` | 维护上传文件元数据、所有者校验、提交关联和旧暂存文件清理。 |
| `app/api/routes/student_flows.py` | 提供学生文件上传与下载端点，复用既有学生会话和流程实例权限。 |
| `app/repositories/flow_instances.py` | 在提交时把合法的 `fileId` 关联至 submission，并继续执行 DAG 状态推进。 |

## 数据模型

新增 `uploaded_files` 表：

| 字段 | 说明 |
| --- | --- |
| `id` | UUID，前端提交时引用的唯一文件标识。 |
| `node_instance_id` | 所属文件节点实例。 |
| `student_account_id` | 上传人，用于所有权检查。 |
| `submission_id` | 首次成功提交后关联；暂存时为空。 |
| `storage_key` | OSS 对象键，不保存完整私有 URL。 |
| `original_name`、`content_type` | 原始展示信息。 |
| `size_bytes`、`sha256`、`etag` | 完整性和审计信息。 |
| `created_at` | 上传时间。 |

`submissions.payload_snapshot` 将保存受服务端确认的文件元数据（含 `fileId`），但对象键的权威来源是 `uploaded_files`。

## API 与前端交互

| 接口 | 请求 | 行为 |
| --- | --- | --- |
| `POST /api/student/node-instances/{node_instance_id}/file` | multipart 字段 `file` | 校验并上传；返回 `fileId`、文件名、大小、类型。 |
| `GET /api/student/files/{file_id}/download` | 无 | 权限检查后返回短时签名下载 URL。 |
| `POST /api/student/node-instances/{node_instance_id}/submit` | `payload.file.fileId` | 仅接受同一节点、同一学生且尚可提交的上传文件。 |

前端在选择文件后显示“正在上传”，在成功返回前禁用提交按钮；上传失败时保留明确错误，不把本地文件名伪装为已上传附件。

## 错误处理与安全

- 未配置 OSS、认证失败、网络超时或 OSS 返回错误：返回可理解的 5xx/4xx 错误，且不创建数据库元数据。
- 节点未开放、名单无权、后缀不允许、超出大小限制、`fileId` 跨节点或跨学生：拒绝请求。
- 文件上传到 OSS 后数据库写入失败：立即尝试删除该对象，避免孤儿文件。
- 对象命名使用 UUID 目录和文件名净化，拒绝路径穿越字符；不将用户输入直接作为对象路径。
- AccessKey 使用最小权限 RAM 子账号，策略限制为桶 `aidata-lm` 的 `coze/files/*` 前缀；生产环境应将密钥置于密钥管理或部署平台的机密变量中，并定期轮换。

## 验证

1. 使用伪造的对象存储客户端进行后端单元测试：对象键、权限、后缀/大小校验、提交关联、失败补偿和签名下载。
2. 使用 FastAPI 集成测试验证 multipart 上传及非法 `fileId` 拒绝。
3. 在本机以 `.env` 配置真实 OSS 后进行一次小文件端到端冒烟测试：上传、对象存在性、数据库元数据、签名下载均通过；不将该文件或凭证提交至 Git。

## 非目标

- 不改为浏览器直传 OSS 或 STS。
- 不把二进制附件写入 SQLite。
- 本次不实现教师批量下载、生命周期归档或跨桶复制；接口和元数据模型为后续扩展保留边界。
