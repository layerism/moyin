# 文档自动填写 Web 项目

本仓库是一个可部署到 Linux 的 Web 项目骨架，用于支持教师上传 Word 模板、系统提取待填写字段、学生登录后填写表单，并生成可下载的 Word 文档。当前阶段仅完成初始化结构，不实现具体业务逻辑。

## 技术栈

- 前端：React + Vite + TypeScript
- 后端：FastAPI + Python
- 部署：Docker Compose + Nginx
- 文档处理预留：Word 模板解析、字段抽取、文档生成
- AI 能力预留：字段解释、填写建议、内容润色、模板结构识别

## 目录结构

```text
.
├── backend/              # FastAPI 服务
├── frontend/             # React 前端
├── deploy/               # Nginx 等部署配置
├── docs/                 # 架构与需求文档
├── storage/              # 上传和生成文件的本地存储目录
└── docker-compose.yml    # Linux 部署编排
```

## 本地开发

后端：

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

前端：

```bash
cd frontend
npm install
npm run dev
```

## Linux 部署

```bash
docker compose up --build
```

默认服务：

- 前端入口：`http://localhost`
- 后端健康检查：`http://localhost/api/health`

## 当前边界

本次初始化只建立工程结构、模块边界、部署入口和占位接口。登录、权限、Word 解析、AI 调用、数据库模型和文档生成将在后续迭代中实现。
