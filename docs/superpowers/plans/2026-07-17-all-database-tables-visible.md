# Database Management All Tables Visible Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让超级管理员自动看到 SQLite 中的全部表，同时保证未显式配置的表只读且不可删除。

**Architecture:** 数据库仓储从 `sqlite_master` 动态发现真实表名，并把静态策略收敛为编辑、删除权限声明。API 在列表和结构响应中返回删除权限，React 页面据此隐藏只读表的删除入口。

**Tech Stack:** Python 3.11、FastAPI、SQLite、React、TypeScript。

## Global Constraints

- 所有 SQLite 表均可见，包括 `schema_migrations` 和 `sqlite_sequence`。
- 未配置策略的表默认只读且不可删除。
- 现有敏感字段继续脱敏。
- 不新增依赖，不修改数据库结构，不改变 OSS 文件生命周期。
- 不运行自动化测试、浏览器测试或构建验证；只做业务逻辑静态审计。
- 当前分支实施，中间不提交，完成后仅提交一个实现检查点并重启服务。
- 保留 `AGENTS.md`、`docs/05_oa_graph.md` 和 `.superpowers/` 中已有未提交内容。

---

### Task 1: 动态发现表并实施默认只读权限

**Files:**
- Modify: `backend/app/repositories/database_admin.py`

**Interfaces:**
- Produces: `TablePolicy(editable_columns: frozenset[str], deletable: bool)`。
- Produces: `_table_names(connection: sqlite3.Connection) -> list[str]`。
- Produces: `_policy(connection: sqlite3.Connection, table: str) -> TablePolicy`；不存在的表抛出 `KeyError`。
- Produces: 表列表和表结构响应中的 `deletable: bool`。

- [x] **Step 1: 扩展权限模型**

将 `TablePolicy` 增加默认关闭的 `deletable` 字段，并把现有静态策略显式设为可删除，以保持既有行为：

```python
@dataclass(frozen=True)
class TablePolicy:
    editable_columns: frozenset[str] = frozenset()
    deletable: bool = False

TABLE_POLICIES = {
    "audit_logs": TablePolicy(deletable=True),
    "flow_instances": TablePolicy(
        frozenset({"status", "completed_at", "last_active_at"}), deletable=True
    ),
    "flow_roster_entries": TablePolicy(
        frozenset({"student_no", "name", "status"}), deletable=True
    ),
    "flow_node_runtime_configs": TablePolicy(
        frozenset({"deadline_at"}), deletable=True
    ),
    "flow_versions": TablePolicy(deletable=True),
    "flows": TablePolicy(
        frozenset({"name", "description", "owner_id", "status", "draft_config"}),
        deletable=True,
    ),
    "node_drafts": TablePolicy(frozenset({"payload"}), deletable=True),
    "node_instances": TablePolicy(
        frozenset({"status", "opened_at", "submitted_at", "approved_at", "attempt_no"}),
        deletable=True,
    ),
    "share_tokens": TablePolicy(frozenset({"status", "expires_at"}), deletable=True),
    "student_accounts": TablePolicy(
        frozenset({"student_no", "name", "status"}), deletable=True
    ),
    "student_deadline_overrides": TablePolicy(
        frozenset({"deadline_at", "reason"}), deletable=True
    ),
    "student_sessions": TablePolicy(deletable=True),
    "submissions": TablePolicy(frozenset({"status"}), deletable=True),
    "teacher_accounts": TablePolicy(
        frozenset({"employee_no", "name", "status"}), deletable=True
    ),
    "teacher_sessions": TablePolicy(deletable=True),
}
```

- [x] **Step 2: 从数据库发现全部表**

增加单一真实表名来源：

```python
def _table_names(connection: sqlite3.Connection) -> list[str]:
    rows = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    ).fetchall()
    return [str(row["name"]) for row in rows]
```

`list_admin_tables()` 遍历 `_table_names(connection)`，对每张表使用 `TABLE_POLICIES.get(name, TablePolicy())`，返回 `name`、`rowCount`、`editableColumns`、`deletable`。

- [x] **Step 3: 在所有动态 SQL 前校验表名**

将策略解析改成连接级校验：

```python
def _policy(connection: sqlite3.Connection, table: str) -> TablePolicy:
    if table not in _table_names(connection):
        raise KeyError(table)
    return TABLE_POLICIES.get(table, TablePolicy())
```

`get_admin_table_schema()`、`list_admin_rows()`、`update_admin_row()` 和 `delete_admin_row()` 均在同一连接中先调用 `_policy(connection, table)`，再拼接已验证表名。

- [x] **Step 4: 拒绝只读表删除**

`delete_admin_row()` 在备份数据库前执行：

```python
with get_connection() as connection:
    policy = _policy(connection, table)
    if not policy.deletable:
        raise DatabaseAdminError("该数据表仅供查看，不能删除记录")
    primary_keys = _primary_keys(connection, table)
```

表结构响应增加 `deletable`。PATCH 对默认策略仍由空 `editable_columns` 拒绝修改。

- [x] **Step 5: 静态业务逻辑审计**

逐项确认：所有动态 SQL 的表名先经过 `sqlite_master` 校验；默认策略无编辑字段且禁止删除；数据库备份只在删除权限检查通过后发生；敏感字段仍经过 `_redact_row()`。

---

### Task 2: 前端按服务端权限展示全部表

**Files:**
- Modify: `frontend/src/features/admin/databaseAdminApi.ts`
- Modify: `frontend/src/features/admin/DatabaseAdminPage.tsx`

**Interfaces:**
- Consumes: `AdminTable.deletable: boolean` 和 `AdminTableSchema.deletable: boolean`。
- Produces: `DatabaseRowsTable` 的 `deletable: boolean` 属性。

- [x] **Step 1: 补充 API 类型**

```typescript
export type AdminTable = {
  deletable: boolean;
  editableColumns: string[];
  name: string;
  rowCount: number;
};

export type AdminTableSchema = {
  columns: AdminColumn[];
  deletable: boolean;
  name: string;
};
```

- [x] **Step 2: 传递并执行删除权限**

`DatabaseAdminPage` 向记录表传入 `deletable={schema?.deletable ?? false}`。`DatabaseRowsTable` 增加布尔属性，只在允许删除时渲染按钮：

```tsx
{deletable ? (
  <button className="danger" onClick={() => onDelete(row)}>删除</button>
) : null}
```

列表计数文案从“个业务表”改为“个数据表”。

- [x] **Step 3: 静态业务逻辑审计**

确认 schema 未加载时删除入口默认关闭；后端拒绝仍是最终权限边界；查看按钮和只读字段展示保持不变。

---

### Task 3: 收尾、提交与服务重启

**Files:**
- Modify: `docs/superpowers/plans/2026-07-17-all-database-tables-visible.md`（勾选完成项）

**Interfaces:**
- Consumes: Task 1 和 Task 2 的最终代码。
- Produces: 一个不包含用户既有改动的实现提交和已重启服务。

- [x] **Step 1: 审计差异范围**

使用 `git diff --check` 和限定路径的 `git diff` 检查空白错误、权限字段命名一致性及非目标文件混入；不执行测试或构建。

- [x] **Step 2: 清理开发缓存**

仅清理项目中的 `.pytest_cache`、`__pycache__` 和 `*.egg-info`，不删除业务文件或用户文档。

- [x] **Step 3: 创建最终检查点**

只暂存本计划、后端仓储和两个前端文件，提交信息：

```text
feat: show all database tables safely
```

- [x] **Step 4: 重启现有服务**

识别项目当前服务启动方式，使用既有脚本或 Docker Compose 重启；不启动浏览器、不执行功能验证。
