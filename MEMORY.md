# 文档自动填写 Web：项目记忆

> 最后核对：2026-08-09。本文记录可长期复用的项目事实、业务约束和开发约定。判断“是否已实现”时，以当前源码和数据库结构为准；`docs/superpowers/specs/`、`docs/superpowers/plans/` 只表示设计或实施计划，不能单独证明功能已落地。

## 1. 项目定位与技术栈

- 项目当前核心是面向教师与学生的 OA DAG 流程系统：教师设计、发布和修订流程，学生按名单授权进入独立实例，逐节点填写/上传材料并接受自动审核。
- 前端：React 18、Vite 5、TypeScript，主要代码位于 `frontend/src/`。
- 后端：FastAPI、Python 3.11，主要代码位于 `backend/app/`。
- 数据库：SQLite，本地默认数据库为 `backend/storage/app.db`；建表和增量迁移集中在 `backend/app/core/database.py`。
- 文件存储：学生材料和节点模板通过阿里云 OSS 保存，配置从后端 `.env` 读取；数据库只保存对象键、校验值和文件元数据。
- 自动审核：FastAPI 启动时在同一进程内启动异步审核 worker；任务持久化在 `audit_jobs`，不是独立部署的外部队列。

## 2. 事实来源优先级

遇到文档与实现冲突时，按以下顺序核对：

1. 当前后端领域、仓储、路由代码和前端真实调用链；
2. `backend/app/core/database.py` 中的数据库结构；
3. 最近已完成的 Git 提交；
4. `docs/04_oa_workflow_runtime_design.md`、`docs/05_oa_graph.md`、`docs/06_check_scripts.md`；
5. `docs/superpowers/specs/` 和 `docs/superpowers/plans/`；
6. 根 README 和早期架构草案。

已知漂移：

- 根 `README.md` 的“当前边界”仍写着文件只保存元数据、审核脚本不执行；这已经落后于当前 OSS 上传、下载和审核 worker 实现。
- `docs/01_architecture.md` 仍保留“管理员上传任意 Python 脚本”的早期设想；当前主路径是仓库内版本化预配置脚本目录，不应恢复任意脚本上传接口。
- 设计文档中的接口路径可能早于当前路由，修改功能前必须以 `backend/app/api/router.py` 和各 `routes/*.py` 为准。

## 3. 核心代码地图

### 后端

- 应用入口与审核 worker 生命周期：`backend/app/main.py`
- API 聚合：`backend/app/api/router.py`
- 流程 CRUD、复制、重命名、草稿、发布和修订影响：`backend/app/api/routes/workflows.py`
- 名单管理：`backend/app/api/routes/flow_roster.py`
- 学生进入、实例读取、暂存、提交、文件和审核重试：`backend/app/api/routes/student_flows.py`
- 教师进度、截止时间和审核脚本目录：`backend/app/api/routes/workflow_admin.py`
- 发布后修订约束和影响分析：`backend/app/domain/workflow_revision.py`
- 节点运行状态与提交事务：`backend/app/repositories/flow_instances.py`
- 名单授权：`backend/app/repositories/flow_roster.py`
- OSS 文件元数据和归属：`backend/app/repositories/flow_files.py`、`backend/app/services/object_storage.py`
- 审核脚本目录与版本解析：`backend/app/services/audit_script_catalog.py`、`audit_script_runtime.py`
- 审核任务：`backend/app/repositories/audit_jobs.py`、`backend/app/services/audit_job_worker.py`、`audit_script_executor.py`

### 前端

