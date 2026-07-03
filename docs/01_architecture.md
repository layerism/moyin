# 材料收集应用架构草案

## 目标

系统面向材料收集场景，提供一个类似腾讯文档的简化版 Web 应用。管理员创建材料收集任务，用户在线填写基本信息并上传若干 `.docx` 文档。系统在提交后将材料归档到阿里云 OSS，并记录提交状态、文件清单和检查结果。

系统的特殊能力是“文档格式检查与自动批注”。该能力不在平台内部硬编码具体规则，而是允许管理员为不同材料任务配置一个自动编辑 `.docx` 的 Python 脚本。系统在安全隔离环境中运行该脚本，对上传文档进行格式检查、自动批注，并生成带批注的检查版本。

## 用户角色

| 角色 | 主要能力 |
| --- | --- |
| 管理员 | 创建收集任务、配置字段、配置需上传的文档类型、配置 DOCX 检查脚本、查看提交结果 |
| 提交用户 | 填写基本信息、上传 DOCX 材料、查看检查结果、重新提交材料 |
| 审核人员 | 查看归档材料、下载原始文档和批注文档、确认材料是否合格 |

## 核心模块

| 模块 | 职责 | 当前状态 |
| --- | --- | --- |
| 认证与权限 | 用户登录、角色区分、任务访问控制 | 待实现 |
| 收集任务管理 | 创建任务，配置截止时间、基础字段、材料清单和提交规则 | 待实现 |
| 在线填写 | 用户填写姓名、学号、联系方式等基础信息 | 待实现 |
| 文档上传 | 上传多个 `.docx` 文档，校验文件类型、大小和数量 | 待实现 |
| OSS 归档 | 将原始文档、批注文档和元数据归档到阿里云 OSS | 待实现 |
| 脚本配置 | 管理员上传或选择 Python 检查脚本，并绑定到收集任务 | 待实现 |
| 格式检查与自动批注 | 运行脚本检查 DOCX 格式，生成检查结果和带批注文档 | 待实现 |
| 审核与状态 | 展示提交状态、检查状态、审核状态和退回原因 | 待实现 |

## 最小功能边界

第一版应保证以下闭环：

1. 管理员创建一个材料收集任务。
2. 管理员配置基础信息字段，例如姓名、学号、班级、联系方式。
3. 管理员配置需要上传的 DOCX 材料清单。
4. 管理员为任务配置一个 Python DOCX 检查脚本。
5. 用户进入任务页面，填写基础信息并上传全部必需文档。
6. 系统强制校验必填信息和必传文档，未完成则不允许提交。
7. 提交后，系统将原始文档上传到阿里云 OSS。
8. 后端触发 DOCX 检查脚本，生成检查结果和带批注文档。
9. 系统将批注文档和检查 JSON 结果上传到 OSS。
10. 管理员或审核人员查看提交记录、下载材料并确认状态。

## 推荐数据流

1. 管理员创建材料收集任务。
2. 管理员配置基础字段、必传文档清单和 DOCX 检查脚本。
3. 用户打开任务页面，填写基础信息并上传 DOCX 文档。
4. 前端校验必填字段和必传文件是否完整。
5. 后端再次校验任务规则，生成提交记录。
6. 后端将原始 DOCX 上传到阿里云 OSS。
7. 后端异步触发格式检查任务。
8. 检查任务下载原始 DOCX，运行管理员配置的 Python 脚本。
9. 脚本输出检查结果 JSON，并生成带批注的 DOCX。
10. 后端将批注文档和检查结果上传到 OSS。
11. 系统更新提交状态，供用户和审核人员查看。

## DOCX 检查脚本机制

管理员配置的 Python 脚本应遵循统一约定，便于平台调度。

### 输入约定

脚本接收以下输入：

| 参数 | 含义 |
| --- | --- |
| `input_docx` | 原始 DOCX 文件路径 |
| `output_docx` | 带批注或修订痕迹的输出 DOCX 路径 |
| `output_json` | 检查结果 JSON 文件路径 |
| `metadata_json` | 当前提交的基础信息和任务配置 |

### 输出约定

脚本必须输出：

