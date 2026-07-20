# 教师端学生行级延期设置实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. If the user explicitly requests delegation, use at most one subagent for the whole plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将教师端个别延期入口移动到学生进度表行内，并确保只有未通过、已有截止时间的节点可以被严格延后。

**Architecture:** 扩展现有教师进度接口，使每名学生携带精简节点运行摘要；现有延期写入接口在事务内完成权限、状态和时间单调递增校验。前端只维护一个展开学生和一份延期草稿，复用现有 API，通过表格详情行完成编辑，不新增接口、数据表或依赖。

**Tech Stack:** FastAPI、Pydantic、SQLite、Python 3.12、React 18、TypeScript、Vite、原生 CSS。

## Global Constraints

- 当前分支实施，不创建 worktree。
- 设计检查点为 `0101062`；实施期间不创建中间提交，完成后只创建一个实现提交。
- 不新增数据库表、字段或 API 路径；继续复用 `student_deadline_overrides` 和现有 `PUT .../deadline` 接口。
- 个别延期只允许延长，不允许缩短、取消，或为无截止时间节点新增截止限制。
- 已通过节点不可延期；延期不改变 DAG、流程版本、节点内容、既有提交或下游节点状态。
- 前端校验只改善交互，后端事务内校验是最终可信边界。
- 不新增前端依赖、日期控件库、组件抽象或一次性工具文件。
- 不暂存或覆盖用户已有的 `AGENTS.md`、`docs/05_oa_graph.md` 和 `.superpowers/` 文件。
- 按仓库规则不运行自动化测试、构建、浏览器或 Playwright；仅做静态调用链与差异审计，由用户手测。
- 完成后清理仓库内 `__pycache__`、`.pytest_cache`、`*.egg-info`，使用本地进程重启前后端，不使用 Docker。

---

### Task 1: 扩展教师进度数据并收紧延期写入规则

**Files:**

- Modify: `backend/app/repositories/flow_instances.py:1-25`
- Modify: `backend/app/repositories/flow_instances.py:589-729`
- Modify: `backend/app/api/routes/workflow_admin.py:1-70`

**Interfaces:**

- Consumes: `flow_versions.config_snapshot`、`flow_node_runtime_configs`、`node_instances`、`student_deadline_overrides`。
- Produces: `StudentDeadlineValidationError`、每名学生的 `nodes` 摘要，以及只允许截止时间单调延后的 `set_student_deadline(...)`。

- [ ] **Step 1: 增加延期时间解析与业务错误类型**

在 `flow_instances.py` 顶部引入 UTC 时间，并在现有运行时错误类型旁增加专用错误：

```python
from datetime import UTC, datetime

from app.domain.workflow_runtime import (
    incoming_nodes,
    node_by_key,
    parse_datetime,
    pending_node_status,
    validate_submission,
)


class StudentDeadlineValidationError(ValueError):
    pass


def _parse_student_deadline(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError) as exc:
        raise StudentDeadlineValidationError("延期截止时间格式无效") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise StudentDeadlineValidationError("延期截止时间必须包含时区")
    return parsed.astimezone(UTC)
```

不修改共享 `parse_datetime` 对历史数据的兼容行为；严格含时区校验只作用于新的教师延期请求。

- [ ] **Step 2: 在事务内读取最新状态和两级截止时间**

将 `set_student_deadline` 的存在性查询扩展为：

```sql
SELECT i.id,
       i.flow_version_id,
       v.config_snapshot,
       n.status AS node_status,
       r.deadline_at AS global_deadline,
       o.deadline_at AS override_deadline
FROM flow_instances i
JOIN flow_versions v ON v.id = i.flow_version_id
JOIN flows f ON f.id = v.flow_id
JOIN node_instances n
  ON n.flow_instance_id = i.id AND n.node_key = ?
LEFT JOIN flow_node_runtime_configs r
  ON r.flow_version_id = i.flow_version_id AND r.node_key = n.node_key
LEFT JOIN student_deadline_overrides o
  ON o.flow_instance_id = i.id AND o.node_key = n.node_key
WHERE i.id = ? AND f.owner_id = ? AND v.status = 'published'
```

