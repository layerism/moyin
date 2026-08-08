# 已通过表单无限补正实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许学生在截止时间前无限次修改并重新提交已通过表单，同时保留历史提交、原通过状态和下游进度，并继续锁定非表单节点。

**Architecture:** 后端把“已通过表单补正”作为现有提交事务的受控特例：暂存只写 `node_drafts`，重新提交新增下一次 `submissions` 快照并保持节点通过。前端以独立的本地补正编辑状态切换只读内容与表单编辑器，不向运行时状态枚举增加新状态。

**Tech Stack:** FastAPI、SQLite、Python、React 18、TypeScript

## Global Constraints

- 仅 `kind === "form"` 且当前状态为 `approved` 的节点允许补正。
- 补正次数不限，但必须在当前生效截止时间前，且所有前置节点仍为 `approved`。
- 教师可为已通过表单设置个别延期；已通过非表单仍禁止延期。
- 暂存补正草稿不撤销旧通过状态，不回退流程完成状态或下游节点。
- 重新提交新增提交批次并立即通过；旧提交记录不可修改或删除。
- 文件上传、确认承诺、通知公告等非表单节点通过后继续锁定。
- 不新增数据库表、迁移、运行时状态或依赖。
- 不运行自动化测试、构建或浏览器测试；只更新测试代码并进行静态审计。

---

### Task 1: 接通已通过表单的后端补正与前端编辑流程

