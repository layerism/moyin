# 教师流程真实预览实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 教师可从已暂存草稿创建隔离的真实学生端预览，使用唯一虚拟学生完成上传、提交、AI 审核和节点推进，同时不污染正式业务数据。

**Architecture:** 在正式数据库中以预览根实体隔离数据：教师唯一虚拟学生、`preview` 流程版本和单一预览会话。现有学生运行 API 通过教师 Cookie 与预览令牌解析虚拟学生，继续复用正式仓储和 `StudentRuntimePage`；仅预览实例绕过时间规则。旧预览先清理 OSS，再事务删除数据库记录。

**Tech Stack:** FastAPI、SQLite、React、TypeScript、现有对象存储与 AI 审核服务

## Global Constraints

- 每位教师只绑定一个名称为“学生预览测试”的隐藏虚拟学生。
- 虚拟学生不能通过学生登录接口登录，也不进入名单、学生首页、进度或统计。
- 预览只读取数据库中的最新已暂存草稿。
- 每次预览清空该教师此前全部预览业务数据和文件。
- 预览忽略时间规则，但保持前置通过、提交、AI 审核、退回和节点推进逻辑。
- 预览在新标签页打开，不创建或覆盖正式学生登录 Cookie。
- `autoApprove = false` 且无 AI 审核的节点保持现有“审核中”行为，不新增人工审核接口。
- 不新增第三方依赖。
- 按项目约束不运行测试、构建或浏览器插件，只执行静态业务逻辑审计。
- 完成后清理开发缓存、提交并以本地方式重启服务，不使用 Docker。

---

### Task 1: 增加预览根实体与迁移

**Files:**
- Modify: `backend/app/core/database.py`

**Interfaces:**
- Produces: `student_accounts.account_kind`, `student_accounts.preview_owner_teacher_id`
- Produces: `flow_preview_sessions` 表
- Produces: `_apply_flow_preview_migration(connection: sqlite3.Connection) -> None`

- [ ] **Step 1: 扩展新建数据库结构**

为 `student_accounts` 新增默认 `normal` 的账号类型和预览教师外键；新增预览会话表。核心约束如下：

```sql
account_kind TEXT NOT NULL DEFAULT 'normal'
  CHECK (account_kind IN ('normal', 'preview')),
preview_owner_teacher_id INTEGER REFERENCES teacher_accounts(id),
UNIQUE(preview_owner_teacher_id)
```

