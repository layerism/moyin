# 项目依赖与运行环境

## 目标

本文档定义材料收集应用的组件依赖、数据库依赖、对象存储依赖与运行环境。系统核心功能包括用户登录、材料收集任务配置、基础信息填写、多个 `.docx` 文档上传、阿里云 OSS 归档，以及基于 Python 脚本的 DOCX 格式检查与自动批注。

## 总体技术栈

| 层级 | 推荐组件 | 作用 |
| --- | --- | --- |
| 前端框架 | React + TypeScript | 构建材料填写、上传、审核与管理界面 |
| 构建工具 | Vite | 前端开发服务器与生产构建 |
| UI 组件 | Ant Design 或 shadcn/ui | 表单、上传、表格、弹窗、状态提示 |
| 表单校验 | react-hook-form + zod | 动态字段渲染、必填校验、格式校验 |
| 后端框架 | FastAPI | 提供任务、提交、文件、脚本与认证接口 |
| ORM | SQLAlchemy 2.x | 数据模型与数据库访问 |
| 数据库迁移 | Alembic | 管理数据库结构变更 |
| 数据库 | PostgreSQL 15+ | 保存用户、任务、提交记录、文件元数据 |
| 缓存与队列 | Redis 7+ | 异步任务队列、临时状态、限流计数 |
| 异步任务 | Celery 或 RQ | 执行 DOCX 检查、批注生成、OSS 上传后处理 |
| 对象存储 | 阿里云 OSS | 存储原始 DOCX、批注文档、检查报告 |
| 反向代理 | Nginx | HTTPS 终止、静态资源托管、API 反向代理 |
| 部署 | Docker Compose | 本地与中小规模部署编排 |

## 前端依赖

前端应重点支持动态表单、文件上传、任务状态展示与审核列表。

| 依赖 | 用途 |
| --- | --- |
| `react` | UI 渲染 |
| `typescript` | 类型约束 |
| `vite` | 开发与构建 |
| `react-router-dom` | 页面路由 |
| `react-hook-form` | 表单状态管理 |
| `zod` | 表单 schema 与校验规则 |
| `@hookform/resolvers` | 连接 `react-hook-form` 与 `zod` |
| `axios` 或 `ky` | HTTP 请求 |
| `antd` 或 shadcn/ui 相关组件 | 表单、上传、表格、弹窗 |

最小页面依赖：

1. 登录页。
2. 材料收集任务填写页。
3. 提交结果页。
4. 管理员任务配置页。
5. 审核列表与详情页。

## 后端依赖

后端负责认证、任务配置、提交校验、文件元数据管理、OSS 归档和异步 DOCX 检查任务调度。

| 依赖 | 用途 |
| --- | --- |
| `fastapi` | Web API 框架 |
| `uvicorn` | ASGI 服务 |
| `pydantic` | 请求、响应和配置模型 |
| `sqlalchemy` | ORM |
| `alembic` | 数据库迁移 |
| `psycopg` 或 `asyncpg` | PostgreSQL 驱动 |
| `python-multipart` | 文件上传 |
| `passlib[bcrypt]` 或 `argon2-cffi` | 密码哈希 |
| `python-jose` 或 `pyjwt` | JWT 令牌 |
| `redis` | Redis 客户端 |
| `celery` 或 `rq` | 异步任务 |
| `oss2` | 阿里云 OSS SDK |
| `python-docx` | DOCX 读取、修改与基础批注能力 |
| `lxml` | 处理 DOCX 内部 XML 结构 |

## DOCX 检查脚本环境

DOCX 检查与自动批注由管理员配置 Python 脚本实现。平台应提供受限、稳定、可复现的脚本运行环境。

| 组件 | 要求 |
| --- | --- |
| Python | 3.11+ |
| 运行方式 | 容器或受限子进程 |
| 输入目录 | 仅包含本次待检查文档与元数据 |
| 输出目录 | 仅允许生成批注文档与 JSON 检查报告 |
| 超时限制 | 建议 60-180 秒 |
| 内存限制 | 建议 512 MB-2 GB |
| 网络访问 | 默认禁止 |
| 数据库访问 | 禁止 |

建议预装依赖：

| 依赖 | 用途 |
| --- | --- |
| `python-docx` | DOCX 文档结构读取与修改 |
| `lxml` | 低层 XML 操作 |
| `pydantic` | 脚本输入输出结构校验 |

