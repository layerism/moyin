# 教务流程重命名实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for inline execution, or `superpowers:subagent-driven-development` when the user explicitly chooses the single-subagent path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在教务流程列表为草稿及已发布流程增加安全、可审计的重命名能力，并使学生端立即读取新名称。

**Architecture:** 后端新增一个只更新流程名称的 PATCH 接口，并在 `BEGIN IMMEDIATE` 写事务内完成所有权、归档状态、名称合法性和同教师唯一性校验。前端复用现有 `NameDialog`，提交成功后以服务端返回的完整流程对象原位替换列表项，不触碰版本、名单、分享链接和学生实例。

**Tech Stack:** FastAPI、Pydantic、SQLite、React、TypeScript、现有 CSS 与 `fetch` API 封装。

## Global Constraints

- 当前分支实施；设计提交 `5f4925b` 是本任务代码修改前的回滚检查点。
- 只暂存并提交本计划及本任务文件；不得包含 `AGENTS.md`、`docs/05_oa_graph.md`、`.superpowers/` 等用户或无关改动。
- 不增加数据库字段、迁移、索引、前端依赖、独立重命名组件或新的全局状态。
- 草稿和已发布的未归档流程均可重命名；已发布流程无需重新发布。
- 仅更新 `flows.name` 与 `flows.updated_at`；不得改变流程 ID、状态、版本、节点、名单、分享令牌、学生实例或提交审核数据。
- 名称在前后端均去除首尾空白；不能为空、不能超过 120 字、不能等于原名、不能与同教师其他未归档流程重名。
- 后端是最终一致性边界，所有写入前校验必须位于同一个 `BEGIN IMMEDIATE` 事务内。
- 按项目约定不运行自动化测试、构建或浏览器测试；只做静态业务逻辑审计，由用户手动验收。
- 实现过程中不做中间提交；完成静态审计、缓存清理和服务重启后，只创建一个功能完成提交。

---

## 文件结构

- `backend/app/repositories/workflows.py`：实现事务化重命名、唯一性校验和审计日志。
- `backend/app/api/routes/workflows.py`：定义请求模型和 PATCH 路由，将领域错误映射为 HTTP 响应。
- `frontend/src/features/academic-flow/api.ts`：增加类型安全的重命名 API 调用。
- `frontend/src/App.tsx`：连接 API 与应用流程状态，按 ID 原位替换服务端权威对象。
- `frontend/src/features/home/HomeView.tsx`：增加重命名按钮、独立弹窗状态、前端校验与提交生命周期。
- `frontend/src/features/home/HomeDialogs.tsx`：以两个可选参数扩展现有 `NameDialog` 的选中文本和提交文案能力。
- `frontend/src/styles.css`：增加轻量铅笔按钮样式，保持现有操作区布局与可访问焦点样式。
- `docs/superpowers/plans/2026-08-09-flow-renaming.md`：本实施计划。

### Task 1: 后端事务与专用接口

**Files:**
- Modify: `backend/app/repositories/workflows.py:31-39,318-508`
- Modify: `backend/app/api/routes/workflows.py:1-65,165-210`

**Interfaces:**
- Produces: `rename_flow(flow_id: str, name: str, teacher_id: int) -> dict[str, object]`
- Produces: `PATCH /api/workflows/{flow_id}/name`，请求 `{"name": string}`，响应完整流程对象。
- Consumes: 现有 `get_connection()`、`utc_now_iso()`、`canonical_json()`、`get_flow()`、`DuplicateFlowNameError`、`FlowValidationError`。

