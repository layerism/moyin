<a name="readme-top"></a>

<div align="center">

# 墨印（Moyin）— 开源教务流程自动化平台

**用形式主义，打败官僚主义。**

用可视化流程统一组织材料采集、审核反馈与教学进度

![React](https://img.shields.io/badge/React-18-149ECA?logo=react&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-Python%203.11-009688?logo=fastapi&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-单机存储-003B57?logo=sqlite&logoColor=white)
![OSS](https://img.shields.io/badge/OSS-对象存储-FF6A00?logo=alibabacloud&logoColor=white)

</div>

墨印是面向教师与学生的教务流程应用平台，将原本分散在表格、群聊和网盘中的流程设计、名单授权、分阶段提交、材料审核与进度管理集中到同一套可自托管的 Web 系统中。

教师通过可视化 DAG 编排教务任务并发布稳定版本；学生按照节点依赖逐步填写信息或上传材料；系统结合确定性规则、AI 与人工审核推进流程，同时保留每名学生的提交、状态和审核记录。

---

## 🎬 操作演示

[▶️ 观看演示：教师创建流程、添加节点并预览学生侧操作](./assets/moyin-webapp-demo.mp4)

演示视频为静音版本，展示从教师创建流程、拖入表单节点，到学生侧打开节点、提交并完成流程的基本操作。

---

## ⭐ 功能特性

- **🧭 可视化流程编排**：拖拽节点、连接依赖并配置字段、模板、时间与审核规则，将教务要求转化为可执行流程。
- **📦 多类型材料采集**：在同一流程中组合表单、答题卡、文件上传、视觉审核与通知公告节点。
- **🤖 多层审核机制**：支持直接通过、AI 通过/不通过、AI 评分、答题卡自动判分和教师人工审核。
- **🔐 名单驱动授权**：教师维护流程名单；学生只有在当前授权有效时才能进入对应流程。
- **🧑‍🎓 独立学生实例**：每名学生拥有隔离的节点状态、草稿、提交内容和审核历史，互不影响。
- **🕰️ 版本化发布**：发布时生成不可变流程快照；后续修订会分析受影响节点和学生范围，避免历史运行状态被静默覆盖。
- **📊 教师进度管理**：集中查看学生节点状态、提交材料和审核结果，并支持人工审核、个别延期与 Excel 导出。
- **☁️ OSS 文件管理**：流程模板和学生材料保存至对象存储，文件下载使用经过权限校验的短期签名地址。
- **👁️ 真实学生预览**：教师预览与正式学生端复用同一套运行页面和业务配置解释，降低发布前后的体验偏差。
- **🛡️ 角色权限隔离**：教师、学生和超级管理员使用独立入口，关键权限由后端执行最终校验。

### 流程节点

| 节点 | 面向学生的用途 | 教师可配置内容 |
|---|---|---|
| 表单填写 | 填写文本、单选、多选等结构化信息 | 字段、选项、必填规则、开放时间与截止时间 |
| 答题卡 | 完成 Markdown 题目、选择题和填空题 | 私有答案、分值、通过线、尝试次数与反馈策略 |
| 文件上传 | 提交指定格式和大小的材料 | 文件限制、模板和版本化审核脚本 |
| 视觉审核 | 上传 JPG、JPEG 或 PNG 扫描件并接受 AI 审核 | 模板、审核模式、提示词与评分阈值 |
| 通知公告 | 阅读流程说明、提醒或公告 | 标题、正文与开放时间 |

---

## 🔄 工作方式

```text
教师创建流程
    ↓
添加节点并连接为 DAG
    ↓
配置字段、时间、模板和审核规则
    ↓
导入学生名单并进行学生视角预览
    ↓
发布不可变流程版本
    ↓
学生按节点依赖填写信息或上传材料
    ↓
确定性规则 / AI / 教师完成审核
    ↓
审核通过后开放下游节点，教师持续跟踪与导出结果
```

审核任务由 FastAPI 应用内的异步 worker 执行，并持久化到 SQLite。版本化审核脚本会固定脚本 ID、版本、代码哈希、配置哈希和参数快照，避免程序更新后改变历史流程的审核依据。

业务审核不通过与审核服务异常使用不同状态：前者向学生提供可操作的修改理由；后者允许学生重新触发审核，无需重复上传材料。

---

## 🚀 部署方式

墨印支持两种运行方式：

### 本地进程

适合开发、调试和单机使用。前端与后端分别运行，默认监听：

- Web 前端：<http://localhost:6173>
- FastAPI：<http://localhost:9000>
- 健康检查：<http://localhost:9000/api/health>

### Docker Compose

适合需要统一入口的部署环境。Docker Compose 通过 Nginx 暴露 `http://localhost`，并将宿主机 `backend/storage` 挂载到后端容器的 `/app/storage`。

```bash
docker compose up --build
```

当前数据库为 SQLite，适合单机部署。多实例或高并发生产环境应迁移至 PostgreSQL，并统一会话、缓存和任务基础设施。

---

## 🛠️ 快速开始

### 1. 安装依赖

项目使用仓库内固定版本的 Node.js、Python 和 uv 环境。首次部署请按照 [INSTALL.md](./INSTALL.md) 完成运行时与依赖安装。

### 2. 配置后端

```bash
cp backend/.env.example backend/.env
```

首次启动前填写 `SUPER_ADMINS` JSON 数组，例如 `[{"name":"管理员姓名","account":"00001","password":"初始密码至少8字符"}]`，支持多名管理员。工号为 5 位数字字符串，保留前导零。已有账号姓名必须匹配，启动时提升权限但不重置密码；新账号需要 8 至 128 字符的初始密码。从名单移除不会自动降权。使用 `/teacher/login` 登录。

大模型连接在“超级管理员账户菜单 → 大模型配置”中维护，仅超级管理员可修改。API Key 加密保存在数据库，`AUDIT_CONFIG_ENCRYPTION_KEY` 留在服务器 `.env`，可在 backend 目录运行 `./.venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` 生成。主密钥必须备份并与数据库分开保管，不可随意重新生成。旧大模型环境变量仅用于首次导入；迁移后删除，后续以管理端配置为准。保存对新启动的审核脚本生效，已运行的请求继续使用原连接。文档和视觉审核在各自的“配置审核脚本”弹窗中选择模型卡，并随参数统一保存；模型管理页只管理模型卡。模型名称、思考模式及厂商支持的档位/预算统一由模型卡维护，请求超时等参数仍在脚本配置中维护。未知型号或自定义接口不发送思考参数。适配范围及官方依据见 `docs/superpowers/plans/2026-09-08-script-editor-thinking.md`。仅支持 OpenAI Chat Completions：Base URL 后统一添加 `/chat/completions`，不支持 Responses 或 Messages 接口。模型卡支持新增、编辑、删除；被脚本引用时必须先更换引用才能删除。厂商 Logo 为本地静态资源，来源和许可见 `frontend/public/model-providers/README.md`。

初始化只执行一次：同账号同姓名的已有账户保留 ID，更新初始密码并启用管理员权限、注销旧会话；姓名不一致或配置无效时启动失败。成功后可删除初始密码配置，重启不会覆盖密码或账户状态。密码仅以哈希写入数据库；请勿将真实初始密码写进版本库。

至少按实际环境填写 OSS 配置：

```dotenv
OSS_ENDPOINT=
OSS_BUCKET=
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
```

如需启用视觉审核或 DeepSeek 审核脚本，再配置相应的 API 地址、密钥和模型名称。`backend/.env` 包含本地密钥，不得提交到 Git。

### 3. 本地开发

开发时在项目根目录统一启动后端和 Vite 前端：

```bash
bash deploy/run_dev.sh
```

脚本使用项目内 Node.js，前端固定监听 6173，后端监听 9000，并通过 `VITE_API_PROXY_TARGET` 将 `/api` 请求代理到开发后端。端口被占用时启动失败，不自动切换端口。

通过 Nginx 部署正式、灰度或测试环境时，使用 `bash deploy/run_server.sh <prod|gray|test>`；该脚本构建静态前端并只启动后端，完整步骤见 [`deploy/README.md`](./deploy/README.md)。

### 常用环境变量

完整示例见 [`backend/.env.example`](./backend/.env.example)。

| 变量 | 用途 |
|---|---|
| `DATABASE_PATH` | SQLite 数据库路径 |
| `OSS_ENDPOINT`、`OSS_BUCKET` | OSS 服务地址和存储桶 |
| `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET` | OSS 访问凭据 |
| `OSS_SIGNED_URL_EXPIRES_SECONDS` | 下载签名地址有效期 |
| `SUPER_ADMINS` | 超级管理员名单（JSON 数组） |
| `AUDIT_CONFIG_ENCRYPTION_KEY` | 数据库中大模型密钥的加密主密钥 |
| `AUDIT_WORKER_COUNT` | 自动审核 worker 数量 |

---

## 🧱 技术架构

```text
┌───────────────────────────────────────────────────────────┐
│                     React + Vite                          │
│  教师设计器 · 学生运行页 · 进度管理 · OSS 材料库          │
└───────────────────────────┬───────────────────────────────┘
                            │ /api
┌───────────────────────────▼───────────────────────────────┐
│                    FastAPI Backend                       │
│  认证授权 · 流程版本 · 学生实例 · 提交事务 · 审核 worker   │
└───────────────┬───────────────────────┬───────────────────┘
                │                       │
        ┌───────▼────────┐      ┌───────▼────────┐
        │ SQLite         │      │ 阿里云 OSS     │
        │ 业务与审核状态 │      │ 模板与学生材料 │
        └────────────────┘      └────────────────┘
```

| 层级 | 技术 |
|---|---|
| 前端 | React 18、TypeScript、Vite 5、React Markdown、KaTeX |
| 后端 | FastAPI、Python 3.11、Uvicorn |
| 数据库 | SQLite，默认位于 `backend/storage/app.db` |
| 文件存储 | 阿里云 OSS，数据库保存对象键和文件元数据 |
| 自动审核 | Python / JavaScript 版本化审核脚本与异步任务 worker |
| 部署 | 本地进程或 Docker Compose + Nginx |

### 目录结构

```text
.
├── backend/
│   ├── app/                    # FastAPI 路由、领域逻辑、仓储和服务
│   ├── scripts/                # 版本化审核脚本
│   ├── runtime/javascript/     # JavaScript 审核运行环境
│   ├── storage/                # SQLite 数据库和后端持久化数据
│   └── tests/                  # 后端测试
├── frontend/src/               # React 页面、功能模块和样式
├── deploy/
│   ├── run_server.sh           # prod/gray/test 构建与后端启动脚本
│   └── nginx.conf              # Nginx 配置
├── docs/                       # 架构、流程和节点设计文档
├── assets/                     # 项目业务模板资产
├── docker-compose.yml          # 容器部署编排
└── INSTALL.md                  # Linux 固定版本安装说明
```

---

## 📚 开发文档

- [依赖与技术选型](./docs/00_dependencies.md)
- [系统架构](./docs/01_architecture.md)
- [登录与认证](./docs/02_login.md)
- [设计图](./docs/03_design_diagram.md)
- [OA 流程运行时设计](./docs/04_oa_workflow_runtime_design.md)
- [流程图与 DAG 规则](./docs/05_oa_graph.md)
- [审核脚本约定](./docs/06_check_scripts.md)
- [答题卡节点设计](./docs/07_answer_sheet_node_design.md)

> [!NOTE]
> 设计文档可能早于当前实现。判断功能状态时，应优先查看当前源码、数据库迁移和最近提交。

## 🔒 安全与运行边界

- 教师、学生和超级管理员权限由后端校验，不能仅依赖前端隐藏入口。
- 学生访问以当前有效名单授权为准；历史流程实例不能替代访问授权。
- 上传文件在提交时重新校验学生、节点和流程版本归属。
- 文件下载经过后端权限检查，并使用短期 OSS 签名地址。
- 发布版本保存不可变配置快照；审核程序和参数通过版本与哈希固定。
- 密钥只通过运行环境注入，不得写入镜像、README 或版本库。

<p align="right"><a href="#readme-top">返回顶部</a></p>
