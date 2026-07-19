# OSS 对象键归档结构设计

## 1. 目标

调整教师模板和学生提交文件的新上传对象键，使 OSS 控制台中的文件能够按 OA 流程和学生流程实例归档，同时保持数据库为文件关联关系的权威来源。

## 2. 已确认规则

新上传对象使用以下键结构：

```text
coze/files/submissions/{flow_id}/{flow_instance_id}/{timestamp_ns}_{hash8}_{safe_original_name}
coze/files/templates/{flow_id}/{timestamp_ns}_{hash8}_{safe_template_name}
```

- `flow_id` 是教师创建的 OA 流程 ID。
- `flow_instance_id` 是某名学生执行某个已发布流程版本的个人实例 ID。
- `timestamp_ns` 是对象键生成时的 UTC Unix 纳秒时间戳，用于区分连续上传动作。
- `hash8` 是文件 SHA-256 摘要的前 8 个十六进制字符，用于表达文件内容特征，不再使用随机 UUID。
- `safe_original_name` 和 `safe_template_name` 保留原始扩展名及可读名称，但必须移除路径层级和控制字符。
- 配置项 `OSS_PREFIX` 继续作为根前缀；其当前默认值为 `coze/files`，不得在代码中重复硬编码。

## 3. 方案选择

### 3.1 采用：业务归档层级 + 纳秒时间戳 + 内容哈希 + 安全文件名

该方案支持在 OSS 中按流程和学生实例定位文件。纳秒时间戳区分上传动作，哈希片段提供内容识别能力；随机 UUID 不再进入对象键。

### 3.2 不采用：毫秒时间戳 + 内容哈希

相同文件在同一毫秒重复上传时，时间戳、哈希和文件名可能完全相同，进而覆盖对象或触发现有旧文件清理逻辑误删新对象。

### 3.3 不采用：仅使用时间戳和原文件名

同一毫秒内上传同名文件时可能碰撞；不能作为可靠唯一键。

## 4. 数据流

### 4.1 学生提交文件

1. 后端沿用 `get_upload_context()` 完成学生、名单、流程实例、节点状态、时间窗口和模板下载校验。
2. 直接使用上下文中已有的 `flow_id` 与 `flow_instance_id` 构造对象键，不增加数据库查询。
3. 上传到 OSS 后，将完整 `storage_key` 继续写入 `uploaded_files`。
4. 下载、审核脚本取材、替换暂存文件和删除补偿仍以数据库保存的完整 `storage_key` 操作，不从 ID 重新推导路径。

### 4.2 教师模板

1. 后端完成教师归属、文件节点可编辑性、扩展名和大小校验。
2. 使用请求中的 `flow_id` 构造模板对象键。
3. 上传后将完整 `storage_key` 继续写入 `flow_template_assets`。
4. 已发布版本与模板的不可变引用关系保持不变。

## 5. 兼容性

- 不修改数据库结构和 API 响应结构。
- 不批量移动或重命名历史 OSS 对象。
- 历史记录继续使用数据库中原有的完整 `storage_key` 下载或删除。
- 新规则仅影响本次修改部署后的新上传文件，因此新旧对象键可以长期并存。
- 本次不处理已经失去数据库引用的 OSS 孤儿对象；孤儿对象清理由独立任务设计。

## 6. 安全与错误处理

- 用户提交的文件名不得成为额外路径层级；`/`、`\\` 只用于提取末尾文件名。
- ASCII 控制字符替换为下划线，空文件名回退为 `unnamed`。
- OSS 上传失败时不写数据库元数据。
- OSS 上传成功但数据库写入失败时，继续尝试删除刚上传的对象。
- 不把 OSS AccessKey、签名 URL 或完整私有 URL 写入对象键。

## 7. 修改范围

- `backend/app/services/object_storage.py`：增加统一的时间戳文件对象名生成函数。
- `backend/app/api/routes/student_flows.py`：改用 `submissions/{flow_id}/{flow_instance_id}/...`。
- `backend/app/api/routes/workflows.py`：改用 `templates/{flow_id}/...`。
- 不修改前端、数据库表、流程状态、节点权限、模板强制下载或 API 契约。

## 8. 静态验收标准

- 学生新上传对象键符合 `OSS_PREFIX/submissions/flow_id/flow_instance_id/timestamp_ns_hash8_filename`。
- 教师新上传模板对象键符合 `OSS_PREFIX/templates/flow_id/timestamp_ns_hash8_filename`。
- 对象名中的 `hash8` 与本次上传文件的服务端 SHA-256 前 8 位一致，且不再包含随机 UUID。
- 路径型文件名不能突破既定对象键层级。
- 所有下载和删除路径继续读取数据库中的 `storage_key`。
- 按项目约定仅进行业务逻辑静态审计，不运行自动化测试、构建或浏览器测试。
