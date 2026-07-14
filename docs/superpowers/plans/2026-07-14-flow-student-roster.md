# Flow Student Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每个 OA 流程增加可审计的姓名/学号名单，并在学生所有运行时操作中持续执行名单授权。

**Architecture:** 前端使用现有 `read-excel-file` 解析 Excel 并提交标准化 JSON；后端以独立名单表作为授权真源。名单权限在进入、读取、暂存、提交和学生流程列表各入口统一校验，名单移除只撤销访问，不删除学生历史实例。

**Tech Stack:** React 18、TypeScript、read-excel-file、FastAPI、Pydantic、SQLite、pytest、Node test runner。

## Global Constraints

- 学生权限仅按姓名和学号精确匹配，班级不参与判断。
- Excel 导入仅新增、更新或恢复，不隐式移除未出现的学生。
- 发布后允许维护名单，所有变更写入审计日志。
- 空名单禁止发布；历史空名单流程拒绝所有学生访问。
- 单批导入最多 5000 行。
- 所有教师名单接口必须校验流程归属。

---

### Task 1: 名单数据模型与教师 API

**Files:**
- Modify: `backend/app/core/database.py`
- Create: `backend/app/repositories/flow_roster.py`
- Create: `backend/app/api/routes/flow_roster.py`
- Modify: `backend/app/api/router.py`
- Create: `backend/tests/test_flow_roster.py`

**Interfaces:**
- Produces: `list_roster(flow_id, teacher_id)`, `import_roster(flow_id, teacher_id, entries, source_file_name)`, `revoke_roster_entry(flow_id, entry_id, teacher_id)`。
- Produces API: `GET /api/workflows/{flow_id}/roster`、`POST /api/workflows/{flow_id}/roster/import`、`DELETE /api/workflows/{flow_id}/roster/{entry_id}`。

- [ ] **Step 1: 写入失败测试**

覆盖教师归属隔离、批量新增、姓名更新、撤销后恢复、批次重复学号拒绝、审计摘要及单批上限。

- [ ] **Step 2: 验证测试因接口不存在而失败**

Run: `cd backend && .venv/bin/python -m pytest -q tests/test_flow_roster.py`

Expected: `404` 或导入符号不存在。

- [ ] **Step 3: 实现数据库表与仓储**

新增：

```sql
CREATE TABLE IF NOT EXISTS flow_roster_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    student_no TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    UNIQUE(flow_id, student_no)
);
```

导入在 `BEGIN IMMEDIATE` 事务内校验并使用 `ON CONFLICT(flow_id, student_no) DO UPDATE`，审计仅记录计数和源文件名。

- [ ] **Step 4: 实现路由并运行测试**

请求模型：

```python
class RosterEntryRequest(BaseModel):
    studentNo: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=64)

class ImportRosterRequest(BaseModel):
    entries: list[RosterEntryRequest] = Field(min_length=1, max_length=5000)
    sourceFileName: str = Field(min_length=1, max_length=255)
```

Run: `cd backend && .venv/bin/python -m pytest -q tests/test_flow_roster.py`

Expected: PASS。

- [ ] **Step 5: 创建任务检查点**

```bash
git add backend/app/core/database.py backend/app/repositories/flow_roster.py backend/app/api/routes/flow_roster.py backend/app/api/router.py backend/tests/test_flow_roster.py
git commit -m "Add flow student roster management"
```

### Task 2: 发布约束与持续名单授权

**Files:**
- Modify: `backend/app/repositories/flow_roster.py`
- Modify: `backend/app/repositories/workflows.py`
- Modify: `backend/app/repositories/flow_instances.py`
- Modify: `backend/app/api/routes/workflows.py`
- Modify: `backend/tests/test_workflows.py`
- Modify: `backend/tests/test_flow_runtime.py`

**Interfaces:**
- Consumes: `flow_roster_entries`。
- Produces: `assert_student_roster_access(connection, flow_id, student_id)`，无权限时抛出 `RosterAccessError`。

- [ ] **Step 1: 写入失败测试**

