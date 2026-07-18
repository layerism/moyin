# 名单隔离的学生 OA 流程访问实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for inline implementation. If the user explicitly requests delegation, use at most one subagent for the whole implementation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让学生登录后直接看到全部包含自己的已发布 OA，并保证名单外 OA 不可见、不可进入。

**Architecture:** 保留现有数据库结构、DAG 修订和运行实例模型。后端新增“以有效名单为起点”的流程列表，并让分享令牌入口和 `flowId` 入口复用同一个实例创建函数；前端始终按逻辑 `flowId` 请求进入，再跳转到返回的实例。

**Tech Stack:** FastAPI、SQLite、Python 3.11、React、TypeScript、Vite。

## Global Constraints

- 在当前分支实施，不创建 worktree。
- 实现前创建独立 Git 检查点；全部完成后创建一个实现提交，中间不提交。
- 不暂存用户已有的 `AGENTS.md`、`docs/05_oa_graph.md` 和 `.superpowers/` 文件。
- 不运行自动化测试、构建、浏览器或 Playwright；只做静态业务审计并交由用户手测。
- 不修改数据库、DAG 修订、重新发布迁移、历史提交或审核任务。
- 不批量预创建学生实例，只在学生首次进入时创建。
- 实现后重启现有服务，并只清理本次产生的缓存。

## File Map

- `backend/app/repositories/flow_instances.py`：名单驱动列表、按 `flowId` 进入、复用实例创建。
- `backend/app/api/routes/student_flows.py`：新增学生流程列表和进入路由。
- `frontend/src/features/auth/authApi.ts`：流程摘要类型和列表路径。
- `frontend/src/features/academic-flow/api.ts`：按 `flowId` 进入接口。
- `frontend/src/features/auth/StudentAccountPage.tsx`：待开始状态和进入反馈。
- `frontend/src/App.tsx`：进入成功后的实例跳转。

---

### Task 1: 创建实现检查点并锁定范围

**Files:**
- Inspect: `AGENTS.md`
- Inspect: `docs/superpowers/specs/2026-07-18-roster-scoped-student-flow-access-design.md`

**Interfaces:**
- Consumes: 已提交设计 `4b91233`。
- Produces: 不包含用户未提交文件的实现前检查点。

- [ ] **Step 1: 核对工作树**

```bash
git branch --show-current
git log -3 --oneline
git status --short
```

Expected: 分支为 `codex/oa-workflow-v1`；用户已有未提交文件保持可识别。

- [ ] **Step 2: 创建空检查点**

```bash
git commit --allow-empty -m "chore: checkpoint before roster-scoped student flows"
```

Expected: 新增空提交，不暂存任何现有文件。

- [ ] **Step 3: 记录唯一允许修改的六个文件**

```text
backend/app/repositories/flow_instances.py
backend/app/api/routes/student_flows.py
frontend/src/features/auth/authApi.ts
frontend/src/features/academic-flow/api.ts
frontend/src/features/auth/StudentAccountPage.tsx
frontend/src/App.tsx
```

### Task 2: 实现名单驱动的仓储逻辑

**Files:**
- Modify: `backend/app/repositories/flow_instances.py:48-111`
- Modify: `backend/app/repositories/flow_instances.py:190-217`

**Interfaces:**
- Consumes: `assert_student_roster_access`、`incoming_nodes`、`effective_deadline`、`get_instance`。
- Produces:
  - `_get_or_create_version_instance(connection, version_id, flow_id, config, student_id, now) -> str`
  - `enter_flow(flow_id: str, student_id: int) -> dict[str, object]`
  - `list_student_flows(student_id: int) -> list[dict[str, object]]`
- Preserves: `get_or_create_instance(token, student_id)` 的外部行为。

- [ ] **Step 1: 抽取单一实例创建函数**

将现有 `get_or_create_instance` 中名单校验、实例查询、节点初始化和最近访问时间更新移动到：

