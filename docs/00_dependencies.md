# 项目依赖与运行环境

## 目标

本文档定义腾讯文档收集表简化版的组件依赖、数据库依赖、对象存储依赖与运行环境。系统核心功能包括用户登录、收集表创建、题目配置、基础信息填写、多个 `.docx` 文档上传、阿里云 OSS 归档，以及基于多个 Python 脚本的 AI DOCX 格式检测、自动评语填写和批注生成。

## 总体技术栈

| 层级 | 推荐组件 | 作用 |
| --- | --- | --- |
| 前端框架 | React + TypeScript | 构建收集表编辑、填写、统计、审核与管理界面 |
| 构建工具 | Vite | 前端开发服务器与生产构建 |
| UI 组件 | Ant Design 或 shadcn/ui | 表单、上传、表格、弹窗、状态提示 |
| 表单校验 | react-hook-form + zod | 动态字段渲染、必填校验、格式校验 |
| 后端框架 | FastAPI | 提供收集表、提交、文件、AI 脚本与认证接口 |
| ORM | SQLAlchemy 2.x | 数据模型与数据库访问 |
| 数据库迁移 | Alembic | 管理数据库结构变更 |
| 数据库 | PostgreSQL 15+ | 保存用户、收集表、提交记录、文件元数据 |
| 队列托管 | PostgreSQL 任务表 | 使用 `ai_docx_runs` 保存异步任务状态 |
| 异步任务 | Python Worker | 轮询并领取 PostgreSQL 中的 AI DOCX 待处理任务 |
| 对象存储 | 阿里云 OSS | 存储原始 DOCX、批注文档、检查报告 |
| Web 入口 | 可选 Nginx、云平台入口代理或 FastAPI 直连 | 静态资源托管与 API 访问入口 |
| 部署 | systemd 用户服务或普通进程 | 适配无 Docker 的云虚拟机部署 |

## 前端依赖

前端应重点支持收集表编辑、动态表单渲染、文件上传、统计面板、AI 检查状态展示与审核列表。

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
2. 收集表编辑页。
3. 提交结果页。
4. 收集表填写页。
5. 统计页。
6. 审核列表与详情页。

## 后端依赖

后端负责认证、收集表配置、提交校验、文件元数据管理、OSS 归档和异步 AI DOCX 检查任务调度。

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
| `oss2` | 阿里云 OSS SDK |
| `python-docx` | DOCX 读取、修改与基础批注能力 |
| `lxml` | 处理 DOCX 内部 XML 结构 |
| `openai` 或兼容 SDK | 脚本调用 AI 模型，按实际模型供应商选择 |

## AI DOCX 脚本环境

AI DOCX 格式检测、内容评估、自动评语填写与批注生成由管理员上传的多个 Python 脚本实现。平台应提供受限、稳定、可复现的脚本运行环境。

| 组件 | 要求 |
| --- | --- |
| Python | 3.11+ |
| 运行方式 | 受限子进程 |
| 输入目录 | 仅包含本次待检查文档与元数据 |
| 输出目录 | 仅允许生成批注文档与 JSON 检查报告 |
| 超时限制 | 建议 60-180 秒 |
| 内存限制 | 建议 512 MB-2 GB |
| 网络访问 | 默认禁止；如脚本需要调用 AI API，应通过白名单放行指定 endpoint |
| 数据库访问 | 禁止 |

建议预装依赖：

| 依赖 | 用途 |
| --- | --- |
| `python-docx` | DOCX 文档结构读取与修改 |
| `lxml` | 低层 XML 操作 |
| `pydantic` | 脚本输入输出结构校验 |
| `openai` 或兼容 SDK | 调用 AI 模型生成检测结论和评语 |

脚本执行的最小命令约定：

```bash
python ai_docx_script.py \
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
| `forms` | 收集表 |
| `form_fields` | 收集表题目 |
| `ai_docx_scripts` | AI DOCX 脚本配置 |
| `field_script_bindings` | 文件题与脚本绑定关系 |
| `submissions` | 用户提交记录 |
| `submission_files` | 提交文件元数据与 OSS 路径 |
| `ai_docx_runs` | AI DOCX 脚本运行记录 |
| `password_reset_tokens` | 密码重置凭证 |
| `login_logs` | 登录审计日志 |

数据库扩展建议：

| 扩展 | 用途 |
| --- | --- |
| `pgcrypto` | 生成 UUID 或哈希辅助 |
| `uuid-ossp` | UUID 主键生成，按需启用 |

## 队列托管方式

第一版不引入额外队列中间件。AI DOCX 异步任务直接由 PostgreSQL 托管，使用 `ai_docx_runs` 作为任务表。

基本机制：

1. 用户提交 DOCX 后，后端为每个待执行脚本写入一条 `ai_docx_runs` 记录，状态为 `pending`。
2. Worker 定时查询 `pending` 任务，并使用数据库行锁领取任务。
3. Worker 将任务状态更新为 `running`，记录 `started_at`。
4. 脚本执行完成后，Worker 写入输出文件 OSS key、检查摘要、日志路径和 `finished_at`。
5. 成功任务标记为 `success`，失败任务标记为 `failed`。

领取任务时建议使用 PostgreSQL 的 `FOR UPDATE SKIP LOCKED`，避免多个 Worker 重复处理同一任务。

示例 SQL：

```sql
SELECT id
FROM ai_docx_runs
WHERE status = 'pending'
ORDER BY id
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