- [ ] **Step 1: 在仓储层增加最小重命名函数**

  在 `create_flow()` 与 `clone_flow()` 附近增加 `rename_flow()`，按以下顺序完成逻辑：

  ```python
  def rename_flow(flow_id: str, name: str, teacher_id: int) -> dict[str, object]:
      new_name = name.strip()
      if not new_name or len(new_name) > 120:
          raise FlowValidationError("流程名称不能为空且不能超过 120 个字符")

      owner_id = str(teacher_id)
      now = utc_now_iso()
      with get_connection() as connection:
          connection.execute("BEGIN IMMEDIATE")
          flow = connection.execute(
              "SELECT * FROM flows WHERE id = ? AND owner_id = ? AND status != 'archived'",
              (flow_id, owner_id),
          ).fetchone()
          if flow is None:
              raise KeyError(flow_id)
          if new_name == flow["name"]:
              raise DuplicateFlowNameError("新名称不能与当前流程名称相同")
          duplicate = connection.execute(
              """
              SELECT 1 FROM flows
              WHERE owner_id = ? AND name = ? AND status != 'archived' AND id != ?
              LIMIT 1
              """,
              (owner_id, new_name, flow_id),
          ).fetchone()
          if duplicate is not None:
              raise DuplicateFlowNameError("已存在同名流程")
          connection.execute(
              "UPDATE flows SET name = ?, updated_at = ? WHERE id = ?",
              (new_name, now, flow_id),
          )
          connection.execute(
              """
              INSERT INTO audit_logs
                  (actor_id, action, entity_type, entity_id,
                   before_data, after_data, created_at)
              VALUES (?, 'workflow_renamed', 'workflow', ?, ?, ?, ?)
              """,
              (
                  owner_id,
                  flow_id,
                  canonical_json({"name": flow["name"]}),
                  canonical_json({"name": new_name}),
                  now,
              ),
          )
      return get_flow(flow_id, teacher_id)
  ```

  不复用 `_owned_flow()`，因为该辅助函数包含已归档流程；此接口必须将归档流程统一视为不存在。

- [ ] **Step 2: 增加 PATCH 请求模型与路由**

  在路由模块导入 `rename_flow`，定义不使用 `Field` 长度限制的请求模型，以便仓储层统一返回业务文案：

  ```python
  class RenameFlowRequest(BaseModel):
      name: str
  ```

  在 clone 路由后增加：

  ```python
  @router.patch("/{flow_id}/name")
  def patch_flow_name(
      flow_id: str,
      payload: RenameFlowRequest,
      teacher: dict[str, object] = Depends(get_current_teacher),
  ) -> dict[str, object]:
      try:
          return rename_flow(flow_id, payload.name, int(teacher["id"]))
      except KeyError as exc:
          raise not_found() from exc
      except DuplicateFlowNameError as exc:
          raise HTTPException(status_code=409, detail=str(exc)) from exc
      except FlowValidationError as exc:
          raise HTTPException(status_code=422, detail=str(exc)) from exc
  ```

- [ ] **Step 3: 静态核对后端原子性与影响范围**

  逐项阅读修改后的函数，确认：

  - 所有权、未归档、原名相同和重名校验均发生在 `BEGIN IMMEDIATE` 之后；
  - 重名查询明确排除当前 `flow_id`；
  - UPDATE 只写 `name`、`updated_at`；
  - 审计动作严格为 `workflow_renamed`，前后数据只记录名称；
  - 路由只接收 `name`，不接受状态、版本、配置、名单或链接字段；
  - 成功响应通过现有 `get_flow()` 返回完整流程。

### Task 2: 通用名称弹窗的最小扩展

**Files:**
- Modify: `frontend/src/features/home/HomeDialogs.tsx:60-106`

**Interfaces:**
- Produces: `NameDialog` 可选属性 `selectOnFocus?: boolean`。
- Produces: `NameDialog` 可选属性 `submittingLabel?: string`，默认值为 `"创建中"`。
- Consumes: 现有 `onCancel`、`onConfirm`、`submitting` 交互契约。

- [ ] **Step 1: 扩展属性且保持所有现有调用兼容**

  增加可选属性及默认值：

  ```tsx
  export function NameDialog({
    error = "",
    onCancel,
    onConfirm,
    onValueChange,
    placeholder,
    selectOnFocus = false,
    submitting = false,
    submittingLabel = "创建中",
    title,
    value,
  }: {
    error?: string;
    onCancel: () => void;
    onConfirm: () => void;
    onValueChange: (value: string) => void;
    placeholder: string;
    selectOnFocus?: boolean;
    submitting?: boolean;
    submittingLabel?: string;
    title: string;
    value: string;
  }) {
  ```

  输入框使用原生聚焦事件选中文本，不增加 ref、effect 或新组件：

  ```tsx
  onFocus={(event) => {
    if (selectOnFocus) event.currentTarget.select();
  }}
  ```

  提交按钮文案改为：

  ```tsx
  {submitting ? submittingLabel : "确定"}
  ```

- [ ] **Step 2: 静态核对兼容性**

  确认创建文件夹、重命名文件、创建流程等既有调用不传新属性时仍然：自动聚焦但不强制选中文本，提交中仍显示“创建中”，且提交期间背景关闭、取消和重复提交继续禁用。

### Task 3: 前端 API 与应用状态连接