覆盖空名单发布返回 `422`、名单内学生进入成功、名单外学生进入返回 `403`、撤销后实例读取/暂存/提交返回 `403`、恢复后继续原实例、学生首页过滤撤销流程。

- [ ] **Step 2: 运行定向测试并确认失败**

Run: `cd backend && .venv/bin/python -m pytest -q tests/test_workflows.py tests/test_flow_runtime.py`

Expected: 新增断言失败。

- [ ] **Step 3: 实现统一授权函数**

授权查询必须同时匹配：

```sql
WHERE r.flow_id = ?
  AND r.student_no = a.student_no
  AND r.name = a.name
  AND r.status = 'active'
```

在每个运行时入口通过实例关联到 `flow_versions.flow_id` 后调用该函数，不能只在首次进入检查。

- [ ] **Step 4: 增加发布前名单数量校验及 HTTP 错误映射**

空名单发布返回 `422`，名单拒绝统一返回 `403` 和“你不在该流程的有效学生名单中”。

- [ ] **Step 5: 运行后端全量测试**

Run: `cd backend && .venv/bin/python -m pytest -q && .venv/bin/ruff check app tests`

Expected: 全部通过。

- [ ] **Step 6: 创建任务检查点**

```bash
git add backend/app backend/tests
git commit -m "Enforce flow roster access"
```

### Task 3: Excel 名单解析与教师界面

**Files:**
- Modify: `frontend/src/utils/roster.ts`
- Create: `frontend/src/features/academic-flow/FlowRosterDialog.tsx`
- Modify: `frontend/src/features/academic-flow/api.ts`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Modify: `frontend/src/styles.css`
- Create: `frontend/tests/flowRoster.test.ts`

**Interfaces:**
- Produces: `parseFlowRoster(file): Promise<{entries, errors}>`。
- Produces API methods: `getRoster(flowId)`, `importRoster(flowId, payload)`, `revokeRosterEntry(flowId, entryId)`。

- [ ] **Step 1: 写名单标准化失败测试**

覆盖表头别名、空白清理、前导零学号保留、空字段、重复学号同名去重和异名报错。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && node --experimental-strip-types --test tests/flowRoster.test.ts`

Expected: 新函数不存在或断言失败。

- [ ] **Step 3: 实现纯函数标准化与 Excel 适配**

纯函数接收二维单元格数组，Excel 读取仅负责调用 `readSheet`；标准输出字段固定为 `{studentNo, name}`。

- [ ] **Step 4: 实现名单弹窗**

设计页顶部增加“学生名单”按钮。弹窗提供上传、错误预览、搜索、有效/停用统计和逐行移除确认；发布后仍可使用。

- [ ] **Step 5: 接入发布约束提示**

打开设计页时读取名单。有效人数为零时发布按钮禁用并显示“请先导入学生名单”；成功导入后立即解除。

- [ ] **Step 6: 运行前端测试与构建**

Run: `cd frontend && node --experimental-strip-types --test tests/*.test.ts && npm run build`

Expected: 全部通过。

- [ ] **Step 7: 创建任务检查点**

```bash
git add frontend/src frontend/tests
git commit -m "Add flow roster Excel interface"
```

### Task 4: 综合验证

**Files:**
- Modify: `docs/04_oa_workflow_runtime_design.md`（仅补充名单授权实现状态）

- [ ] **Step 1: 运行全量静态与自动化验证**

```bash
cd backend && .venv/bin/python -m pytest -q && .venv/bin/ruff check app tests
cd ../frontend && node --experimental-strip-types --test tests/*.test.ts && npm run build
```

- [ ] **Step 2: 验证数据库迁移**

确认 `flow_roster_entries` 存在，外键开启，历史流程空名单时学生进入被拒绝。

- [ ] **Step 3: 验证浏览器主路径**

教师上传 Excel、查看解析结果、导入、移除学生；名单内学生可进入拓扑，名单外及被移除学生显示权限错误。

- [ ] **Step 4: 更新实现文档并提交最终检查点**

```bash
git add docs/04_oa_workflow_runtime_design.md
git commit -m "Document flow roster authorization"
```