```python
def _get_or_create_version_instance(
    connection,
    version_id: str,
    flow_id: str,
    config: dict[str, Any],
    student_id: int,
    now: str,
) -> str:
    assert_student_roster_access(connection, flow_id, student_id)
    row = connection.execute(
        "SELECT id FROM flow_instances "
        "WHERE flow_version_id = ? AND student_account_id = ?",
        (version_id, student_id),
    ).fetchone()
    if row is not None:
        instance_id = str(row["id"])
        connection.execute(
            "UPDATE flow_instances SET last_active_at = ? WHERE id = ?",
            (now, instance_id),
        )
        return instance_id

    instance_id = str(uuid.uuid4())
    connection.execute(
        """
        INSERT INTO flow_instances
            (id, flow_version_id, student_account_id, started_at, last_active_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (instance_id, version_id, student_id, now, now),
    )
    predecessors = incoming_nodes(config)
    for node in config["nodes"]:
        node_key = node["id"]
        node_status = "available" if not predecessors[node_key] else "locked"
        deadline = effective_deadline(connection, instance_id, version_id, node_key)
        if node_status == "available" and deadline_has_passed(deadline):
            node_status = "expired"
        connection.execute(
            """
            INSERT INTO node_instances
                (id, flow_instance_id, node_key, status, opened_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (str(uuid.uuid4()), instance_id, node_key, node_status,
             now if node_status == "available" else None),
        )
    return instance_id
```

- [ ] **Step 2: 让分享链接入口调用公共函数**

保留现有令牌查询；查询成功后改为：

```python
instance_id = _get_or_create_version_instance(
    connection,
    str(shared["version_id"]),
    str(shared["flow_id"]),
    json.loads(shared["config_snapshot"]),
    student_id,
    now,
)
```

事务结束后继续 `return get_instance(instance_id, student_id)`。

- [ ] **Step 3: 新增按逻辑流程进入函数**

```python
def enter_flow(flow_id: str, student_id: int) -> dict[str, object]:
    now = utc_now_iso()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        version = connection.execute(
            """
            SELECT v.id AS version_id, v.config_snapshot
            FROM flows f
            JOIN flow_versions v ON v.flow_id = f.id
            WHERE f.id = ? AND f.status = 'published'
              AND v.status = 'published'
            ORDER BY v.version_no DESC LIMIT 1
            """,
            (flow_id,),
        ).fetchone()
        if version is None:
            raise KeyError(flow_id)
        instance_id = _get_or_create_version_instance(
            connection,
            str(version["version_id"]),
            flow_id,
            json.loads(version["config_snapshot"]),
            student_id,
            now,
        )
    return get_instance(instance_id, student_id)
```

- [ ] **Step 4: 新增名单驱动的流程列表**

保留旧 `list_student_instances`，另增：

```python
def list_student_flows(student_id: int) -> list[dict[str, object]]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT f.id AS flow_id, f.name,
                   i.id AS instance_id, i.status AS instance_status,
                   i.last_active_at
            FROM student_accounts a
            JOIN flow_roster_entries r
              ON r.student_no = a.student_no
             AND r.name = a.name
             AND r.status = 'active'
            JOIN flows f ON f.id = r.flow_id AND f.status = 'published'
            JOIN flow_versions v
              ON v.flow_id = f.id AND v.status = 'published'
             AND v.version_no = (
                 SELECT MAX(latest.version_no)
                 FROM flow_versions latest
                 WHERE latest.flow_id = f.id AND latest.status = 'published'
             )
            LEFT JOIN flow_instances i
              ON i.flow_version_id = v.id
             AND i.student_account_id = a.id
            WHERE a.id = ? AND a.status = 'active'
            ORDER BY CASE WHEN i.last_active_at IS NULL THEN 1 ELSE 0 END,
                     COALESCE(i.last_active_at, f.updated_at) DESC, f.id
            """,
            (student_id,),
        ).fetchall()
    return [
        {
            "flowId": row["flow_id"],
            "instanceId": row["instance_id"],
            "name": row["name"],
            "status": row["instance_status"] or "not_started",
            "lastActiveAt": row["last_active_at"],
        }
        for row in rows
    ]
```

