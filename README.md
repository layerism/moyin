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
- **📄 材料修订与预览**：支持已发布流程的文件材料修订并保留学生历史；DOCX 预览支持 A4/A3 纸张选择和缩放，浏览器排版可能与 Word 不同。
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

当前采用单机本地进程部署，区分开发与正式运行：

| 场景 | 启动命令 | 访问方式 |
|---|---|---|
| 本地开发 | `bash deploy/run_dev.sh` | 前端 `http://localhost:6173`，后端 `127.0.0.1:9000` |
| 正式部署 | `bash deploy/run_server.sh` | Nginx 提供静态页面并代理 `/api`，监听配置以 `deploy/nginx.conf` 为准 |

正式部署将前端直接构建到 Nginx 配置的 `root` 目录，不使用静态目录软链接；后端端口从同一配置的 `proxy_pass` 读取。完整步骤见 [部署说明](./deploy/README.md)。

仓库保留 Docker 相关文件，但其管理员配置、审核脚本及系统依赖尚未与当前安装流程对齐，暂不作为开箱即用的部署入口。

当前数据库为 SQLite，部署方案面向单机；多实例部署需要另行调整数据库和后台任务架构。

---

## 🛠️ 快速开始

### 1. 安装依赖

在使用 APT 的 Linux x86_64 环境中，从项目根目录执行：

```bash
bash deploy/install.sh
```

安装脚本负责：

- 安装系统工具、LibreOffice Writer 和中文字体。
- 在项目 `.local/` 下安装 uv、Python 3.11.15、Node.js 24.18.0 与 npm 11.16.0 等固定版本运行环境。
- 创建或修复 `backend/.venv`，安装 Python 依赖。
- 安装 `frontend/node_modules` 和 `backend/runtime/javascript/node_modules`，包括 DOCX 预览与 JavaScript 审核所需依赖。
- 仅在 `backend/.env` 不存在时，从示例创建配置文件。

迁移服务器或项目路径后，应重新运行安装脚本，不要直接复用复制来的虚拟环境和依赖目录。

### 2. 配置后端

编辑安装脚本生成的 `backend/.env`，已有配置无需重新复制覆盖。配置项说明及 OSS 开通步骤见 [环境变量示例](./backend/.env.example)。

**管理员账号**：填写 `SUPER_ADMINS` JSON 数组，例如 `[{"name":"管理员姓名","account":"00001","password":"初始密码至少8字符"}]`。支持多名管理员，工号为保留前导零的 5 位数字字符串。新账号需要 8 至 128 字符的初始密码；已有账号姓名必须匹配，启动时提升权限但不重置密码。从名单移除不会自动降权。管理员通过 `/teacher/login` 登录。

**文件存储**：配置 `OSS_ENDPOINT`、`OSS_BUCKET`、`OSS_ACCESS_KEY_ID` 和 `OSS_ACCESS_KEY_SECRET`，用于模板和学生材料的上传、下载。

**大模型连接**：先生成 `AUDIT_CONFIG_ENCRYPTION_KEY`，从项目根目录执行：

```bash
backend/.venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

将结果保存到 `.env`。该主密钥用于加密数据库中的模型 API Key，必须备份，不可随意重新生成。

启动后，在“超级管理员账户菜单 → 大模型配置”中维护 API 地址、密钥、模型名称及思考参数，再在节点的“配置审核脚本”弹窗中选择模型卡。连接使用 OpenAI Chat Completions 兼容接口，Base URL 后添加 `/chat/completions`。无需为每个模型另填环境变量；旧模型环境变量仅用于首次导入。

**访问配置**：同源部署无需填写 `CORS_ORIGINS`。明文 HTTP 使用 `SESSION_COOKIE_SECURE=false`，HTTPS 使用 `true`。若启用短信验证，还需配置示例中的 `ALIYUN_PNVS_*` 字段。

`backend/.env` 包含本地密钥和初始密码，不得提交到 Git。

### 3. 本地开发

开发时在项目根目录统一启动后端和 Vite 前端：

```bash
bash deploy/run_dev.sh
```

脚本使用项目内 Node.js，前端固定监听 6173，后端监听 9000，并通过 `VITE_API_PROXY_TARGET` 将 `/api` 请求代理到开发后端。端口被占用时启动失败，不自动切换端口。

通过 Nginx 部署正式环境时，使用 `bash deploy/run_server.sh`；该脚本构建静态前端并只启动后端，完整步骤见 [`deploy/README.md`](./deploy/README.md)。

### 常用环境变量

常用配置见 [`backend/.env.example`](./backend/.env.example)；数据库路径与 worker 数量可按需覆盖默认值。

| 变量 | 用途 |
|---|---|
| `DATABASE_PATH` | SQLite 数据库路径，默认对应 `backend/storage/app.db` |
| `SESSION_COOKIE_SECURE` | HTTPS 使用 `true`，明文 HTTP 使用 `false` |
| `CORS_ORIGINS` | 仅前后端跨域时配置，同源部署无需填写 |
| `OSS_ENDPOINT`、`OSS_BUCKET` | OSS 服务地址和存储桶 |
| `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET` | OSS 访问凭据 |
| `OSS_SIGNED_URL_EXPIRES_SECONDS` | 下载签名地址有效期 |
| `SUPER_ADMINS` | 超级管理员名单（JSON 数组） |
| `AUDIT_CONFIG_ENCRYPTION_KEY` | 数据库中大模型密钥的加密主密钥 |
| `AUDIT_WORKER_COUNT` | 自动审核 worker 数量 |
| `ALIYUN_PNVS_*` | 阿里云号码认证配置，用于短信验证 |

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
| 文档处理 | docx-preview 浏览器预览、LibreOffice 文档转换、中文字体 |
| 部署 | 项目内运行环境、本地进程与 Nginx |

FastAPI 进程内同时运行审核、导出和用户删除清理任务，无需单独启动这些 worker。

### 目录结构

```text
.
├── .local/                    # 安装生成的运行环境和缓存
├── backend/
│   ├── .venv/                 # 安装生成的 Python 虚拟环境
│   ├── app/                    # FastAPI 路由、领域逻辑、仓储和服务
│   ├── scripts/                # 版本化审核脚本
│   ├── runtime/javascript/     # JavaScript 审核运行环境
│   ├── storage/                # SQLite 数据库和后端持久化数据
│   └── tests/                  # 后端测试
├── frontend/src/               # React 页面、功能模块和样式
├── deploy/
│   ├── install.sh              # 运行环境与依赖安装
│   ├── run_dev.sh              # 本地开发启动脚本
│   ├── run_server.sh           # 正式前端构建与后端启动脚本
│   └── nginx.conf              # Nginx 配置
├── docs/                       # 架构、流程和节点设计文档
├── assets/                     # 项目业务模板资产
├── myrsync.sh                  # 可选的 Mutagen 同步脚本
└── docker-compose.yml          # 待与当前部署流程对齐的容器配置
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