查询仍位于 `BEGIN IMMEDIATE` 之后，保证校验和覆盖写入基于同一写事务内的最新数据。无记录继续抛出 `KeyError(instance_id)`。

- [ ] **Step 3: 写入前执行严格单调延期校验**

在 `INSERT ... ON CONFLICT` 前加入以下等价逻辑：

```python
clean_reason = reason.strip()
if not clean_reason:
    raise StudentDeadlineValidationError("请填写延期原因")
if exists["node_status"] == "approved":
    raise StudentDeadlineValidationError("已通过节点不能延期")

current_deadline_value = exists["override_deadline"] or exists["global_deadline"]
if current_deadline_value is None:
    raise StudentDeadlineValidationError("无截止时间的节点不能设置延期")

new_deadline = _parse_student_deadline(deadline_at)
current_deadline = parse_datetime(current_deadline_value)
now_datetime = datetime.now(UTC)
if new_deadline <= now_datetime:
    raise StudentDeadlineValidationError("延期截止时间必须晚于当前时间")
if current_deadline is None or new_deadline <= current_deadline:
    raise StudentDeadlineValidationError("延期截止时间必须晚于当前生效截止时间")

normalized_deadline = new_deadline.isoformat()
```

后续数据库覆盖写入、状态重算和审计日志统一使用 `normalized_deadline` 与 `clean_reason`。保留现有仅对 `expired`、`scheduled`、`locked`、`available`、`draft` 状态重算的范围，继续通过 `pending_node_status` 同时检查起始时间和全部前置节点。

- [ ] **Step 4: 为进度结果增加精简节点摘要**

在 `get_version_progress` 的数据库连接关闭前：

1. 从 `version["config_snapshot"]` 解析节点标题映射；
2. 一次查询该版本全部学生节点及两级截止时间；
3. 按 `flow_instance_id` 分组；
4. 在每个学生对象中写入 `nodes`。

节点查询使用：

```sql
SELECT n.flow_instance_id,
       n.node_key,
       n.status,
       r.deadline_at AS global_deadline,
       o.deadline_at AS override_deadline
FROM node_instances n
JOIN flow_instances i ON i.id = n.flow_instance_id
LEFT JOIN flow_node_runtime_configs r
  ON r.flow_version_id = i.flow_version_id AND r.node_key = n.node_key
LEFT JOIN student_deadline_overrides o
  ON o.flow_instance_id = i.id AND o.node_key = n.node_key
WHERE i.flow_version_id = ?
ORDER BY n.flow_instance_id, n.rowid
```

每个节点映射为：

```python
{
    "nodeKey": row["node_key"],
    "title": node_titles.get(row["node_key"], row["node_key"]),
    "status": row["status"],
    "globalDeadline": row["global_deadline"],
    "overrideDeadline": row["override_deadline"],
    "effectiveDeadline": row["override_deadline"] or row["global_deadline"],
}
```

避免按学生逐条查询，不调用学生身份接口，也不返回草稿或提交内容。

- [ ] **Step 5: 将业务错误映射为 422**

在 `workflow_admin.py` 导入 `StudentDeadlineValidationError`，并在 `put_student_deadline` 中保留 404 后增加：

```python
    except StudentDeadlineValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
```

`DeadlineRequest.reason` 继续保留 Pydantic 的 1–500 字符边界；仓储层补充去除空白后的非空校验。

### Task 2: 定义前端进度类型与行内延期状态

**Files:**

- Modify: `frontend/src/features/academic-flow/runtimeTypes.ts:75-105`
- Modify: `frontend/src/features/academic-flow/TeacherProgressPanel.tsx:1-50`

**Interfaces:**

- Consumes: Task 1 返回的学生 `nodes` 摘要。
- Produces: `WorkflowProgressNode`、单一展开学生状态、严格本地时间下限和保存状态。

- [ ] **Step 1: 增加节点摘要类型**

在 `runtimeTypes.ts` 中增加：

```ts
export type WorkflowProgressNode = {
  effectiveDeadline: string | null;
  globalDeadline: string | null;
  nodeKey: string;
  overrideDeadline: string | null;
  status: RuntimeNodeStatus;
  title: string;
};
```