脚本执行的最小命令约定：

```bash
python check_docx.py \
  --input-docx input.docx \
  --output-docx output.docx \
  --output-json result.json \
  --metadata-json metadata.json
```

## 数据库依赖

推荐使用 PostgreSQL 15+。数据库保存业务元数据，不保存大文件本体。

核心表包括：

| 表名 | 用途 |
| --- | --- |
| `users` | 用户、管理员、审核人员账号 |
| `student_accounts` | 学生账号与登录信息 |
| `collection_tasks` | 材料收集任务 |
| `docx_check_scripts` | DOCX 检查脚本配置 |
| `submissions` | 用户提交记录 |
| `submission_files` | 提交文件元数据与 OSS 路径 |
| `password_reset_tokens` | 密码重置凭证 |
| `login_logs` | 登录审计日志 |

数据库扩展建议：

| 扩展 | 用途 |
| --- | --- |
| `pgcrypto` | 生成 UUID 或哈希辅助 |
| `uuid-ossp` | UUID 主键生成，按需启用 |

## 对象存储依赖

使用阿里云 OSS 存储上传文档、批注文档和检查报告。

必需配置：

| 配置项 | 说明 |
| --- | --- |
| `OSS_ENDPOINT` | OSS 访问 endpoint |
| `OSS_BUCKET` | 存储 bucket |
| `OSS_ACCESS_KEY_ID` | 访问密钥 ID |
| `OSS_ACCESS_KEY_SECRET` | 访问密钥 Secret |
| `OSS_BASE_PREFIX` | 项目文件根路径，例如 `materials/` |

推荐路径：

```text
materials/{task_id}/{submission_id}/raw/{document_key}.docx
materials/{task_id}/{submission_id}/annotated/{document_key}.docx
materials/{task_id}/{submission_id}/reports/{document_key}.json
```

## 本地开发环境

本地开发建议使用 Docker Compose 启动基础设施。

| 服务 | 默认端口 | 说明 |
| --- | ---: | --- |
| Frontend | `5173` | Vite 开发服务 |
| Backend | `8000` | FastAPI API 服务 |
| PostgreSQL | `5432` | 业务数据库 |
| Redis | `6379` | 队列与缓存 |
| MinIO | `9000` / `9001` | 本地 OSS 替代服务 |

本地开发可用 MinIO 模拟 OSS；生产环境切换为阿里云 OSS。

## 生产环境依赖

生产环境建议最小部署为：

1. 一台 Web/API 服务节点：运行 Nginx、前端静态文件、FastAPI。
2. 一个 PostgreSQL 实例：保存业务元数据。
3. 一个 Redis 实例：支持异步任务和限流。
4. 一个 Worker 服务：运行 DOCX 检查与自动批注任务。
5. 一个阿里云 OSS Bucket：保存所有文档文件。

对于 DOCX 检查脚本，生产环境应单独运行 Worker，避免用户配置脚本影响主 API 服务。

## 环境变量

| 变量名 | 说明 |
| --- | --- |
| `APP_ENV` | 运行环境，如 `development`、`production` |
| `DATABASE_URL` | PostgreSQL 连接串 |
| `REDIS_URL` | Redis 连接串 |
| `JWT_SECRET_KEY` | JWT 签名密钥 |
| `OSS_ENDPOINT` | 阿里云 OSS endpoint |
| `OSS_BUCKET` | OSS bucket |
| `OSS_ACCESS_KEY_ID` | OSS AccessKey ID |
| `OSS_ACCESS_KEY_SECRET` | OSS AccessKey Secret |
| `DOCX_WORKER_TIMEOUT_SECONDS` | DOCX 检查脚本超时时间 |
| `DOCX_WORKER_MAX_MEMORY_MB` | DOCX 检查脚本内存上限 |

## 最小可运行依赖

若优先实现第一版闭环，最小依赖为：

1. React + TypeScript + Vite。
2. FastAPI + SQLAlchemy + Alembic。
3. PostgreSQL。
4. Redis + Celery 或 RQ。
5. 阿里云 OSS SDK `oss2`。
6. Python 3.11 + `python-docx` + `lxml`。
7. Nginx。

该组合可以覆盖用户登录、材料任务配置、必填校验、多 DOCX 上传、OSS 归档、异步格式检查与自动批注。