- [ ] **Step 5: 静态审计仓储边界**

确认列表从当前账号和 `active` 名单出发，只连接已发布 OA；两个进入入口都调用 `_get_or_create_version_instance`；实例详情和所有写接口的原名单校验未改变。

### Task 3: 暴露学生逻辑流程接口

**Files:**
- Modify: `backend/app/api/routes/student_flows.py:18-29`
- Modify: `backend/app/api/routes/student_flows.py:147-175`

**Interfaces:**
- Consumes: Task 2 的 `enter_flow`、`list_student_flows`。
- Produces: `GET /api/student/flows`、`POST /api/student/flows/{flow_id}/enter`。
- Preserves: 旧 `/flow-instances` 与全部节点运行接口。

- [ ] **Step 1: 导入仓储函数**

```python
enter_flow,
list_student_flows,
```

- [ ] **Step 2: 增加两个路由**

```python
@router.get("/flows")
def student_flows(
    student: dict[str, object] = Depends(get_current_student),
) -> list[dict[str, object]]:
    return list_student_flows(int(student["id"]))


@router.post("/flows/{flow_id}/enter")
def enter_student_flow(
    flow_id: str,
    student: dict[str, object] = Depends(get_current_student),
) -> dict[str, object]:
    try:
        return enter_flow(flow_id, int(student["id"]))
    except RosterAccessError as exc:
        raise runtime_error(exc) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="流程不存在或尚未发布") from exc
```

- [ ] **Step 3: 静态确认兼容接口未改变**

确认 `/shared/{token}/enter`、`/flow-instances`、`/flow-instances/{instance_id}`、draft、file、submit 和 audit retry 路由仍存在。

### Task 4: 更新前端 API 契约

**Files:**
- Modify: `frontend/src/features/auth/authApi.ts:17-22`
- Modify: `frontend/src/features/auth/authApi.ts:80-82`
- Modify: `frontend/src/features/academic-flow/api.ts:158-176`

**Interfaces:**
- Consumes: Task 3 的两个新接口。
- Produces: 新 `StudentFlowSummary`、`authApi.studentFlows()`、`workflowApi.enterFlow(flowId)`。

- [ ] **Step 1: 修改摘要类型**

```typescript
export type StudentFlowSummary = {
  flowId: string;
  instanceId: string | null;
  lastActiveAt: string | null;
  name: string;
  status: "completed" | "in_progress" | "not_started";
};
```

- [ ] **Step 2: 切换列表路径**

```typescript
studentFlows() {
  return request<StudentFlowSummary[]>("/api/student/flows");
},
```

- [ ] **Step 3: 增加进入 API**

```typescript
enterFlow(flowId: string) {
  return request<RuntimeFlowInstance>(
    `/api/student/flows/${encodeURIComponent(flowId)}/enter`,
    { method: "POST" },
  );
},
```

- [ ] **Step 4: 对照字段名称**

确认 Python 和 TypeScript 均使用 `flowId`、`instanceId`、`name`、`status`、`lastActiveAt`，且两个可空字段声明为 `null`。

### Task 5: 更新学生流程中心和跳转

**Files:**
- Modify: `frontend/src/features/auth/StudentAccountPage.tsx:6-47`
- Modify: `frontend/src/App.tsx:512-533`

**Interfaces:**
- Consumes: Task 4 的摘要和 `workflowApi.enterFlow`。
- Produces: `onOpenFlow(flowId: string) -> Promise<void>` 与统一实例跳转。

- [ ] **Step 1: 增加进入中状态和异步回调**

```typescript
onOpenFlow: (flowId: string) => Promise<void>;
```

```typescript
const [openingFlowId, setOpeningFlowId] = useState<string | null>(null);

const openFlow = async (flowId: string) => {
  setNotice("");
  setOpeningFlowId(flowId);
  try {
    await onOpenFlow(flowId);
  } catch (reason) {
    setNotice(reason instanceof Error ? reason.message : "进入流程失败");
  } finally {
    setOpeningFlowId(null);
  }
};
```

