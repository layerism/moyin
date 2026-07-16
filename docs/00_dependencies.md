# 项目依赖与运行环境

## 范围

本文档只记录项目运行所需的软件组件、第三方服务、环境变量和部署约束。业务需求、数据库表结构、任务流程和文件归档规则不在本文档中描述。

## 基础运行环境

| 组件 | 建议版本 | 说明 |
| --- | --- | --- |
| Linux | Ubuntu 22.04+ 或同等级发行版 | 云虚拟机运行环境 |
| Python | 3.11+ | 后端服务、Worker 与脚本运行环境 |
| Node.js | 20 LTS+ | 前端开发与构建 |
| PostgreSQL | 15+ | 关系型数据库 |
| 阿里云 OSS | 当前可用版本 | 对象存储服务 |
| Git | 2.34+ | 代码拉取与版本管理 |

## 前端依赖

| 依赖 | 用途 |
| --- | --- |
| `react` | UI 框架 |
| `typescript` | 类型系统 |
| `vite` | 前端开发服务与构建工具 |
| `react-router-dom` | 前端路由 |
| `react-hook-form` | 表单状态管理 |
| `zod` | 数据校验 |
| `@hookform/resolvers` | 表单校验适配 |
| `axios` 或 `ky` | HTTP 客户端 |
| `antd` 或 shadcn/ui | UI 组件库 |

## 后端依赖

| 依赖 | 用途 |
| --- | --- |
| `fastapi` | Web API 框架 |
| `uvicorn` | ASGI 运行服务 |
| `pydantic` | 配置、请求和响应模型 |
| `sqlalchemy` | ORM |
| `alembic` | 数据库迁移 |
| `psycopg` 或 `asyncpg` | PostgreSQL 驱动 |
| `python-multipart` | 文件上传解析 |
| `passlib[bcrypt]` 或 `argon2-cffi` | 密码哈希 |
| `python-jose` 或 `pyjwt` | 令牌签发与校验 |
| `oss2` | 阿里云 OSS SDK |
| `python-docx` | DOCX 读写 |
| `lxml` | XML 处理 |
| `openai` 或兼容 SDK | AI 服务调用，按实际供应商选择 |

## 数据库与外部服务

| 服务 | 是否必需 | 部署建议 |
| --- | --- | --- |
| PostgreSQL | 必需 | 可使用本机安装或云数据库 |
| 阿里云 OSS | 必需 | 使用云端 Bucket，不在服务器本地模拟 |
| Nginx | 可选 | 仅在需要反向代理或静态资源托管时安装 |
| Redis | 不使用 | 当前方案不依赖 Redis |
| Docker | 不使用 | 当前部署约束为无 Docker 环境 |

## 低权限安装策略

尽量避免通过 `sudo apt install` 安装项目运行依赖。

| 依赖 | 推荐方式 |
| --- | --- |
| Python 包 | 安装到项目 `.venv` |
| Node.js | 使用 `nvm` 安装到用户目录 |
| 前端依赖 | 安装到项目 `node_modules` |
| PostgreSQL | 优先使用云数据库；如本机安装，可能需要一次性系统权限 |
| 进程管理 | 使用 `systemd --user`、`nohup`、`tmux` 或用户态 `supervisord` |

## 环境变量

| 变量名 | 说明 |
| --- | --- |
| `APP_ENV` | 运行环境，例如 `development`、`production` |
| `DATABASE_URL` | PostgreSQL 连接串 |
| `JWT_SECRET_KEY` | JWT 签名密钥 |
| `OSS_ENDPOINT` | 阿里云 OSS endpoint |
| `OSS_BUCKET` | OSS bucket |
| `OSS_PREFIX` | OSS 对象根前缀，默认 `coze/files` |
| `OSS_ACCESS_KEY_ID` | OSS AccessKey ID |
| `OSS_ACCESS_KEY_SECRET` | OSS AccessKey Secret |
| `OSS_SIGNED_URL_EXPIRES_SECONDS` | 下载签名 URL 有效期，默认 600 秒 |
| `AI_API_BASE_URL` | AI 服务地址，按需配置 |
| `AI_API_KEY` | AI 服务密钥，按需配置 |
| `DOCX_WORKER_TIMEOUT_SECONDS` | DOCX 脚本运行超时时间 |
| `DOCX_WORKER_MAX_MEMORY_MB` | DOCX 脚本内存上限 |

## 最小部署组件

| 组件 | 运行方式 |
| --- | --- |
| 前端 | Node.js 构建后生成静态文件 |
| 后端 API | Python `.venv` + `uvicorn` |
| Worker | Python `.venv` 中独立运行 |
| 数据库 | PostgreSQL |
| 对象存储 | 阿里云 OSS |

该部署形态不依赖 Docker、Redis 或本地对象存储服务。