**Files:**
- Modify: `backend/app/repositories/flow_instances.py:360-590`
- Modify: `backend/tests/test_flow_runtime.py:70-135`
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx:25-560`
- Modify: `frontend/src/features/academic-flow/StudentFlowTopology.tsx:170-220`
- Modify: `frontend/src/features/academic-flow/TeacherProgressPanel.tsx:20-145`

**Interfaces:**
- Consumes: `RuntimeNodeInstance.status`、`draft`、`submission`、`effectiveDeadline`，以及发布快照中的节点 `kind`。
- Produces: 已通过表单可暂存补正草稿和创建下一提交批次；前端提供“修改内容”“重新提交”；非表单写入契约不变。

- [x] **Step 1: 增加后端行为测试**

在 `backend/tests/test_flow_runtime.py` 导入数据库连接：

```python
from app.core.database import get_connection
```

增加测试，覆盖旧提交有效、补正草稿不回退状态、第二次提交形成新批次和非表单继续锁定：

```python
def test_approved_form_can_be_amended_without_relocking_downstream(
    client: TestClient,
) -> None:
    published = publish_flow(client)
    register(client, "20260011", "学生甲")
    instance = client.post(f"/api/student/shared/{published['token']}/enter").json()
    form = instance["nodeInstances"][0]

    first = client.post(
        f"/api/student/node-instances/{form['id']}/submit",
        json={"payload": {"姓名": "旧姓名"}, "idempotencyKey": "form-attempt-1"},
    )
    assert first.status_code == 200

    saved = client.put(
        f"/api/student/node-instances/{form['id']}/draft",
        json={"payload": {"姓名": "新姓名"}},
    )
    assert saved.status_code == 200
    saved_form = saved.json()["nodeInstances"][0]
    assert saved_form["status"] == "approved"
    assert saved_form["submission"] == {"姓名": "旧姓名"}
    assert saved_form["draft"] == {"姓名": "新姓名"}
    assert saved.json()["nodeInstances"][1]["status"] == "available"

    amended = client.post(
        f"/api/student/node-instances/{form['id']}/submit",
        json={"payload": {"姓名": "新姓名"}, "idempotencyKey": "form-attempt-2"},
    )
    assert amended.status_code == 200
    amended_form = amended.json()["nodeInstances"][0]
    assert amended_form["status"] == "approved"
    assert amended_form["attemptNo"] == 2
    assert amended_form["submission"] == {"姓名": "新姓名"}
    assert amended_form["draft"] == {}
    assert amended.json()["nodeInstances"][1]["status"] == "available"

    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT attempt_no, payload_snapshot, status
            FROM submissions WHERE node_instance_id = ? ORDER BY attempt_no
            """,
            (form["id"],),
        ).fetchall()
    assert [(row["attempt_no"], row["status"]) for row in rows] == [
        (1, "approved"),
        (2, "approved"),
    ]
```

再增加非表单锁定与截止时间测试：先提交根表单和确认节点使确认节点通过，随后对确认节点调用 draft/submit 均断言 `409`，对已通过确认节点设置延期断言 `422`。另一个流程在表单首次通过后直接把该节点的 `flow_node_runtime_configs.deadline_at` 更新为过去时间，对表单 draft 断言 `409`、submit 断言 `422`；教师为该已通过表单设置未来的个别延期后断言 `200`，随后表单 draft 恢复为 `200` 且节点仍为 `approved`。

按项目约定只写测试，不执行测试命令。

- [x] **Step 2: 实现后端已通过表单判定**

在 `flow_instances.py` 增加共享谓词：

```python
def _is_approved_form_amendment(status: str, node: dict[str, Any]) -> bool:
    return status == "approved" and node.get("kind") == "form"
```

在 `save_node_draft` 已取得 `node` 后计算：

```python
approved_form_amendment = _is_approved_form_amendment(row["status"], node)
```

将可暂存状态校验改为同时允许该特例；`base_status != "available"` 时仍拒绝。写入 `node_drafts` 后，仅普通节点执行：

```python
if not approved_form_amendment:
    connection.execute(
        "UPDATE node_instances SET status = 'draft' WHERE id = ?",
        (node_instance_id,),
    )
```

因此补正暂存不会改变 `approved_at`、实例状态或下游状态。

- [x] **Step 3: 实现后端补正重新提交**

在 `submit_node` 中提前取得 `node` 并计算同一谓词：

```python
node = node_by_key(config, row["node_key"])
approved_form_amendment = _is_approved_form_amendment(row["status"], node)
```

保留现有截止时间检查，把节点状态校验扩展为允许该特例。删除后续重复的 `node = node_by_key(...)`。

将提交状态计算改为：

```python
submission_status = (
    "approved"
    if approved_form_amendment
    else "reviewing"
    if has_audit_script
    else "approved"
    if node.get("autoApprove", True)
    else "reviewing"
)
```

沿用现有 `attempt_no + 1`、`INSERT submissions`、删除草稿和更新节点事务。补正提交保持 `approved`，所以 `complete_flow_if_ready` 与下游节点状态不发生回退。

在 `set_student_deadline` 中使用已经查询到的 `config_snapshot` 读取目标节点，将原有“所有已通过节点不能延期”改为：

```python
config = json.loads(exists["config_snapshot"])
node = node_by_key(config, node_key)
if exists["node_status"] == "approved" and node.get("kind") != "form":
    raise StudentDeadlineValidationError("已通过的非表单节点不能延期")
```

已通过表单延期后不改写节点状态；后续补正请求通过新的生效截止时间校验。

- [x] **Step 4: 增加前端补正编辑状态**

在 `StudentRuntimePage` 增加：

```ts
const [amendingNodeId, setAmendingNodeId] = useState<string | null>(null);
```

增加补正入口：

```ts
const beginFormAmendment = (runtime: RuntimeNodeInstance) => {
  const initialDraft = Object.keys(runtime.draft).length > 0
    ? runtime.draft
    : runtime.submission;
  setDrafts((current) => ({
    ...current,
    [runtime.id]: structuredClone(initialDraft),
  }));
  setAmendingNodeId(runtime.id);
};
```

向 `RuntimeNodeDialog` 传入：

```tsx
amendingApprovedForm={amendingNodeId === activeRuntime.id}
onBeginFormAmendment={() => beginFormAmendment(activeRuntime)}
```

关闭弹窗和补正提交成功时清除 `amendingNodeId`。`save()` 对已通过表单成功时提示“修改内容已暂存，原通过内容仍然有效”；`submit()` 在调用前记录 `runtime.status === "approved"`，成功后提示“表单修改已提交并通过”。

- [x] **Step 5: 在节点弹窗中切换只读与表单编辑**

扩展 `RuntimeNodeDialog` 属性：

```ts
amendingApprovedForm: boolean;
onBeginFormAmendment: () => void;
```

派生状态：

```ts
const approvedForm = runtime.status === "approved" && node.kind === "form";
const deadlinePassed = Boolean(
  runtime.effectiveDeadline
    && new Date(runtime.effectiveDeadline).getTime() <= clock,
);
const canAmendApprovedForm = approvedForm && !deadlinePassed;
const writable = writableStatuses.has(runtime.status) || (
  approvedForm && amendingApprovedForm
);
const readonly = runtime.status === "approved" && !amendingApprovedForm;
```

当已通过表单处于只读分支时，在 `ReadonlySubmission` 下方显示：

```tsx
{canAmendApprovedForm ? (
  <div className="runtime-node-actions">
    <span />
    <button className="primary-action" onClick={onBeginFormAmendment} type="button">
      {Object.keys(runtime.draft).length > 0 ? "继续修改" : "修改内容"}
    </button>
  </div>
) : approvedForm ? (
  <p className="runtime-state-hint">节点已截止，如需修改请联系教师延期。</p>
) : null}
```

编辑分支继续复用 `RuntimeFormFields`。将操作按钮文案按 `amendingApprovedForm` 切换为“暂存修改”和“重新提交”；文件、确认、公告不会进入补正编辑分支。

让现有 `clock` 定时器同时覆盖带截止时间的已通过表单，确保弹窗停留期间到期后修改入口及时失效。

- [x] **Step 6: 更新拓扑状态文案**

在 `StudentFlowTopology` 调用状态文案函数时传入节点类型：

```tsx
<i>{getTopologyStatusLabel(runtime.status, node.kind)}</i>
```

并把函数改为：

```ts
function getTopologyStatusLabel(
  status: RuntimeNodeStatus,
  kind: AcademicFlowNode["kind"],
): string {
  if (status === "approved") {
    return kind === "form" ? "✓ 已完成 · 可修改" : "✓ 已完成 · 可查看";
  }
  // 保留其余现有状态映射
}
```

- [x] **Step 7: 打通已通过表单的教师延期入口**

在 `TeacherProgressPanel` 中使用发布节点的 `kind` 区分已通过节点。未通过节点继续按原规则进入延期候选；已通过节点仅当 `kind === "form"` 且存在当前生效截止时间时允许延期。已通过文件、确认、公告节点不显示在延期候选中。

- [x] **Step 8: 审计安全和数据边界**

运行：

```bash
git diff --check -- backend/app/repositories/flow_instances.py backend/tests/test_flow_runtime.py frontend/src/features/academic-flow/StudentRuntimePage.tsx frontend/src/features/academic-flow/StudentFlowTopology.tsx frontend/src/features/academic-flow/TeacherProgressPanel.tsx
git diff -- backend/app/repositories/flow_instances.py backend/tests/test_flow_runtime.py frontend/src/features/academic-flow/StudentRuntimePage.tsx frontend/src/features/academic-flow/StudentFlowTopology.tsx frontend/src/features/academic-flow/TeacherProgressPanel.tsx
rg -n "approved_form_amendment|amendingApprovedForm|修改内容|重新提交|可修改|node_drafts|attempt_no" backend/app/repositories/flow_instances.py backend/tests/test_flow_runtime.py frontend/src/features/academic-flow
```

确认：后端类型判定存在；非表单仍不在可写状态集合；补正暂存不更新节点状态；补正提交仍新增 `submissions`；仅已通过表单可延期；前端只对 `form + approved` 显示修改入口；没有数据库 schema、后端路由或依赖差异。

- [x] **Step 9: 清理、提交并重启**

检查源码缓存并排除依赖目录：

```bash
find backend frontend \( -path 'backend/.venv' -o -path 'frontend/node_modules' \) -prune -o -type d \( -name '__pycache__' -o -name '.pytest_cache' -o -name '*.egg-info' \) -print
```

逐项确认后仅删除列出的源码缓存。然后提交指定文件：

```bash
git add backend/app/repositories/flow_instances.py backend/tests/test_flow_runtime.py frontend/src/features/academic-flow/StudentRuntimePage.tsx frontend/src/features/academic-flow/StudentFlowTopology.tsx frontend/src/features/academic-flow/TeacherProgressPanel.tsx docs/superpowers/plans/2026-08-08-approved-form-amendments.md
git commit -m "feat: allow approved form amendments"
```

停止当前 FastAPI 与 Vite 开发进程，按本地方式重新启动并仅检查健康端点。界面和数据库行为交由用户手动验证。