**Files:**
- Modify: `frontend/src/features/academic-flow/api.ts:94-115`
- Modify: `frontend/src/App.tsx:560-595`

**Interfaces:**
- Produces: `workflowApi.renameFlow(serverId: string, name: string): Promise<ServerFlow>`。
- Produces: `AcademicFlowView.onRenameProcess(process, name): Promise<AcademicProcess>`。
- Consumes: Task 1 的 PATCH 接口和现有 `mapServerFlow(flow)`。

- [ ] **Step 1: 增加类型安全的 API 方法**

  在 `cloneFlow()` 附近增加：

  ```ts
  renameFlow(serverId: string, name: string) {
    return request<ServerFlow>(`/api/workflows/${encodeURIComponent(serverId)}/name`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
  },
  ```

- [ ] **Step 2: 在 App 层以服务端响应原位替换流程**

  向 `AcademicFlowView` 传入：

  ```tsx
  onRenameProcess={async (process, name) => {
    const renamed = mapServerFlow(
      await workflowApi.renameFlow(process.serverId ?? process.id, name),
    );
    setAcademicProcesses((current) =>
      current.map((item) => (item.id === renamed.id ? renamed : item)),
    );
    return renamed;
  }}
  ```

  必须使用 `map()` 保持原列表位置；不得使用 clone 逻辑中的前置插入，不得只在本地覆盖 `name`。

- [ ] **Step 3: 静态核对数据权威性**

  确认 API 返回类型是完整 `ServerFlow`，成功后用 `mapServerFlow()` 转换；失败时 `setAcademicProcesses()` 不执行；没有额外列表请求、乐观更新或学生端写操作。

### Task 4: 流程列表重命名交互

**Files:**
- Modify: `frontend/src/features/home/HomeView.tsx:459-735`
- Modify: `frontend/src/styles.css:330-410`

**Interfaces:**
- Consumes: Task 2 扩展后的 `NameDialog`。
- Consumes: Task 3 的 `onRenameProcess(process, name)`。
- Produces: 每个流程列表项的铅笔重命名按钮和独立重命名弹窗状态。

- [ ] **Step 1: 增加视图回调与独立状态**

  在 `AcademicFlowView` props 中加入：

  ```ts
  onRenameProcess: (process: AcademicProcess, name: string) => Promise<AcademicProcess>;
  ```

  在 clone 状态附近加入：

  ```tsx
  const [renameProcess, setRenameProcess] = useState<AcademicProcess | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  ```

- [ ] **Step 2: 实现前端即时校验与提交生命周期**

  增加提交函数：

  ```tsx
  const confirmRenameProcess = async () => {
    if (!renameProcess) return;
    const nextName = renameName.trim();
    if (!nextName || nextName.length > 120) {
      setRenameError("流程名称不能为空且不能超过 120 个字符");
      return;
    }
    if (nextName === renameProcess.name.trim()) {
      setRenameError("新名称不能与当前流程名称相同");
      return;
    }
    if (processes.some(
      (process) => process.id !== renameProcess.id && process.name.trim() === nextName,
    )) {
      setRenameError("已存在同名流程");
      return;
    }
    setRenameSubmitting(true);
    setRenameError("");
    try {
      await onRenameProcess(renameProcess, nextName);
      setRenameProcess(null);
      setRenameName("");
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "重命名失败，请稍后重试");
    } finally {
      setRenameSubmitting(false);
    }
  };
  ```

  错误时不得关闭弹窗或清空输入；只有服务端成功后才关闭。

- [ ] **Step 3: 在复制与删除之间增加显式铅笔按钮**

  使用原生按钮和内联 SVG，不引入图标依赖：

  ```tsx
  <button
    aria-label={`重命名流程 ${process.name}`}
    className="academic-flow-rename"
    onClick={() => {
      setRenameProcess(process);
      setRenameName(process.name);
      setRenameError("");
    }}
    title="重命名流程"
    type="button"
  >
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 20h4l11-11-4-4L4 16v4Zm10-13 4 4" />
    </svg>
  </button>
  ```

  按钮位于“复制”后、“删除”前。按钮自身处理点击，不嵌套在进入按钮内，因此不会触发打开流程。

