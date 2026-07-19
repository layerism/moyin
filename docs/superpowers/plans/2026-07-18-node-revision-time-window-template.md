# OA 节点修订时间窗口与文件模板实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for inline implementation. If the user explicitly requests delegation, use at most one subagent for the whole implementation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使已发布 OA 的旧节点只能修订描述、起始时间和截止时间，并在修订后按 DAG 失效该节点及下游；同时为首次发布的新文件节点增加 OSS 模板上传、版本冻结、学生先下载后上传能力。

**Architecture:** 继续以 `flow_versions.config_snapshot` 作为流程业务快照，在现有修订分析中加入严格白名单和时间字段，在现有节点实例迁移中统一计算 `locked / scheduled / available / expired`。模板使用三个关系表保存不可变资产、版本引用和节点实例下载事件；新增一个聚焦模板资产的仓储模块，复用现有 OSS、名单鉴权、文件限制和节点实例，不引入通用资产框架。

**Tech Stack:** FastAPI、Pydantic、SQLite、React、TypeScript、Vite、现有对象存储适配器。

## Global Constraints

- 在当前分支实施，不创建 worktree。
- 设计提交 `e14fec7` 是实施前业务检查点；本计划提交后再开始代码实现，实现期间不创建中间提交，完成后只创建一个实现提交。
- 不暂存或覆盖用户已有的 `AGENTS.md`、`docs/05_oa_graph.md` 和 `.superpowers/` 文件。
- 不运行自动化测试、构建、浏览器、Playwright 或 Docker；只做静态业务审计并交由用户按验收清单手测。
- 不改变名单可见性、审核脚本版本冻结、学生原文件 OSS 存储和个别学生延期语义。
- 不新增在线模板预览、模板内容派生检测、模板管理后台或历史旧节点补传模板。
- 完成后清理 `__pycache__`、`.pytest_cache`、`*.egg-info` 等缓存，并以本地进程方式重启前后端服务。

## File Map

### Backend

- `backend/app/core/database.py`：增加模板资产、版本模板和下载事件表及索引。
- `backend/app/domain/workflow.py`：验证 `startAt < deadlineAt`、非文件节点无模板及模板元数据形状。
- `backend/app/domain/workflow_revision.py`：定义旧节点可修改白名单、位置锁定、新边约束和修订失效集合。
- `backend/app/domain/workflow_runtime.py`：集中实现时间窗口解析和节点开放状态判断。
- `backend/app/repositories/flow_templates.py`（新增）：教师模板上传上下文、资产切换/删除、发布版本冻结、学生签名下载与下载事件。
- `backend/app/repositories/workflows.py`：在草稿、影响预览、发布和实例迁移中接入修订规则、时间基线及模板冻结。
- `backend/app/repositories/flow_runtime_state.py`：在下游推进时使用统一时间窗口状态。
- `backend/app/repositories/flow_instances.py`：实例创建/读取/写入时返回并强制执行 `scheduled`、起始时间和模板状态；保留个别延期，删除统一截止时间写入口。
- `backend/app/repositories/flow_files.py`：配置模板时要求当前节点实例已有下载事件。
- `backend/app/api/routes/workflows.py`：增加教师模板上传和删除接口及错误映射。
- `backend/app/api/routes/student_flows.py`：增加学生模板下载接口，并统一时间窗口错误映射。
- `backend/app/api/routes/workflow_admin.py`：移除统一截止时间接口，保留个别学生延期和进度接口。

### Frontend

- `frontend/src/types.ts`：扩展节点起始时间和模板资产类型。
- `frontend/src/features/academic-flow/academicFlowData.ts`：新节点默认初始化空时间和空模板。
- `frontend/src/features/academic-flow/flowRevision.ts`：表达旧节点移动、字段、模板和新边限制。
- `frontend/src/features/academic-flow/runtimeTypes.ts`：增加 `scheduled`、有效起始时间、模板元数据和下载状态。
- `frontend/src/features/academic-flow/api.ts`：增加模板上传/删除/下载请求，移除统一截止时间请求。
- `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`：实现修订锁定、厚重时间卡、模板资产卡及上传前保存草稿。
- `frontend/src/features/academic-flow/TeacherProgressPanel.tsx`：移除统一截止时间编辑，保留个别延期。
- `frontend/src/features/academic-flow/StudentRuntimePage.tsx`：显示定时开放倒计时和模板下载后上传步骤。
- `frontend/src/styles.css`：补充时间卡、模板卡、定时状态及响应式样式。