并在 `WorkflowProgressStudent` 中增加：

```ts
nodes: WorkflowProgressNode[];
```

- [ ] **Step 2: 将表单状态改为行级单选展开**

在 `TeacherProgressPanel.tsx` 中引入 `Fragment` 和节点摘要类型，状态调整为：

```tsx
const [expandedInstanceId, setExpandedInstanceId] = useState<string | null>(null);
const [savingExtension, setSavingExtension] = useState(false);
const [extension, setExtension] = useState({
  deadline: "",
  nodeKey: "",
  reason: "批准个别延期",
});
```

删除顶部学生选择所需的 `extension.instanceId`，保存时显式接收当前学生实例 ID。

- [ ] **Step 3: 增加原生日期时间转换和最小值计算**

在组件外增加两个局部工具函数，不创建新文件：

```ts
function toLocalDateTimeInput(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function minimumExtensionValue(effectiveDeadline: string) {
  const floor = Math.max(Date.now(), new Date(effectiveDeadline).getTime());
  const nextMinute = Math.floor(floor / 60_000) * 60_000 + 60_000;
  return toLocalDateTimeInput(nextMinute);
}
```

最小值取当前时间和当前生效截止时间中更晚者的下一个整分钟，满足“严格晚于”。

- [ ] **Step 4: 实现展开、节点筛选与选择重置**

可延期节点筛选固定为：

```ts
const eligibleNodes = student.nodes.filter(
  (node) => node.status !== "approved" && node.effectiveDeadline,
);
```

点击行按钮时：

- 当前行已展开则收起并清空草稿；
- 其他行则切换到该实例，默认选择第一个可延期节点；
- 每次切换学生时重置新截止时间和默认原因，不能沿用上一名学生的输入。

切换节点时清空 `deadline`，并按新节点重新计算 `min` 和当前截止时间展示。

- [ ] **Step 5: 收紧前端保存流程**

把保存函数改为 `saveExtension(instanceId, currentNode)`，依次校验：节点存在、截止时间已填写、原因去除空白后非空、新时间晚于当前生效截止时间及浏览器当前时间。保存调用保持：

```ts
await workflowApi.setStudentDeadline(
  instanceId,
  currentNode.nodeKey,
  new Date(extension.deadline).toISOString(),
  extension.reason.trim(),
);
```

调用前设置 `savingExtension=true`，`finally` 恢复。写入成功后先显示成功提示并收起表单，再等待 `workflowApi.getProgress(versionId)` 刷新；刷新失败时显示“延期已保存，但进度刷新失败：<错误>”，不能把已经成功的写入误报为失败。

### Task 3: 将延期编辑器移入学生表格行

**Files:**

- Modify: `frontend/src/features/academic-flow/TeacherProgressPanel.tsx:55-105`

**Interfaces:**

- Consumes: Task 2 的 `expandedInstanceId`、`eligibleNodes`、`currentNode`、`savingExtension`。
- Produces: 六列表格、行级操作按钮和可访问的行内延期表单。

- [ ] **Step 1: 删除顶部延期编辑器并增加操作列**

完全删除 `.student-extension-editor` 对应的顶部 `<section>`。表头改为：

```tsx
<tr>
  <th>学生</th>
  <th>状态</th>
  <th>完成</th>
  <th>逾期</th>
  <th>最后活动</th>
  <th>操作</th>
</tr>
```

空数据行的 `colSpan` 从 5 改为 6。

- [ ] **Step 2: 为每名学生增加展开按钮和详情行**

使用带 `key={student.instanceId}` 的 `Fragment` 包裹主行和可选详情行。主行操作单元格增加：

```tsx
<button
  aria-expanded={expandedInstanceId === student.instanceId}
  className="progress-extension-trigger"
  onClick={() => toggleExtension(student)}
  type="button"
>
  {expandedInstanceId === student.instanceId ? "收起" : "设置延期"}
</button>
```

展开时紧随主行渲染：

```tsx
<tr className="student-extension-row">
  <td colSpan={6}>
    <section className="student-extension-card" aria-label={`${student.name}的延期设置`}>
      {/* 固定学生信息、表单或空状态 */}
    </section>
  </td>
</tr>
```

