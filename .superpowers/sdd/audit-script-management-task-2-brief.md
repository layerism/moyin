## Task 2: 扩展管理 API 并保持权限边界

**Files:**

- Modify: `backend/app/api/routes/workflow_admin.py`
- Modify: `backend/tests/test_audit_scripts_api.py`

- [ ] **Step 1: 写 API 失败测试**

补充以下场景：

- `POST` 缺少或提交空描述时返回 `422`；
- `PUT` 接收 `description + file`，版本递增且描述更新；
- 普通教师对 `PUT` 返回 `403`；
- 列表响应包含描述和更新时间，但不包含 `directoryPath`、`entryFilename`、源代码；
- 更新时上传不同语言文件返回 `422`。

- [ ] **Step 2: 运行定向测试并确认失败**

Run: `cd backend && pytest -q tests/test_audit_scripts_api.py`

Expected: FAIL，路由尚未接收 `description`。

- [ ] **Step 3: 修改 FastAPI 表单参数**

`post_audit_script()` 新增：

```python
description: Annotated[str, Form(min_length=1, max_length=500)]
```

`put_audit_script()` 同样新增 `description`，并将其传入仓储。继续使用 `Depends(get_current_super_admin)` 保护模板、创建、更新和归档接口；`GET /audit-scripts` 继续使用路由级教师鉴权。

- [ ] **Step 4: 运行测试并提交**

Run: `cd backend && pytest -q tests/test_audit_scripts_api.py`

Expected: PASS。

```bash
git add backend/app/api/routes/workflow_admin.py backend/tests/test_audit_scripts_api.py
git commit -m "Expose audit script management metadata"
```

---