- [ ] **Step 2: 更新列表展示**

列表使用 `flow.flowId` 作为 key 和进入参数。`not_started` 显示“待开始”与“尚未开始”；其他状态沿用“进行中/已完成”。进入时显示“正在进入”，并暂时禁用列表按钮。

标题说明改为：

```tsx
<span>这里展示所有包含你的已发布 OA 流程。</span>
```

空列表改为：

```tsx
<div className="student-account-empty">暂无可填写的 OA 流程</div>
```

- [ ] **Step 3: App 统一进入并跳转**

```tsx
onOpenFlow={async (flowId) => {
  const instance = await workflowApi.enterFlow(flowId);
  setRuntimeInstance(instance);
  setActiveRuntimeInstanceId(instance.id);
  pushAppPath(`/student/flows/${encodeURIComponent(instance.id)}`);
  setScreen("academicFlowStudentRuntime");
}}
```

- [ ] **Step 4: 静态追踪交互闭环**

```text
student login -> /student -> GET /api/student/flows
-> click authorized flow -> POST /api/student/flows/{flowId}/enter
-> RuntimeFlowInstance -> /student/flows/{instanceId}
```

### Task 6: 最终范围审计、重启和提交

**Files:**
- Inspect: six allowlisted files only

**Interfaces:**
- Consumes: Tasks 2–5。
- Produces: 一个范围干净的实现提交和用户手测清单。

- [ ] **Step 1: 检查差异格式和范围**

```bash
git diff --check
git diff --name-only
```

Expected: 本次生产改动只出现在六个 allowlist 文件；用户原有文件未被改动或暂存。

- [ ] **Step 2: 业务逻辑静态审计**

确认名单内未开始流程来自 active roster；名单外流程不出现在列表；进入接口重新校验名单；分享链接继续校验名单；撤销后现有读取和写接口仍返回 `403`；数据库和 DAG 文件无差异。

- [ ] **Step 3: 只读发现缓存**

```bash
find backend frontend -type d \( -name __pycache__ -o -name .pytest_cache -o -name '*.egg-info' \) -print
```

Expected: 因未运行 Python 和测试，通常没有本次新增缓存。只清理能确认由本次实现产生的缓存。

- [ ] **Step 4: 重启现有服务**

```bash
docker compose restart backend frontend
```

Expected: 只重启服务，不构建、不运行自动化验证。

- [ ] **Step 5: 只暂存六个文件并提交**

```bash
git add backend/app/repositories/flow_instances.py backend/app/api/routes/student_flows.py frontend/src/features/auth/authApi.ts frontend/src/features/academic-flow/api.ts frontend/src/features/auth/StudentAccountPage.tsx frontend/src/App.tsx
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: list student flows by roster access"
```

Expected: 实现提交只包含六个生产文件。

- [ ] **Step 6: 交付用户手测清单**

```text
1. OA-1 名单为 A、B、C；OA-2 名单为 B、C、D。
2. A 只看到 OA-1；B、C 看到两个；D 只看到 OA-2。
3. 名单内但从未访问分享链接的学生看到“待开始”并能进入。
4. 名单外学生持有分享链接仍被拒绝。
5. 移除学生后 OA 消失且旧实例不可读写；恢复后继续原实例。
6. 重新发布 OA 后，现有 DAG 迁移行为保持不变。
```

## Plan Self-Review

- Spec coverage: 名单隔离、未开始流程发现、首次进入、分享链接复用、撤销与恢复均有实施步骤。
- Scope: 只修改六个生产文件；不需要数据库或 DAG 变更。
- Type consistency: 前后端统一使用 `flowId`、`instanceId`、`name`、`status`、`lastActiveAt`。
- Verification policy: 不运行自动化测试、构建或浏览器，只做静态审计并交由用户手测。