- OA 设计器：`frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- 节点表单字段编辑与排序：`FormFieldEditor.tsx`、`formFields.ts`、`reorder.ts`
- 学生运行页：`StudentRuntimePage.tsx`
- 学生 DAG：`StudentFlowTopology.tsx`
- 教师进度：`TeacherProgressPanel.tsx`
- 流程后端调用：`api.ts`
- 流程复制：`flowClone.ts`、`frontend/src/features/home/FlowCloneDialog.tsx`
- 认证与账号历史：`frontend/src/features/auth/`
- 全局现有视觉语言：`frontend/src/styles.css`

## 4. OA 流程长期业务约束

### 流程定义与发布

- 草稿可以编辑；发布时生成不可变的 `flow_versions.config_snapshot`，运行实例只引用发布快照。
- 发布节点以稳定节点 ID/`node_key` 关联运行数据，不能用标题或坐标代替标识。
- 已发布节点不可删除；旧连线不可删除或改向。
- 发布后修订中，旧节点只允许修改 `title`、`requirement`、`startAt`、`deadlineAt`。
- 新增连线必须至少连接一个新增节点，不能在两个既有节点间增加新连线。
- `workflow_revision.analyze_revision()` 将新增、业务字段变化和前驱变化作为初始影响，并使所有可达下游节点失效/重锁；历史填写内容不清空。
- 若修订内容与已发布版本无实质差异，前端本地退出修订，不创建无意义的新版本。

### 授权与实例

- `flow_roster_entries` 是访问授权来源；`flow_instances` 只是运行状态，不能反过来当作授权。
- 学生访问必须持续校验当前流程中有效的姓名、学号和 `flow_id` 名单记录。
- 学生可从分享令牌或流程中心进入；进入时才按 `(flow_version_id, student_account_id)` 幂等、懒惰创建实例，不在导入名单时批量创建。
- 名单授权被移除后，历史实例仍保留，但学生读取、暂存和提交都应被拒绝。
- 教师、学生和超级管理员权限边界不能仅靠前端隐藏；后端依赖项和资源归属校验是最终边界。

### 节点运行状态

- 主要状态包括 `locked`、`scheduled`、`available`、`draft`、`reviewing`、`approved`、`rejected`、`audit_error`、`expired`。
- 前驱节点全部 `approved` 后，下游才可开放；起始时间和有效截止时间仍会进一步限制状态。
- 有效截止时间为学生个别延期优先于节点统一截止时间；服务端时间是是否允许提交的最终依据。
- 提交使用 `idempotency_key` 防止重复创建提交。
- 无审核脚本且 `autoApprove=true` 的节点可直接通过；带审核脚本的文件节点进入 `reviewing`。
- 审核通过后节点变为 `approved` 并推进下游；业务审核不通过变为 `rejected`；审核服务最终失败变为 `audit_error`，允许学生触发重试。
- 已通过的表单节点允许学生在截止时间前发起修改；新提交仍保持通过状态，不回锁已经开放的下游。文件节点不套用此规则。

### 文件与模板

- 文件先上传，再提交 `fileId`；提交时后端重新验证文件属于当前学生、当前节点且尚未关联其他提交。
- 上传成功后文件记录暂存于 `uploaded_files`，正式提交后关联不可变 `submissions`。
- 下载通过后端权限校验后生成短期 OSS 签名 URL，不能把 AccessKey 或永久对象地址下发到浏览器。
- 模板资产与发布版本绑定；学生下载事件单独记录，不能用前端状态代替服务端记录。
- 文件名规则同时在前端提示和后端约束层考虑；模板名称匹配允许处理常见重复下载后缀，但不能放宽文件类型和归属校验。
- 上传异常使用项目风格的本地 `uploadWarning` 与 `role="alertdialog"`；警告框不得关闭底层节点弹窗，也不得让点击穿透到背景。

### 学生预览一致性

- 教师发起的真实学生预览与正式学生端必须复用同一套学生运行界面、交互行为和配置解释，不能为预览单独实现一套可见功能或只修改其中一侧。
- 预览身份、临时数据隔离、有效期和清理机制可以在后台不同，但这些技术差异不得造成教师预览与正式学生端在可见内容、操作方式或节点业务配置上的漂移。
- 后续修改学生端页面、拓扑、节点弹窗、上传提交或配置渲染时，必须同时审计预览与正式入口。

## 5. 审核脚本与任务链路

- 预配置脚本目录契约：`backend/scripts/<script-id>/manifest.json`，具体版本位于 `versions/<version>/handler.py` 或 `handler.js`。
- 脚本 ID、语言、版本、入口路径、文件大小和 SHA-256 都由目录服务校验；已发布流程固定脚本版本和 hash，旧版本文件必须保留。
- 当前目录同时支持 Python 和 JavaScript 入口；不要依据早期文档把能力误写成仅 Python。
- 脚本输出至少包含 `schemaVersion="1.0"`、布尔值 `passed`、面向学生的 Markdown 字符串 `reason` 和结构化 `details`。
- `reason` 不得泄露 OSS 对象键、内部文件 ID、脚本路径、技术异常或原始 HTML；学生不应依赖 `details` 才能理解如何修改材料。
- 提交流程固定脚本 ID、版本、脚本 hash、参数配置 hash 和参数快照；worker 执行前再次比对，避免发布后目录变化污染历史流程。
- worker 在 FastAPI lifespan 中启动，循环领取 `pending` 任务；服务重启时会恢复遗留 `running` 任务，并为缺失任务的 `reviewing` 提交补建任务。
- 审核失败有重试调度；不得把“脚本业务不通过”和“脚本执行异常”合并成同一学生状态。

## 6. 已落地的重要交互与功能

以下功能均有当前源码和已完成提交支持：

- 名单驱动的学生流程可见性和懒创建实例。
- 学生文件上传、OSS 下载、模板下载记录和文件名警告。
- 学生端 Markdown 审核结果、明确的审核中页面、失败重试和已通过绿色状态。
- 节点统一截止时间、学生单独延期、自定义日期时间选择器和显式确认/取消。
- 发布后受约束修订、修订影响分析及受影响下游重锁。
- 已通过表单在截止时间前修改。
- 流程复制：复制流程定义，但不复制名单、学生实例和运行历史。
- 流程重命名，并维持同一教师下名称唯一性。
- 双击节点打开配置、`Escape` 关闭检查器，并移除自动画布布局入口。
- 表单字段类型、单选/多选紧凑编辑、字段与选项的按钮/拖拽排序。
- 教师/学生账号历史只记住姓名和工号/学号，不保存密码、Cookie、Session ID 或 Token。
- 超级管理员数据库查看与受控行级编辑/删除。

“基础信息模板”入口已移除；不要在新功能中重新引入同名固定模板，除非用户明确提出新的业务定义。

## 7. 本地服务操作

默认不使用 Docker，分别启动前后端：

本地后端和 Docker 部署统一使用 `backend/storage/app.db`。本地启动前必须进入 `backend/` 目录；Docker 必须将宿主机 `./backend/storage` 挂载到容器 `/app/storage`。不得从项目根目录启动后端，也不得创建或使用项目根目录的 `storage/`。

```bash
cd backend
./.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