- [ ] **Step 4: 渲染重命名弹窗**

  在创建流程弹窗附近增加：

  ```tsx
  {renameProcess ? (
    <NameDialog
      error={renameError}
      onCancel={() => {
        setRenameProcess(null);
        setRenameError("");
      }}
      onConfirm={() => void confirmRenameProcess()}
      onValueChange={(value) => {
        setRenameName(value);
        setRenameError("");
      }}
      placeholder="请输入新的流程名称"
      selectOnFocus
      submitting={renameSubmitting}
      submittingLabel="保存中"
      title="重命名流程"
      value={renameName}
    />
  ) : null}
  ```

  `NameDialog` 已保证提交期间不能通过背景、取消或重复确认关闭；本调用不得另造模态层。

- [ ] **Step 5: 添加最小按钮样式**

  在流程操作样式附近增加 `.academic-flow-rename`，尺寸与删除按钮保持 34×34，使用浅蓝背景、蓝色描边和可见焦点环；SVG 设为约 16×16、`fill: none`、`stroke: currentColor`。hover 只做边框/背景轻微强化，不增加动画库、tooltip 组件或菜单抽象。

- [ ] **Step 6: 静态核对交互状态隔离**

  确认重命名、创建、复制、删除分别使用独立目标、错误和提交状态；取消不改列表；请求失败保持输入；按钮含 `aria-label` 与 `title`；Enter 复用 `NameDialog` 的确认逻辑；成功后仅目标流程名称和服务端元数据变化。

### Task 5: 全链路静态审计、清理、提交与重启

**Files:**
- Review only: `backend/app/repositories/flow_instances.py`
- Review: 上述所有任务文件
- Do not modify: 数据库 schema、迁移、学生实例、流程版本及发布模块

**Interfaces:**
- Consumes: Task 1-4 的完整实现。
- Produces: 一个功能完成提交，以及重启后的本地 FastAPI/Vite 服务。

- [ ] **Step 1: 审计学生端名称读取链路**

  只读确认 `flow_instances.py` 继续通过 `flow_instances` JOIN `flows` 读取 `f.name AS flow_name`，并输出为运行时流程 `name`。不得复制名称到学生实例、发布版本或新增同步任务。

- [ ] **Step 2: 执行静态差异审计**

  使用 `git diff --` 限定本任务七个源文件和计划文件，逐项确认：

  - 没有 schema、迁移、版本、名单、链接、学生实例改动；
  - 后端校验和更新位于同一事务；
  - 前端使用服务端完整响应并原位替换；
  - 草稿与已发布状态未被前端或后端额外限制；
  - UI 入口、错误恢复、提交锁定和可访问标签完整；
  - 没有新增依赖、抽象层或不必要文件。

- [ ] **Step 3: 清理项目生成缓存**

  仅删除项目源码目录内的 `.pytest_cache`、`__pycache__`、`*.egg-info`；排除 `.git`、`frontend/node_modules`、虚拟环境和用户无关目录。先列出准确目标，再删除这些可再生成缓存。

- [ ] **Step 4: 创建唯一的功能完成提交**

  先执行 `git status --short`，只暂存：

  ```text
  backend/app/repositories/workflows.py
  backend/app/api/routes/workflows.py
  frontend/src/features/academic-flow/api.ts
  frontend/src/App.tsx
  frontend/src/features/home/HomeView.tsx
  frontend/src/features/home/HomeDialogs.tsx
  frontend/src/styles.css
  docs/superpowers/plans/2026-08-09-flow-renaming.md
  ```

  提交信息：

  ```bash
  git commit -m "feat: support renaming academic flows"
  ```

  不得暂存当前已存在的 `AGENTS.md`、`docs/05_oa_graph.md` 或 `.superpowers/` 改动。

- [ ] **Step 5: 本地重启服务并做存活验证**

  停止当前 5173 和 8000 端口对应的项目进程；从 `backend/` 以 Uvicorn、本地 Python 环境启动后端，从 `frontend/` 以 `npm run dev` 启动前端，不使用 Docker。仅执行服务存活检查：确认 8000 的 `/api/health` 返回 HTTP 200 和 `{"status":"ok"}`，5173 返回 HTTP 200；不执行功能测试或浏览器自动化。

## 手动验收清单

1. 教务流程列表每行在“复制”和删除之间显示铅笔按钮。
2. 点击后弹窗预填并选中当前名称，取消不改变流程。
3. 空名称、超过 120 字、原名相同和其他流程重名显示约定错误。
4. 草稿流程重命名成功且位置不变。
5. 已发布流程重命名成功，无需重新发布，分享链接不变。
6. 学生端重新读取该流程后显示新名称，节点和办理状态不变。
7. 请求失败时弹窗保持打开，输入内容可继续修改。