```sql
CREATE TABLE IF NOT EXISTS flow_preview_sessions (
  id TEXT PRIMARY KEY,
  teacher_account_id INTEGER NOT NULL UNIQUE REFERENCES teacher_accounts(id),
  preview_student_account_id INTEGER NOT NULL REFERENCES student_accounts(id),
  flow_id TEXT NOT NULL REFERENCES flows(id),
  flow_version_id TEXT NOT NULL UNIQUE REFERENCES flow_versions(id),
  flow_instance_id TEXT NOT NULL UNIQUE REFERENCES flow_instances(id),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'cleaning')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

- [ ] **Step 2: 增加既有数据库迁移**

实现 `20260810_add_flow_preview_scope` 迁移：使用 `PRAGMA table_info(student_accounts)` 幂等增加两列，建立教师唯一预览账号索引，创建 `flow_preview_sessions`，最后写入 `schema_migrations`。在 `initialize_database()` 末尾调用迁移。

- [ ] **Step 3: 静态审计外键删除顺序**

确认预览清理顺序为会话、实例、版本；虚拟学生永久保留并复用，不因清理实例而删除。

---

### Task 2: 实现预览生命周期仓储

**Files:**
- Create: `backend/app/repositories/flow_previews.py`
- Modify: `backend/app/repositories/flow_instances.py`
- Modify: `backend/app/repositories/workflows.py`
- Reuse: `backend/app/repositories/flow_templates.py`
- Reuse: `backend/app/domain/workflow.py`

**Interfaces:**
- Produces: `mark_preview_for_cleanup(teacher_id: int) -> list[str]`
- Produces: `list_expired_preview_teacher_ids() -> list[int]`
- Produces: `delete_marked_preview(teacher_id: int) -> None`
- Produces: `create_preview(flow_id: str, teacher_id: int) -> tuple[dict[str, object], str]`
- Produces: `resolve_preview_actor(raw_token: str, teacher_id: int) -> dict[str, object]`
- Produces: `preview_session_is_active(connection: Any, flow_instance_id: str) -> bool`

- [ ] **Step 1: 标记并读取旧预览文件**

`mark_preview_for_cleanup` 在立即事务中把教师现有会话设为 `cleaning`，再通过会话实例查询全部 `uploaded_files.storage_key` 并返回。无旧会话时返回空列表。

- [ ] **Step 2: 删除旧预览数据库记录**

`delete_marked_preview` 只选择当前教师、`status = cleaning` 且关联版本 `status = preview` 的会话；先删会话和实例，再删模板映射、运行时配置及临时版本。所有节点草稿、提交、审核任务、模板下载事件和上传文件依赖实例级联删除。

- [ ] **Step 3: 取得教师唯一虚拟学生**

不存在时创建：

```text
student_no = preview-student-{teacher_id}
name = 学生预览测试
account_kind = preview
preview_owner_teacher_id = teacher_id
password_hash = 内部随机不可知密码的散列
```

已存在时复用同一行，不创建学生会话或名单记录。

- [ ] **Step 4: 从已暂存草稿创建临时版本**

在 `workflows.py` 提取 `prepare_runtime_config(connection, flow_id, config)`，让正式发布和预览共同执行确认节点视觉审核绑定、`validate_flow_config(..., require_publishable=True)`、审核脚本校验和 `validate_version_templates`，避免两套校验漂移。

`create_preview` 必须重新读取教师所有的 `flows.draft_config`，调用该共享准备函数。创建 `flow_versions.status = preview`、版本号 `0`、模板映射及流程实例；根节点为 `available`，其余节点为 `locked`。

生成 32 字节随机令牌，只保存 SHA-256 哈希；创建 24 小时 `active` 会话并返回运行实例载荷与原始令牌。

- [ ] **Step 5: 解析预览身份**

`resolve_preview_actor` 同时校验令牌哈希、教师 ID、会话 `active`、未过期、虚拟学生归属、流程所有权和实例归属，返回：

```python
{"id": student_id, "studentNo": student_no, "name": "学生预览测试", "preview": True}
```

任何条件不满足均返回统一的预览会话失效错误。

---

### Task 3: 让学生运行 API 安全识别预览身份

**Files:**
- Modify: `backend/app/services/security.py`
- Modify: `backend/app/api/routes/auth.py`
- Modify: `backend/app/api/routes/student_flows.py`
- Modify: `backend/app/repositories/flow_roster.py`

**Interfaces:**
- Produces: `get_current_runtime_student(...) -> dict[str, object]`
- Consumes: `resolve_preview_actor(raw_token, teacher_id)`

- [ ] **Step 1: 提取教师 Cookie 解析**

在 `security.py` 提取不改变现有行为的内部教师会话解析函数，使 `get_current_teacher` 和预览运行身份共同复用同一查询。

真实学生 Cookie 查询与学生登录查询增加 `account_kind = normal`。学生注册拒绝 `preview-student-` 保留前缀，避免正式账号占用系统虚拟学号。

- [ ] **Step 2: 新增运行时学生依赖**

`get_current_runtime_student` 接收 `X-Flow-Preview-Token`、`oa_session` 和 `teacher_session`：存在预览头时必须以教师 Cookie 解析教师并调用 `resolve_preview_actor`；不存在时调用现有真实学生解析。预览失败不得回退到真实学生 Cookie。

- [ ] **Step 3: 切换学生流程路由依赖**

将 `student_flows.py` 中所有节点运行、上传、下载、提交、重试和实例读取接口从 `Depends(get_current_student)` 改为 `Depends(get_current_runtime_student)`。共享链接进入接口仍要求真实学生身份，不允许虚拟学生从公开链接创建正式实例。

- [ ] **Step 4: 允许预览身份绕过名单**

`assert_student_roster_access` 仅在学生 `account_kind = preview`、`preview_owner_teacher_id` 与目标流程 `owner_id` 相同且存在匹配的 `active` 预览会话时放行；普通学生继续执行现有名单姓名与学号匹配。

---

### Task 4: 隔离时间规则与审核写回

**Files:**
- Modify: `backend/app/repositories/flow_instances.py`
- Modify: `backend/app/repositories/flow_runtime_state.py`
- Modify: `backend/app/repositories/audit_jobs.py`

**Interfaces:**
- Consumes: `preview_session_is_active(connection, flow_instance_id)`
- Produces: 预览实例的 `effectiveStartAt = None`, `effectiveDeadline = None`

- [ ] **Step 1: 统一识别预览实例**

实例读取与状态推进查询通过 `flow_preview_sessions.flow_instance_id` 判断是否预览，不通过账号名称或版本号推断。

- [ ] **Step 2: 绕过预览时间计算**

预览实例调用 `pending_node_status` 时传入空起始时间与空截止时间；`effective_deadline` 对预览实例返回 `None`；实例响应的 `effectiveStartAt` 和 `effectiveDeadline` 均为 `None`。前置节点通过判断保持原样。

- [ ] **Step 3: 阻止失效审核任务写回**

审核任务在成功、失败及重试写回节点前，若所属版本为 `preview`，必须验证对应会话仍为 `active`。会话处于 `cleaning`、过期或不存在时停止写回、下游推进与流程完成更新；正式审核任务不增加额外限制。

- [ ] **Step 4: 排除恢复旧预览任务**

`recover_audit_jobs` 不恢复已失效或处于清理状态的预览任务，只恢复正式任务和有效预览任务。

---

### Task 5: 增加教师创建预览接口与 OSS 清理

**Files:**
- Modify: `backend/app/api/routes/workflows.py`
- Reuse: `backend/app/services/object_storage.py`

**Interfaces:**
- Produces: `POST /api/workflows/{flow_id}/preview`
- Returns: `{ instanceId: string, previewToken: string, previewUrl: string }`

- [ ] **Step 1: 增加创建接口**

接口使用现有教师依赖，按顺序调用：

```text
mark_preview_for_cleanup
逐一 delete_object(storage_key)
delete_marked_preview
create_preview
```

任一 OSS 删除失败时保留 `cleaning` 会话、不创建新预览，并返回 `502` 与“旧预览文件清理失败，请重试”。

- [ ] **Step 2: 映射校验错误**

流程不存在或非所有者返回 `404`；草稿、模板或审核脚本不满足发布条件返回 `422`；预览创建冲突返回 `409`。响应 URL 固定为：

```text
/student/flows/{instanceId}?preview=1
```

- [ ] **Step 3: 清理过期会话**

创建当前预览前，对所有已过期会话复用同一标记、OSS 删除与数据库删除逻辑；清理失败不影响其他未过期教师会话，但记录为 `cleaning` 并在后续创建时重试。

---

### Task 6: 复用真实学生页打开教师预览

**Files:**
- Modify: `frontend/src/features/academic-flow/api.ts`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx`