- [ ] **Step 3: 渲染固定学生信息和无节点状态**

卡片标题区域显示“个别节点延期”、学生姓名和学号。若 `eligibleNodes.length === 0`，只显示：

```tsx
<p className="student-extension-empty">该学生当前没有可延期节点</p>
```

不显示节点选择、新截止时间或保存按钮；保留“取消”用于收起。

- [ ] **Step 4: 渲染延期字段与操作**

有可延期节点时渲染带显式 `<label>` 的字段：节点 `<select>`、当前生效截止时间 `<output>`、新截止时间 `<input type="datetime-local">`、延期原因 `<input maxLength={500}>`。时间输入必须设置：

```tsx
min={minimumExtensionValue(currentNode.effectiveDeadline!)}
```

“保存延期”按钮在 `savingExtension` 时禁用并显示“保存中…”，“取消”按钮只收起并清空当前草稿。所有按钮显式使用 `type="button"`。

### Task 4: 设计行级延期区域样式

**Files:**

- Modify: `frontend/src/styles.css:4320-4360`
- Modify: `frontend/src/styles.css:4485`

**Interfaces:**

- Consumes: `.progress-extension-trigger`、`.student-extension-row`、`.student-extension-card`、`.student-extension-fields`、`.student-extension-actions`。
- Produces: 与表格相连、层次清晰、桌面双列和窄屏单列的延期区域。

- [ ] **Step 1: 删除废弃顶部编辑器样式**

从组合规则和窄屏媒体查询中移除 `.student-extension-editor`，保留 `.progress-table-wrap` 自身的分隔线、间距和表格横向滚动能力。

- [ ] **Step 2: 设计操作按钮与详情行容器**

增加：

```css
.progress-extension-trigger {
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid #84adff;
  border-radius: 6px;
  background: #eff6ff;
  color: #175cd3;
  font-weight: 700;
  white-space: nowrap;
}

.student-extension-row > td {
  padding: 0 8px 14px;
  background: #f8fafc;
}

.student-extension-card {
  padding: 16px;
  border: 1px solid #b2ccff;
  border-radius: 8px;
  background: #f5f8ff;
}
```

按钮保持文字入口，不增加图标、弹窗或动画。

- [ ] **Step 3: 设计字段、当前时间和操作区**

增加两列字段网格和统一标签：

```css
.student-extension-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}

.student-extension-field {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.student-extension-field > span {
  color: #344054;
  font-size: 13px;
  font-weight: 700;
}

.student-extension-deadline {
  min-height: 40px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  border: 1px solid #d0d5dd;
  border-radius: 6px;
  background: #fff;
}

.student-extension-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}
```

复用现有 `primary-action` 作为保存按钮；取消按钮使用边框次级样式。补充禁用态与 `:focus-visible`，保证键盘焦点清晰。

- [ ] **Step 4: 增加窄屏单列布局**

在现有 `@media (max-width: 760px)` 中加入：

```css
.student-extension-fields {
  grid-template-columns: 1fr;
}

.student-extension-actions {
  align-items: stretch;
  flex-direction: column-reverse;
}
```

不隐藏表格列，继续由 `.progress-table-wrap` 提供横向滚动。

### Task 5: 静态审计、缓存清理、本地重启和单次提交

**Files:**

- Inspect: Task 1–4 的五个生产代码文件
- Preserve: `AGENTS.md`、`docs/05_oa_graph.md`、`.superpowers/`

**Interfaces:**

- Produces: 一个实现提交、已清理缓存、已重启的本地前后端和用户手测清单。

- [ ] **Step 1: 审计延期规则只有一个可信写入入口**

运行只读搜索：

```bash
rg -n "set_student_deadline|StudentDeadlineValidationError|current_deadline|normalized_deadline" backend/app
rg -n "setStudentDeadline|expandedInstanceId|eligibleNodes|effectiveDeadline|student-extension" frontend/src
```

确认所有教师个别延期仍经过同一个仓储函数；前端筛选与后端规则一致；不存在第二套延期写入或无截止时间兜底。