```bash
cd frontend
export PATH="$PWD/../.local/node/bin:$PATH"
npm run dev
```

前端固定使用项目 `.local/node` 中的 Node.js `24.18.0` 和 npm `11.16.0`，不得依赖系统安装。

进程级检查标准：

- 前端监听 `5173`，后端监听 `8000`；
- 进程查询受限时优先用 `lsof -nP -iTCP:<port> -sTCP:LISTEN`；
- 关闭服务时只终止已确认属于本项目的进程，并复核 5173、8000 端口释放；
- “查看状态”必须保持只读，不能顺带重启。
- 默认不发送 HTTP 健康检查或浏览器请求；只有用户明确要求或任务约束允许时才执行，并与业务逻辑审计分别说明。

## 8. 当前项目开发约定

- 用户明确要求记住的长期偏好统一写入根目录 `MEMORY.md`；临时任务细节不作为长期偏好记录。
- 只有涉及源代码、业务逻辑、接口、数据结构或运行行为的变更，才按代码功能改动流程处理。
- 纯文档编写、排版或措辞调整直接完成；默认不使用 Superpowers、build-web-app、Ponytail 等插件，不编写 `docs/superpowers` 文档，不启动 subagent，不创建检查点提交，也不重启服务。
- 文档任务如果同时要求改变代码功能或运行行为，按代码功能改动流程处理。
- 代码功能改动前先做业务逻辑检查，补齐缺失条件并识别与现有规则的冲突。
- 按任务需要使用 Superpowers、build-web-app 和 Ponytail，不为无关能力增加流程；当前 `AGENTS.md` 的直接要求优先于技能默认流程。
- 代码功能改动前先形成 `docs/superpowers/` 下的设计或计划材料并确认需求。
- 默认在当前分支工作。代码功能改动前创建一次只包含任务相关文件的 checkpoint，完成后创建一次结果 checkpoint，中间不提交。
- 大改动绝不能省略 checkpoint commit：实施前提交基线检查点，全部改动完成后提交结果检查点；若 `.git` 只读或环境权限导致提交失败，必须立即向用户报告，不能把未提交状态表述为已完成检查点。
- 工作树中已有或未跟踪内容属于用户，checkpoint 和结果提交都不能夹带无关文件。
- 每项代码功能改动任务最多启动一个 subagent。
- 代码功能改动过程中不运行测试、不使用浏览器插件，仅做业务逻辑审计；交付时必须明确未运行的检查，不能声称“全部验证通过”。
- 代码功能改动完成后以非 Docker 的本地方式重启服务，并按端口和工作目录进行进程级核对。
- 收尾只清理项目生成的 `.pytest_cache`、`__pycache__`、`*.egg-info` 等中间缓存，不能广泛删除 `node_modules` 内的 `dist` 等依赖内容。
- UI 修改必须沿用现有视觉语言：白色面板、灰色边框、红色错误语义、蓝色主按钮和既有圆角/间距，不另造一套风格。
- 小型代码功能改动仍需先列出实施计划并由用户确认，但不额外扩写无关文档。

## 9. 常见风险

- 不要把计划文档、README 文案或前端按钮当作功能已实现的证据，必须追到后端路由、仓储事务和前端真实调用。
- 不要把 `flow_instances` 查询改造成授权逻辑；授权必须先看 active roster 和 published flow。
- 不要破坏发布快照对审核脚本版本/hash、模板资产和节点稳定 ID 的固定。
- 不要用客户端传入的学生 ID、截止时间或文件归属作为可信依据。
- 不要在修订时清空受影响节点的历史草稿/提交；应重置访问状态并保留历史内容。
- 不要广泛清理 `dist`、缓存或构建目录；`node_modules` 内也存在依赖所需的同名目录。
- 静态检查、健康检查和人工业务审计必须分别陈述，不能互相替代。

## 10. 代码功能改动的最小检查清单

1. 阅读当前 `AGENTS.md`、本文件、目标代码和相关最新 spec/plan。
2. 查看 `git status --short`，区分用户已有改动与本次任务文件。
3. 沿前端调用、API 路由、领域/仓储和数据库表追完整链路。
4. 判断需求是否违反名单授权、发布快照、修订限制、节点状态或文件归属约束。
5. 按约定创建任务范围 checkpoint 和 `docs/superpowers/` 设计或计划。
6. 实现完成后只做约定允许的逻辑审计，清理限定缓存，提交结果 checkpoint，重启本地服务并如实说明验证边界。
