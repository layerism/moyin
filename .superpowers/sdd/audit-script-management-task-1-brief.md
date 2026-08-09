## Task 1: 扩展脚本元数据并兼容已有数据库

**Files:**

- Modify: `backend/app/core/database.py`
- Modify: `backend/app/repositories/audit_scripts.py`
- Modify: `backend/tests/test_audit_scripts_api.py`

- [ ] **Step 1: 先写失败测试，覆盖描述、更新时间和旧库迁移**

在 `backend/tests/test_audit_scripts_api.py` 通过仓储层直接增加断言，避免本任务提前依赖下一任务的 API 表单改造：

```python
created = create_audit_script(
    "材料基础校验",
    "校验文件结构与字段",
    "check.py",
    b"def run(payload): return {'passed': True}",
    admin_id,
)
assert created["description"] == "校验文件结构与字段"
assert created["updatedAt"]
assert list_audit_scripts()[0]["description"] == "校验文件结构与字段"
```

另建一个只含旧版 `audit_scripts` 表结构的临时数据库，调用 `initialize_database()` 后断言 `description`、`updated_at` 两列存在，且历史记录满足 `description = ''`、`updated_at = created_at`。

- [ ] **Step 2: 运行定向测试并确认失败原因正确**

Run: `cd backend && pytest -q tests/test_audit_scripts_api.py`

Expected: FAIL，仓储签名/摘要缺少 `description`/`updatedAt` 或旧表缺少新列。

- [ ] **Step 3: 添加幂等迁移**

在 `initialize_database()` 中调用 `_apply_audit_script_metadata_migration(connection)`。该函数使用 `PRAGMA table_info(audit_scripts)` 判断列是否存在，并依次执行：

```python
ALTER TABLE audit_scripts ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE audit_scripts ADD COLUMN updated_at TEXT;
UPDATE audit_scripts SET updated_at = created_at WHERE updated_at IS NULL;
```

记录迁移 ID `20260717_add_audit_script_metadata`。新建表定义直接包含：

```sql
description TEXT NOT NULL DEFAULT '',
updated_at TEXT NOT NULL,
```

- [ ] **Step 4: 扩展仓储接口与清单**

将仓储签名调整为：

```python
def create_audit_script(
    name: str, description: str, filename: str, content: bytes, admin_id: int
) -> dict[str, object]: ...

def create_audit_script_version(
    script_id: str, description: str, filename: str, content: bytes, admin_id: int
) -> dict[str, object]: ...
```

新增 `_normalize_description()`，去除首尾空白，要求非空且最多 500 字符。创建时写入 `description` 与 `updated_at`；更新版本时同时更新 `current_version`、`description` 与 `updated_at`。`list_audit_scripts()` 和 `_summary()` 返回：

```python
{
    "id": script_id,
    "name": name,
    "description": description,
    "language": language,
    "version": version,
    "sha256": sha256,
    "updatedAt": updated_at,
}
```

`manifest.json` 增加 `description` 字段。

- [ ] **Step 5: 运行测试并提交**

Run: `cd backend && pytest -q tests/test_audit_scripts_api.py`

Expected: PASS。

```bash
git add backend/app/core/database.py backend/app/repositories/audit_scripts.py backend/tests/test_audit_scripts_api.py
git commit -m "Extend audit script metadata"
```

---

