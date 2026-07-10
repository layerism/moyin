# 文档自动填写 Web 项目

本仓库是一个可部署到 Linux 的文档采集与 OA 流程系统。当前版本已经提供 OA DAG 设计、版本化发布、高熵分享链接、学生注册登录、独立填写进度、节点提交、截止时间和教师进度追踪。

## 技术栈

- 前端：React + Vite + TypeScript
- 后端：FastAPI + Python
- 数据库：SQLite（第一版，可迁移至 PostgreSQL）
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

本地入口：

- 前端：`http://localhost:5173`
- 教师/学生登录：`http://localhost:5173/auth/login`
- 教师/学生注册：`http://localhost:5173/auth/register`
- 忘记密码占位：`http://localhost:5173/auth/forgot-password`
- 学生流程中心：`http://localhost:5173/student`
- 后端：`http://localhost:8000`
- 后端健康检查：`http://localhost:8000/api/health`
- 本地数据库：`backend/storage/app.db`

## OA 流程第一版

1. 进入“教务流程”，创建并命名流程。
2. 从组件库添加节点，在画布中连接为 DAG，并配置字段、审核方式和截止时间。
3. 保存草稿或发布；发布后节点结构冻结，并生成 `/s/{token}` 高熵分享链接。
4. 学生打开链接后必须注册或登录，系统按“流程版本 + 学生账号”幂等创建个人流程实例。
5. 学生可暂存和提交节点；自动通过的节点会推进下游节点开放。
6. 教师在已发布流程中查看每名学生的完成状态，并调整统一截止时间或设置个别延期。

## 账户与权限

- 教师使用姓名、工号和密码注册登录；登录后进入流程设计和管理端。
- 学生使用姓名、学号和密码注册登录；登录后进入个人流程中心。
- 学生从高熵分享链接登录时，认证完成后自动返回对应 OA 流程。
- 教师和学生使用独立的 `HttpOnly` 会话 Cookie，学生会话不能访问教师流程管理接口。
- 忘记密码当前仅提供占位页面，不包含密码重置接口或数据库写操作。

## 流程删除

教师在教务流程列表点击删除后，必须输入完整流程名称才能执行永久删除。删除操作在单个数据库事务中清除流程草稿、发布版本、分享链接、学生流程实例、节点草稿、提交记录和截止时间特例；教师与学生账户不受影响。系统仅保留一条不含学生填写内容的最小删除审计记录。

已发布流程的节点、连线和字段快照不可变。截止时间作为运行参数独立保存；个别学生延期优先于统一截止时间。学生提交状态、填写内容和审核结果均按个人实例隔离。

## Linux 部署

```bash
docker compose up --build
```

默认服务：

- 前端入口：`http://localhost`
- 后端健康检查：`http://localhost/api/health`

## 当前边界

- 文件节点当前保存文件名、类型和大小元数据，尚未上传二进制文件至对象存储。
- 审核脚本配置已进入流程快照，但第一版不执行 Python 或 JavaScript 审核脚本。
- SQLite 适合单机第一版；多实例部署前应迁移至 PostgreSQL，并将会话和并发控制纳入统一基础设施。
- 现有材料收集模块仍保留前端演示状态，OA 流程模块已使用后端数据库持久化。