- [ ] **Step 2: 检查差异范围和格式**

运行：

```bash
git diff --check -- backend/app/repositories/flow_instances.py backend/app/api/routes/workflow_admin.py frontend/src/features/academic-flow/runtimeTypes.ts frontend/src/features/academic-flow/TeacherProgressPanel.tsx frontend/src/styles.css
git diff --stat -- backend/app/repositories/flow_instances.py backend/app/api/routes/workflow_admin.py frontend/src/features/academic-flow/runtimeTypes.ts frontend/src/features/academic-flow/TeacherProgressPanel.tsx frontend/src/styles.css
git status --short
```

预期：本次生产代码差异仅为上述五个文件；用户已有文件保持未暂存。不运行测试、构建或浏览器。

- [ ] **Step 3: 静态核对关键边界**

逐项阅读差异确认：

1. 404 权限边界先于业务详情暴露；
2. 后端拒绝已通过、无截止时间、过去时间、相等时间和缩短时间；
3. 数据库存储规范化 UTC 时间和去空白原因；
4. 进度接口不返回草稿、提交载荷或其他敏感数据；
5. 写入成功但刷新失败不会误报写入失败；
6. 行切换会清空上一名学生输入；
7. 空列表 `colSpan` 为 6；
8. 起始时间和 DAG 前置条件仍由 `pending_node_status` 决定。

- [ ] **Step 4: 检查并清理开发缓存**

先列出仓库内精确缓存目录：

```bash
find . -type d \( -name __pycache__ -o -name .pytest_cache -o -name '*.egg-info' \) -prune -print
```

仅删除该命令实际列出的仓库内目录；没有输出时不执行删除，不删除依赖目录或用户文件。

- [ ] **Step 5: 本地重启服务**

使用 `lsof` 分别解析 `127.0.0.1:8000` 和 `127.0.0.1:5173` 的精确监听 PID，向精确 PID 发送 `TERM`，再分别运行：

```bash
cd backend
.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

```bash
cd frontend
npm run dev -- --host 127.0.0.1
```

再次使用 `lsof` 确认两个端口监听。不得调用 Docker，也不启动浏览器。

- [ ] **Step 6: 精确提交实现**

只暂存五个生产代码文件并检查：

```bash
git add backend/app/repositories/flow_instances.py backend/app/api/routes/workflow_admin.py frontend/src/features/academic-flow/runtimeTypes.ts frontend/src/features/academic-flow/TeacherProgressPanel.tsx frontend/src/styles.css
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: add student row deadline extensions"
```

预期：提交只包含上述五个文件，不包含用户工作区文件、设计文档或计划文档。

- [ ] **Step 7: 交付用户手测清单**

1. 每名学生行都有“设置延期”，且同一时间只展开一行。
2. 展开区域固定显示当前学生，切换学生不会保留上一人的输入。
3. 节点列表只包含尚未通过且已有截止时间的节点。
4. 当前生效截止时间清晰显示，新截止时间只能选择更晚时间。
5. 已有个别延期可以继续延长，但不能改早或取消。
6. 已通过节点、无截止时间节点和非法直接请求均被拒绝并显示中文原因。
7. 已过期节点延期后，只有同时满足起始时间和 DAG 前置条件才开放。
8. 保存成功后表单收起并刷新；刷新失败明确提示“延期已保存”。
9. 无可延期节点时显示空状态且没有保存按钮。
10. 桌面与窄屏下字段、按钮和表格无挤压或错位。

## Plan Self-Review

- Spec coverage: 行级入口、单行展开、节点摘要、单调延期、并发校验、状态重算、反馈和空状态均有明确任务。
- Scope: 只修改现有五个生产代码文件；不新增数据表、接口、依赖、组件文件或测试文件。
- Type consistency: 后端节点字段与 `WorkflowProgressNode` 完全一致；前端保存继续使用既有 `setStudentDeadline` 签名。
- Security: 先验证教师所有权和已发布版本，再返回 404 或执行业务校验；进度摘要不包含学生提交内容。
- Verification policy: 按项目规则不运行测试、构建或浏览器，只做静态审计、缓存清理、本地服务重启并交由用户手测。