1. 一个 `.docx` 文件：包含自动批注、标记或格式调整结果。
2. 一个 `.json` 文件：包含检查项、是否通过、问题位置、问题说明和建议。

示例 JSON 结构：

```json
{
  "passed": false,
  "issues": [
    {
      "code": "font_size_error",
      "level": "warning",
      "location": "第 2 页第 3 段",
      "message": "正文字号不符合要求",
      "suggestion": "正文建议使用小四号字体"
    }
  ]
}
```

### 安全边界

脚本执行必须采用隔离策略：

1. 禁止脚本直接访问业务数据库。
2. 禁止脚本读取任务目录之外的文件。
3. 限制运行时间、内存和输出文件大小。
4. 通过白名单方式控制可用 Python 依赖。
5. 脚本运行失败时保留错误日志，并将检查状态标记为失败。

## OSS 归档设计

建议使用确定性路径组织 OSS 文件：

```text
materials/{task_id}/{submission_id}/raw/{document_key}.docx
materials/{task_id}/{submission_id}/annotated/{document_key}.docx
materials/{task_id}/{submission_id}/reports/{document_key}.json
```

数据库只保存 OSS object key、文件哈希、文件大小和检查状态，不直接保存大文件。

## 推荐数据表

### 收集任务表：`collection_tasks`

| 字段 | 说明 |
| --- | --- |
| `id` | 任务 ID |
| `title` | 任务标题 |
| `description` | 任务说明 |
| `field_schema` | 基础信息字段配置 |
| `document_schema` | 必传文档清单配置 |
| `script_id` | 绑定的 DOCX 检查脚本 ID |
| `deadline_at` | 截止时间 |
| `status` | 任务状态 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

### 检查脚本表：`docx_check_scripts`

| 字段 | 说明 |
| --- | --- |
| `id` | 脚本 ID |
| `name` | 脚本名称 |
| `version` | 脚本版本 |
| `script_path` | 脚本存储路径 |
| `config_schema` | 脚本配置项 |
| `status` | 是否启用 |
| `created_at` | 创建时间 |

### 提交记录表：`submissions`

| 字段 | 说明 |
| --- | --- |
| `id` | 提交 ID |
| `task_id` | 任务 ID |
| `user_id` | 提交用户 ID |
| `form_data` | 基础信息 JSON |
| `submit_status` | 提交状态 |
| `check_status` | 检查状态 |
| `review_status` | 审核状态 |
| `submitted_at` | 提交时间 |
| `updated_at` | 更新时间 |

### 提交文件表：`submission_files`

| 字段 | 说明 |
| --- | --- |
| `id` | 文件 ID |
| `submission_id` | 提交 ID |
| `document_key` | 文档类型标识 |
| `original_filename` | 原始文件名 |
| `raw_oss_key` | 原始文档 OSS key |
| `annotated_oss_key` | 批注文档 OSS key |
| `report_oss_key` | 检查报告 OSS key |
| `file_hash` | 文件哈希 |
| `check_result` | 检查摘要 JSON |
| `created_at` | 创建时间 |

## 推荐接口

| 接口 | 方法 | 功能 |
| --- | --- | --- |
| `/api/tasks` | `POST` | 创建材料收集任务 |
| `/api/tasks/{task_id}` | `GET` | 获取任务配置 |
| `/api/tasks/{task_id}/submissions` | `POST` | 提交基础信息和文档 |
| `/api/submissions/{submission_id}` | `GET` | 查看提交详情 |
| `/api/submissions/{submission_id}/files/{file_id}` | `GET` | 获取文件下载地址 |
| `/api/scripts` | `POST` | 上传 DOCX 检查脚本 |
| `/api/scripts/{script_id}/validate` | `POST` | 校验脚本输入输出是否符合约定 |

## 部署形态

生产环境建议采用：

- Nginx 提供前端静态资源与 `/api` 反向代理。
- FastAPI 提供业务 API。
- PostgreSQL 保存任务配置、提交记录和文件元数据。
- 阿里云 OSS 保存原始文档、批注文档和检查报告。
- Redis + Celery 或 RQ 执行异步 DOCX 检查任务。
- 脚本运行环境采用容器或受限子进程，避免用户配置脚本影响主服务。