**Interfaces:**
- Produces: `workflowApi.createPreview(serverId: string)`
- Produces: `FLOW_PREVIEW_TOKEN_KEY = "oa-flow-preview-token"`
- Produces: `StudentRuntimePage.preview?: boolean`

- [ ] **Step 1: 为运行 API 添加标签页级预览头**

`request` 从当前标签页 `sessionStorage` 读取 `FLOW_PREVIEW_TOKEN_KEY`；存在时添加：

```http
X-Flow-Preview-Token: <token>
```

`createPreview` 调用教师接口并返回 `instanceId`、`previewToken`、`previewUrl`。

- [ ] **Step 2: 增加教师预览按钮**

按钮位于“学生名单”和“暂存”之间。点击逻辑：

```text
revisionDirty = true -> 提示“请先暂存当前修改后再预览”
window.open 失败 -> 提示“请允许本站打开新标签页”
创建成功 -> 新标签页 sessionStorage 写入令牌并跳转 previewUrl
创建失败 -> 关闭空白页并显示 API 错误
```

创建中禁用预览、暂存和发布操作，防止重复会话创建。

- [ ] **Step 3: 识别预览运行路由**

`App.tsx` 在 `/student/flows/{id}?preview=1` 保持现有运行屏幕，但向 `StudentRuntimePage` 传入 `preview`。普通学生路由行为不变。

- [ ] **Step 4: 保持页面一致并关闭预览标签页**

`StudentRuntimePage` 只在 `onHome` 行为上区分预览：预览时清除标签页令牌并调用 `window.close()`；其他 UI、表单、上传、下载、提交、轮询和审核展示不增加预览副本。

---

### Task 7: 静态审计、清理、提交与重启

**Files:**
- Review: 本计划修改的全部文件

**Interfaces:**
- Produces: 隔离且可运行的教师预览闭环

- [ ] **Step 1: 审计正式查询隔离**

使用 `rg` 检查学生登录、学生首页、教师进度、发布版本、修订影响、审核恢复和数据库业务视图，确认均不会将 `preview` 根实体当作正式数据。

- [ ] **Step 2: 审计清理边界**

确认所有删除均由 `teacher_account_id`、会话 ID、`flow_version.status = preview` 和虚拟学生归属共同约束，不存在仅按学生 ID 或流程 ID 的宽泛删除。

- [ ] **Step 3: 检查差异**

```bash
git diff --check
git diff --stat
git status --short
```

不运行测试、构建或浏览器插件。

- [ ] **Step 4: 清理缓存并提交**

清理 `.pytest_cache`、`__pycache__` 和 `*.egg-info`；仅暂存本任务文件并提交：

```bash
git commit -m "feat: add isolated teacher flow runtime preview"
```

- [ ] **Step 5: 本地重启服务**

停止当前项目服务，从 `backend/` 启动 Uvicorn，并使用项目本地 Node 启动 Vite；检查后端监听 `8000`、前端监听 `5173`，不得使用 Docker。