该方式适合当前低并发场景，部署组件更少，运维成本更低。若后续出现大量并发提交、复杂重试策略或跨节点调度需求，再考虑引入专用队列服务。

## 对象存储依赖

使用阿里云 OSS 存储上传文档、批注文档和检查报告。

必需配置：

| 配置项 | 说明 |
| --- | --- |
| `OSS_ENDPOINT` | OSS 访问 endpoint |
| `OSS_BUCKET` | 存储 bucket |
| `OSS_ACCESS_KEY_ID` | 访问密钥 ID |
| `OSS_ACCESS_KEY_SECRET` | 访问密钥 Secret |
| `OSS_BASE_PREFIX` | 项目文件根路径，例如 `forms/` |

推荐路径：

```text
forms/{form_id}/submissions/{submission_id}/raw/{field_key}/{filename}.docx
forms/{form_id}/submissions/{submission_id}/ai/{field_key}/{run_id}/annotated.docx
forms/{form_id}/submissions/{submission_id}/ai/{field_key}/{run_id}/report.json
scripts/{script_id}/{version}/package.zip
```

## 无 Docker 部署环境

目标环境是一台普通云虚拟机，不依赖 Docker。推荐将后端、Worker 和前端构建产物部署在用户目录下，数据库使用云虚拟机本机 PostgreSQL 或云厂商托管 PostgreSQL。

| 服务 | 默认端口 | 说明 |
| --- | ---: | --- |
| Frontend | `5173` | 开发阶段 Vite 服务；生产阶段构建为静态文件 |
| Backend | `8000` | FastAPI API 服务 |
| PostgreSQL | `5432` | 业务数据库 |

文件存储直接使用阿里云 OSS，不在云虚拟机上部署 MinIO。

## 生产环境依赖

生产环境建议最小部署为：

1. 一台 Web/API 服务节点：运行前端静态文件、FastAPI 和 Worker；如已有 Web 服务，可不单独安装 Nginx。
2. 一个 PostgreSQL 实例：保存业务元数据。
3. 一个 Worker 服务：轮询 PostgreSQL 任务表，运行 AI DOCX 检测、自动评语填写与批注生成任务。
4. 一个阿里云 OSS Bucket：保存所有文档文件。

对于 AI DOCX 脚本，生产环境应单独运行 Worker，避免用户上传脚本影响主 API 服务。

## 低权限安装策略

尽量避免通过 `sudo apt install` 安装项目运行依赖。推荐策略如下：

| 依赖 | 推荐方式 |
| --- | --- |
| Python | 使用系统已有 Python，或在用户目录安装 `pyenv` |
| Python 包 | 安装到项目 `.venv` |
| Node.js | 使用 `nvm` 安装到用户目录 |
| 前端依赖 | 安装到项目 `node_modules` |
| PostgreSQL | 优先使用云厂商托管 PostgreSQL；如必须本机安装，则需要一次性系统安装 |
| 文件存储 | 直接使用阿里云 OSS |
| 进程管理 | 使用 `systemd --user`、`nohup`、`tmux` 或 `supervisord` 用户态部署 |

如果云虚拟机没有 PostgreSQL 且无法使用 `sudo` 安装数据库，建议直接使用云数据库 PostgreSQL。这样应用服务器只需要运行 Python、Node.js 和 Worker，不需要维护本机数据库服务。

## 环境变量

| 变量名 | 说明 |
| --- | --- |
| `APP_ENV` | 运行环境，如 `development`、`production` |
| `DATABASE_URL` | PostgreSQL 连接串 |
| `JWT_SECRET_KEY` | JWT 签名密钥 |
| `OSS_ENDPOINT` | 阿里云 OSS endpoint |
| `OSS_BUCKET` | OSS bucket |
| `OSS_ACCESS_KEY_ID` | OSS AccessKey ID |
| `OSS_ACCESS_KEY_SECRET` | OSS AccessKey Secret |
| `AI_API_BASE_URL` | AI 模型服务地址，按需配置 |
| `AI_API_KEY` | AI 模型服务密钥，按需配置 |
| `DOCX_WORKER_TIMEOUT_SECONDS` | AI DOCX 脚本超时时间 |
| `DOCX_WORKER_MAX_MEMORY_MB` | AI DOCX 脚本内存上限 |

## 最小可运行依赖

若优先实现第一版闭环，最小依赖为：

1. React + TypeScript + Vite。
2. FastAPI + SQLAlchemy + Alembic。
3. PostgreSQL。
4. Python Worker + PostgreSQL 任务表。
5. 阿里云 OSS SDK `oss2`。
6. Python 3.11 + `python-docx` + `lxml`。
7. 可选反向代理；若云平台已有入口代理，可不安装 Nginx。

该组合可以覆盖用户登录、收集表配置、必填校验、多 DOCX 上传、OSS 归档、异步 AI 格式检测、自动评语填写与批注生成。