---

### Task 1: 扩展数据库与节点数据契约

**Files:**
- Modify: `backend/app/core/database.py`
- Modify: `backend/app/domain/workflow.py`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/features/academic-flow/academicFlowData.ts`

**Interfaces:**
- Adds: `AcademicFlowNode.startAt`, `AcademicFlowNode.templateAsset`。
- Adds: `flow_template_assets`, `flow_version_templates`, `template_download_events`。
- Preserves: 缺少新字段的历史 JSON 按 `null` 读取，不回写或破坏历史版本。

- [ ] **Step 1: 增加前端节点模板类型**

在 `frontend/src/types.ts` 定义并接入：

```ts
export type NodeTemplateAsset = {
  assetId: string;
  contentType: string;
  originalName: string;
  sha256: string;
  sizeBytes: number;
};

// AcademicFlowNode
startAt?: string | null;
deadlineAt?: string | null;
templateAsset?: NodeTemplateAsset | null;
```

在 `createNode` 的默认对象中加入：

```ts
startAt: null,
deadlineAt: null,
templateAsset: null,
```

- [ ] **Step 2: 增加 SQLite 表**

沿用 `database.py` 的启动迁移模式创建：

```sql
CREATE TABLE IF NOT EXISTS flow_template_assets (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  node_key TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL,
  etag TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES teacher_accounts(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flow_version_templates (
  flow_version_id TEXT NOT NULL REFERENCES flow_versions(id) ON DELETE CASCADE,
  node_key TEXT NOT NULL,
  template_asset_id TEXT NOT NULL REFERENCES flow_template_assets(id) ON DELETE RESTRICT,
  PRIMARY KEY (flow_version_id, node_key)
);

CREATE TABLE IF NOT EXISTS template_download_events (
  node_instance_id TEXT NOT NULL REFERENCES node_instances(id) ON DELETE CASCADE,
  template_asset_id TEXT NOT NULL REFERENCES flow_template_assets(id) ON DELETE RESTRICT,
  student_account_id INTEGER NOT NULL REFERENCES student_accounts(id),
  downloaded_at TEXT NOT NULL,
  PRIMARY KEY (node_instance_id, template_asset_id)
);
```

增加按 `flow_id, node_key` 和 `student_account_id` 查询所需索引；不迁移历史记录。

- [ ] **Step 3: 扩展配置验证**

在 `validate_flow_config` 的节点循环中调用聚焦校验函数：

```py
validate_node_time_window(node)
validate_node_template_metadata(node)
```

规则为：时间必须可解析；二者存在时 `startAt < deadlineAt`；非文件节点不得有模板；模板元数据必须包含设计契约中的五个字段。资产归属与真实文件限制留到数据库边界校验，不能信任客户端元数据。

### Task 2: 收紧已发布流程修订规则

**Files:**
- Modify: `backend/app/domain/workflow_revision.py`
- Modify: `backend/app/repositories/workflows.py`
- Modify: `backend/app/api/routes/workflows.py`
- Modify: `frontend/src/features/academic-flow/flowRevision.ts`

**Interfaces:**
- Consumes: 最新发布版本及所有仍有学生实例的源版本。
- Produces: 旧节点只有 `requirement / startAt / deadlineAt` 可变；旧位置、模板、业务字段和旧边不可变；新增边至少接触一个新增节点。
- Errors: 所有非法修订统一映射为教师可读 `409`。

- [ ] **Step 1: 定义旧节点白名单比较**

将修订字段拆为：

```py
REVISION_EDITABLE_NODE_FIELDS = ("requirement", "startAt", "deadlineAt")
REVISION_LOCKED_NODE_FIELDS = (
    "kind", "title", "x", "y", "infoFields", "fileExtensions", "fileLimitMb",
    "auditScriptId", "auditScriptVersion", "auditScriptHash",
    "auditScriptConfigHash", "auditScriptAcceptedExtensions", "auditScriptParams",
    "auditScriptType", "auditScriptName", "autoApprove", "templateAsset",
)
```

`changedNodeIds` 只由三个允许字段的差异产生；锁定字段差异直接抛出 `PublishedNodeMutationError`，而不是进入失效分析。

- [ ] **Step 2: 校验新增连线边界**

保留现有旧节点和旧边存在性校验，并增加：

```py
for edge in added_edges:
    if edge["source"] in published_node_ids and edge["target"] in published_node_ids:
        raise PublishedEdgeMutationError("新增连线必须至少连接一个新增节点")
```

边身份使用端点和端口的完整稳定键，不能只比较前端可替换的 `edge.id`。

- [ ] **Step 3: 在三个服务边界执行同一校验**

让 `save_draft`、`get_revision_impact`、`publish_flow` 都调用同一 `assert_valid_revision(previous, current)`。路由捕获新增异常并返回 `409`，防止绕过 UI 或直接调用发布接口。

- [ ] **Step 4: 修正前端修订能力判断**

调整 `flowRevision.ts`：

```ts
export function canMoveRevisionNode(nodeId: string, publishedNodeIds: readonly string[]) {
  return !publishedNodeIds.includes(nodeId);
}

export function canEditRevisionNodeCore(nodeId: string, publishedNodeIds: readonly string[]) {
  return !publishedNodeIds.includes(nodeId);
}

export function canEditRevisionNodeTiming() {
  return true;
}
```

新增边提交前使用同一“至少一端为新增节点”判断；旧边继续由 `preservePublishedEdges` 保底恢复。

### Task 3: 统一时间窗口运行状态

**Files:**
- Modify: `backend/app/domain/workflow_runtime.py`
- Modify: `backend/app/repositories/flow_runtime_state.py`
- Modify: `backend/app/repositories/flow_instances.py`
- Modify: `backend/app/repositories/flow_files.py`
- Modify: `backend/app/repositories/workflows.py`

**Interfaces:**
- Produces: `locked -> expired | scheduled | available` 的唯一公共状态计算顺序。
- Preserves: `draft / submitted / reviewing / approved / rejected / audit_error` 等已有提交后状态不因时间到点倒退。

- [ ] **Step 1: 增加纯时间判断函数**

在 `workflow_runtime.py` 增加：

```py
def start_is_in_future(value: str | None, now: datetime | None = None) -> bool:
    start = parse_datetime(value)
    return bool(start and start > (now or datetime.now(UTC)))

def pending_node_status(
    predecessors_approved: bool,
    start_at: str | None,
    deadline_at: str | None,
    now: datetime | None = None,
) -> str:
    if not predecessors_approved:
        return "locked"
    if deadline_has_passed(deadline_at, now):
        return "expired"
    if start_is_in_future(start_at, now):
        return "scheduled"
    return "available"
```

- [ ] **Step 2: 所有实例创建和推进复用公共函数**

将根节点初始化、`advance_downstream`、修订 `_migrate_instance` 和实例读取时的惰性状态刷新改为调用 `pending_node_status`。先读取个别学生截止时间覆盖，再回退版本统一截止时间；起始时间只来自版本节点快照。

- [ ] **Step 3: 所有写入口重新检查窗口**

在保存草稿、上传文件、提交节点和重试审核前重新加载当前节点状态；`scheduled`、`locked`、`expired` 均拒绝新写入。模板下载同样只允许开放中的可写节点。

- [ ] **Step 4: 修正个别延期后的状态恢复**

`set_student_deadline` 不能再把 `expired` 无条件恢复为 `available`；按前置条件和 `startAt` 重新计算，可能恢复为 `locked`、`scheduled`、`draft` 或 `available`。

### Task 4: 实现教师模板资产仓储

**Files:**
- Create: `backend/app/repositories/flow_templates.py`
- Modify: `backend/app/api/routes/workflows.py`

**Interfaces:**
- Adds: `POST /api/workflows/{flow_id}/nodes/{node_key}/template`。
- Adds: `DELETE /api/workflows/{flow_id}/nodes/{node_key}/template`。
- Reuses: `validate_file_metadata`, `get_object_storage`, `object_key`, `canonical_json`。

- [ ] **Step 1: 解析可编辑模板上下文**

仓储函数必须在事务内读取教师所属流程和服务端 `draft_config`，确认节点为文件节点，并用历史已发布节点集合拒绝旧节点模板变更：

```py
if node_key in historical_node_ids:
    raise TemplateMutationError("已发布节点的模板不可修改")
```

- [ ] **Step 2: 上传不可变资产并切换草稿引用**

路由以分块方式计算大小与 SHA-256，使用节点学生上传限制调用 `validate_file_metadata`，再上传 OSS。数据库事务插入资产并仅替换目标节点：

```py
node["templateAsset"] = {
    "assetId": asset_id,
    "contentType": content_type,
    "originalName": filename,
    "sha256": digest,
    "sizeBytes": size_bytes,
}
```

返回模板元数据和新草稿哈希。OSS 上传成功但数据库失败时删除新对象；替换成功后仅清理未被发布版本引用的旧资产，清理失败不回滚新引用。

- [ ] **Step 3: 删除仅存在于可编辑草稿的模板**

删除接口清空 `templateAsset`，再删除未被 `flow_version_templates` 引用的资产及 OSS 对象。旧节点、跨 OA 资产或错误节点归属返回 `409/404`，不接受客户端传入对象键。

- [ ] **Step 4: 记录教师审计日志**

上传、替换、删除分别写 `audit_logs`，只记录资产 ID、文件名、摘要和大小，不记录签名 URL、OSS 密钥或对象存储配置。

### Task 5: 在发布版本中冻结模板与时间基线

**Files:**
- Modify: `backend/app/repositories/workflows.py`
- Modify: `backend/app/repositories/flow_templates.py`

**Interfaces:**
- Produces: 每个发布版本独立的 `flow_version_templates` 引用。
- Migrates behavior: 新版本统一截止时间来自节点配置，不再被旧运行时覆盖静默替换。

- [ ] **Step 1: 规范化第一次修订的截止时间基线**

读取历史版本最新 `flow_node_runtime_configs.deadline_at`，在 `get_flow` 首次向教师返回已发布配置时，将它覆盖到对应历史节点的 `deadlineAt`，并将同一规范化结果作为 `save_draft / get_revision_impact / publish_flow` 的旧版本比较基线。后续草稿哈希和发布均使用规范化配置，确保“未改时间”不失效，“修改时间”一定计入修订；不能只改 UI 展示而让后端继续与旧快照比较。

- [ ] **Step 2: 发布前验证真实资产**

对每个非空 `templateAsset` 从数据库读取资产，校验 `flow_id`、`node_key`、元数据摘要、文件扩展名和大小，并拒绝客户端伪造或跨流程引用。

- [ ] **Step 3: 写入版本模板映射**

插入 `flow_versions` 后，为配置模板的文件节点写入：

```sql
INSERT INTO flow_version_templates
  (flow_version_id, node_key, template_asset_id)
VALUES (?, ?, ?)
```

版本发布事务内任何映射失败均整体回滚。

- [ ] **Step 4: 停止覆盖新版本统一截止时间**

删除 `_runtime_deadlines_for_publish` 对历史节点的遮蔽逻辑；`flow_node_runtime_configs.deadline_at` 直接使用发布配置中的 `deadlineAt`，仅作为运行时读取兼容表保留。

### Task 6: 扩展修订迁移与下载记录生命周期

**Files:**
- Modify: `backend/app/repositories/workflows.py`

**Interfaces:**
- Consumes: `changedNodeIds | predecessorChangedNodeIds | addedNodeIds` 的可达后继闭包。
- Produces: 失效节点删除后重建；未失效节点原状态保留。

- [ ] **Step 1: 保持失效闭包包含修订节点自身**

确认 `reachable_successors(current, initial_impact)` 继续以包含起点的集合开始，描述、起始或截止时间变化均进入 `changedNodeIds`。

- [ ] **Step 2: 重建节点时按新窗口计算状态**

`_migrate_instance` 使用新 DAG 前置状态、新 `startAt` 和有效截止时间调用 `pending_node_status`，不再只按截止时间区分 `available/expired`。

- [ ] **Step 3: 利用外键清除下载事件**

失效流程继续删除原 `node_instances`，由 `template_download_events.node_instance_id ON DELETE CASCADE` 清除下载记录。审核驳回、重复上传和普通重试不删除节点实例，因此自然保留下载资格，不另写重置分支。

### Task 7: 实现学生模板下载与上传强制顺序

**Files:**
- Modify: `backend/app/repositories/flow_templates.py`
- Modify: `backend/app/repositories/flow_files.py`
- Modify: `backend/app/api/routes/student_flows.py`

**Interfaces:**
- Adds: `POST /api/student/node-instances/{node_instance_id}/template/download`。
- Produces: `{ url, originalName, sizeBytes }`。
- Enforces: 有模板时必须存在当前节点实例与当前资产对应的下载事件才能上传。

- [ ] **Step 1: 鉴权并记录模板下载**

模板下载仓储查询链必须同时绑定：学生账号、名单权限、已发布版本、节点实例、`flow_version_templates` 当前资产和开放状态。成功生成签名 URL 后写入：

```sql
INSERT INTO template_download_events
  (node_instance_id, template_asset_id, student_account_id, downloaded_at)
VALUES (?, ?, ?, ?)
ON CONFLICT(node_instance_id, template_asset_id)
DO UPDATE SET downloaded_at = excluded.downloaded_at
```

该事件表本身作为学生下载审计证据；不再为每次重复点击额外复制一条 `audit_logs`，避免两个审计源产生不一致。

- [ ] **Step 2: 在上传上下文统一强制下载**

扩展 `get_upload_context`：如果版本节点有模板但不存在匹配下载事件，抛出 `FileContextError("请先下载当前节点模板")`。无模板节点不增加任何额外条件。

- [ ] **Step 3: 映射存储和运行时错误**

学生路由分别返回：未配置/不存在 `404`，未开放、未下载或非法状态 `409`，OSS 未配置 `503`，签名失败 `502`。响应不包含 `storage_key`。

### Task 8: 扩展运行时响应契约

**Files:**
- Modify: `backend/app/repositories/flow_instances.py`
- Modify: `frontend/src/features/academic-flow/runtimeTypes.ts`

**Interfaces:**
- Adds: `RuntimeNodeStatus = "scheduled"`。
- Adds: `effectiveStartAt`, `template`, `templateDownloaded`。

- [ ] **Step 1: 聚合模板和时间信息**

`get_instance` 在现有节点实例查询中加入版本模板和下载事件，返回：

```py
{
    "effectiveStartAt": config_node.get("startAt"),
    "effectiveDeadline": effective_deadline,
    "template": template_metadata_or_none,
    "templateDownloaded": bool(downloaded_at),
}
```

查询必须限制 `student_account_id`，并使用版本映射作为当前模板真值。

- [ ] **Step 2: 同步 TypeScript 类型**

```ts
export type RuntimeNodeTemplate = {
  assetId: string;
  contentType: string;
  originalName: string;
  sizeBytes: number;
};
```

将其接入 `RuntimeNodeInstance`，所有新时间和模板字段明确允许 `null`，不使用隐式 `undefined`。

### Task 9: 更新教师设计器与进度面板

**Files:**
- Modify: `frontend/src/features/academic-flow/api.ts`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Modify: `frontend/src/features/academic-flow/TeacherProgressPanel.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Adds: 教师模板 multipart 上传/删除客户端。
- Removes: `setGlobalDeadline` 及“节点统一截止时间”面板。
- Preserves: 个别学生延期、进度表和既有发布确认流程。

- [ ] **Step 1: 增加教师模板 API**

```ts
uploadNodeTemplate(flowId: string, nodeKey: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  return request<TemplateMutationResult>(
    `/api/workflows/${encodeURIComponent(flowId)}/nodes/${encodeURIComponent(nodeKey)}/template`,
    { method: "POST", body },
  );
}
```

增加对应删除方法和学生下载方法；移除 `setGlobalDeadline`。

- [ ] **Step 2: 严格锁定旧节点编辑器**

`AcademicFlowDesigner.updateNode` 不再删除旧节点 `deadlineAt`；改为按节点新旧状态筛选补丁。旧节点只接受 `requirement/startAt/deadlineAt`，位置拖拽、标题、类型、表单字段、文件限制、脚本和模板操作全部禁用。

- [ ] **Step 3: 增加厚重时间窗口卡**

用一个聚焦组件在节点检查器中渲染两个 `datetime-local` 输入，写回 ISO 字符串或 `null`。CSS 使用现有色板实现深灰蓝标题栏、2px 边框、强阴影、粗时间轴、状态标签及移动端纵向布局；不引入图片、图标库或新依赖。

- [ ] **Step 4: 增加模板资产卡**

仅文件节点显示。新节点允许选择、替换、删除；上传前先调用现有 `saveDraft`，成功后调用模板接口，并用返回元数据更新本地节点。旧节点只显示固化信息或“发布时未配置模板”，不渲染操作按钮。

- [ ] **Step 5: 移除统一截止时间入口**

删除 `TeacherProgressPanel` 的 `nodes/onDeadlineChange` 依赖、`saveGlobalDeadline` 和 `deadline-editor-list`，保留个别延期表单与学生进度表。同步清理 `AcademicFlowDesigner` 传参和不再使用的样式。

### Task 10: 更新学生运行时交互

**Files:**
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Produces: `scheduled` 倒计时和到点自动刷新；有模板文件节点先下载再上传。
- Preserves: 无模板节点现有上传区、审核驳回后的再次上传和已通过只读状态。

- [ ] **Step 1: 渲染定时开放状态**

将 `scheduled` 排除在可写状态之外，显示本地化开放时间和倒计时。用单个 `useEffect` 找出当前实例最近的未来 `effectiveStartAt`，设置一次定时器，到点调用现有实例刷新函数；依赖变化或卸载时清理定时器。

- [ ] **Step 2: 增加一键模板下载**

按钮点击后调用 POST 下载接口，成功取得 URL 后创建临时 `<a download>` 并触发下载，再刷新实例使 `templateDownloaded=true`。失败时显示错误且不解锁上传。

- [ ] **Step 3: 显示清晰的两步文件流程**

有模板时显示“1 下载填写模板”和“2 上传已填写文件”；第二步在 `templateDownloaded=false` 时禁用并解释原因。无模板节点继续显示当前单一上传工作区，不增加空步骤或占位卡。

### Task 11: 静态业务审计、清理、重启和提交

**Files:**
- Inspect: 本计划 File Map 中全部文件
- Preserve: `AGENTS.md`, `docs/05_oa_graph.md`, `.superpowers/`

**Interfaces:**
- Produces: 一个实现提交、本地已重启服务和用户手测清单。

- [ ] **Step 1: 审计后端信任边界和调用覆盖**

```bash
rg -n "assert_valid_revision|pending_node_status|template_download_events|flow_version_templates|TemplateMutationError|set_global_deadline" backend/app
```

Expected: 三个修订边界共用同一校验；所有待填写状态入口共用时间函数；统一截止时间写函数和路由已移除；模板上传/下载不暴露对象键。

- [ ] **Step 2: 审计前端锁定和 API 覆盖**

```bash
rg -n "startAt|templateAsset|templateDownloaded|scheduled|setGlobalDeadline|deadline-editor-list" frontend/src
```

Expected: 新字段从设计器贯穿运行时；旧统一截止入口无调用；旧节点不可操作锁定字段和模板。

- [ ] **Step 3: 检查差异范围和格式**

```bash
git diff --check
git diff --name-only
git status --short
```

Expected: 代码差异只在 File Map 中；用户已有脏文件保持原状且不进入暂存区。不运行测试、构建或浏览器。

- [ ] **Step 4: 清理开发缓存**

只定位并删除仓库内的 `__pycache__`、`.pytest_cache`、`*.egg-info`，不使用指向工作区根目录或用户目录的递归删除命令；删除前先输出精确目标。

- [ ] **Step 5: 本地重启后端和前端**

只读解析当前监听 `127.0.0.1:8000` 和 `127.0.0.1:5173` 的精确进程，向精确 PID 发送 `TERM`，再使用项目现有本地启动命令启动 FastAPI 和 Vite。确认端口重新监听；不调用 Docker、不运行构建。

- [ ] **Step 6: 精确暂存并提交实现**

逐个 `git add` File Map 中实际修改/新增的代码文件，执行：

```bash
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: add node revision windows and templates"
```

Expected: 提交不包含用户已有脏文件、设计文档之外的无关文档或缓存。

- [ ] **Step 7: 交付用户手测清单**

```text
1. 新建无模板文件节点可正常发布，学生可直接上传。
2. 新建有模板文件节点可上传、替换、删除模板；不符合扩展名或大小限制时拒绝。
3. 学生未下载模板时不能上传；点击“下载填写模板”后可以上传。
4. 审核驳回后无需重新下载；流程修订使节点失效后必须重新下载。
5. 前置节点未全部通过时节点锁定；全部通过但未到起始时间时显示倒计时；到点页面自动开放。
6. 已发布旧节点只能修改描述、起始时间和截止时间，其他字段、位置、模板和旧边均不能修改。
7. 修改任一允许字段后，该节点及所有可达下游节点重新完成，非下游节点状态保留。
8. “填写进度”不再有统一截止时间编辑，个别学生延期仍可使用。
9. 历史无模板节点修订时不能补传模板，历史提交和学生文件仍可查看。
10. 教师和学生只可访问各自所属 OA/名单/模板，接口响应不出现 OSS 对象键。
```

## Plan Self-Review

- Spec coverage: 修订白名单、DAG 结构约束、失效闭包、可空时间窗口、模板上传/冻结/下载、先下载后上传、历史兼容和个别延期均有实施任务。
- Trust boundaries: UI 禁用之外，草稿、影响预览、发布、模板上传、模板下载和学生上传均有后端校验。
- Data consistency: 模板资产不可变，发布版本用关系表冻结；下载事件绑定节点实例，天然满足修订失效和审核驳回两种不同生命周期。
- Runtime consistency: 时间状态由单个纯函数计算，读取和所有写入口均复用；截止优先于尚未开始，避免无效时间窗口产生可写状态。
- Compatibility: 历史缺失字段按空值处理；旧运行时统一截止时间先规范为首次修订基线，再停止产生新覆盖。
- Scope: 只新增一个模板仓储文件和三个必要数据表，不引入通用资产层、新依赖、在线预览或内容派生判断。
- UI: 复用现有 React/Vite 和样式体系；本需求是现有检查器的小范围增强，不需要生成视觉概念图。
- Verification policy: 遵循项目规则，不运行测试、构建或浏览器，只做静态审计、缓存清理、本地服务重启和用户手测。

## UI 修正补充：时间窗口卡片塌缩（2026-07-19）

### 现象与根因边界

- 现象：节点检查器中的起始时间和截止时间区域不可见，仅剩深色边框或阴影横线。
- 已确认：当前 Vite 服务已经加载对应 JSX 和 CSS，时间标题、标签及说明文本也存在于页面节点中，因此不是旧缓存、字段缺失或条件渲染错误。
- 布局原因：时间卡片位于 `fieldset` 滚动网格中，卡片本身只有 `overflow: hidden`，未声明稳定的内部网格行、最小块高度和子项收缩边界；网格项被压缩后，全部内容被裁剪。

### 最小修正范围

**Files:**

- Modify: `frontend/src/styles.css`
- Preserve: `AcademicFlowDesigner.tsx` 的 DOM、事件和时间转换逻辑。

- [ ] 为 `.node-time-window-card` 增加显式三行网格、`min-width: 0` 和足以承载三行内容的 `min-height`。
- [ ] 为 `.node-time-window-fields` 及两个时间 `label` 增加 `min-width: 0`，防止原生 `datetime-local` 的固有宽度撑出横向滚动。
- [ ] 保留现有桌面双列和移动端单列规则，不新增组件、依赖、JavaScript 测量或运行时状态。
- [ ] 只执行 `git diff --check`、差异范围审计、缓存清理和本地非 Docker 服务重启；按仓库规则不运行构建、自动化测试、Playwright 或浏览器操作。

### 用户手测验收

1. 打开任意节点设置，时间窗口卡片完整显示标题栏、状态徽标、两个时间输入和底部说明。
2. 未设置、仅设置起始时间、仅设置截止时间、同时设置两者时，卡片高度稳定且无内容裁剪。
3. 缩窄窗口后两个时间区纵向排列，不出现横向滚动条。
4. 选择和清除时间仍按原逻辑更新，文件限制和模板区域布局不受影响。
