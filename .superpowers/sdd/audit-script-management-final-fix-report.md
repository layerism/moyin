# 审核脚本管理最终审查修复报告

日期：2026-07-17  
基线提交：`ba936c8`  
检查点：`412aab0`（`chore: checkpoint before audit script review fixes`）
最终提交：`3b29c09`（`Fix audit script review findings`）

## 处置结论

| Finding | 处置 | 证据 |
| --- | --- | --- |
| Important：上传路由无上限读取 | 已修复 | POST/PUT 共用 `_read_audit_script_content()`，以 `audit_script_max_bytes + 1` 调用 `UploadFile.read()`；仓储既有大小验证返回 422。直接 API 回归测试记录两个读取参数均为 `1048577`。 |
| Minor：旧库迁移 `updated_at` 可空 | 部分安全修复 | 对尚未迁移的旧库，`ALTER TABLE` 改为 `TEXT NOT NULL DEFAULT ''`，再将 `NULL` 或默认空字符串回填为 `created_at`；回归测试校验 `PRAGMA table_info(...).notnull == 1`。 |
| Minor：列表失败仍显示“正在读取” | 已修复 | 列表 `loading`、`error`、`scripts` 分离；失败时纯状态函数返回 `error`，对话框仅呈现错误提示和“重新读取”。 |
| Minor：缺少角色无关 selector render test | 保持现状并记录理由 | 项目没有 `@testing-library/*` 或 `react-test-renderer`，现有 Node 内建测试只覆盖纯函数。`AuditScriptSelector` 既不接收角色 props，也无角色条件分支；`auditScripts.test.ts` 已覆盖选项和固定版本回显。为此加入源码字符串断言或手工 React mock 会比当前结构更脆弱，未新增依赖。 |

## RED -> GREEN

### RED

1. `cd backend && PYTHONPATH=. ./.venv/bin/pytest -q tests/test_audit_scripts_api.py`
   - 结果：`2 failed, 7 passed`。
   - 失败分别证明旧迁移的 `updated_at` 在 PRAGMA 中 `notnull == 0`，以及两个上传路由均调用 `read(-1)`。
2. `cd frontend && node --experimental-strip-types --test tests/auditScriptManager.test.ts`
   - 结果：失败，缺少 `getAuditScriptListState` 导出；该测试明确要求加载失败状态不得等同加载状态。

### GREEN

1. `cd backend && PYTHONPATH=. ./.venv/bin/pytest -q tests/test_audit_scripts_api.py`
   - 结果：`9 passed`（仅第三方 `python_multipart` PendingDeprecationWarning）。
2. `cd backend && PYTHONPATH=. ./.venv/bin/pytest -q tests/test_audit_script_runtime.py`
   - 结果：`8 passed`（同一第三方 warning）。
3. `cd frontend && node --experimental-strip-types --test tests/auditScripts.test.ts tests/auditScriptManager.test.ts`
   - 结果：`14 passed`。
4. `cd frontend && npm run build`
   - 结果：通过；TypeScript 编译和 Vite 生产构建均成功。
5. `git diff --check`
   - 结果：通过，无空白错误。
6. `curl -s http://127.0.0.1:8000/api/health`
   - 结果：`{"status":"ok"}`，后端 Uvicorn 重启后健康。

## 变更文件

- `backend/app/api/routes/workflow_admin.py`
- `backend/app/core/database.py`
- `backend/tests/test_audit_scripts_api.py`
- `frontend/src/features/academic-flow/auditScriptManager.ts`
- `frontend/src/features/academic-flow/AuditScriptManagerDialog.tsx`
- `frontend/tests/auditScriptManager.test.ts`
- `docs/superpowers/2026-07-17-audit-script-management-final-fix.md`

## 未修 Minor 与剩余顾虑

1. 已在旧代码版本上执行过原迁移的数据库，其 SQLite 列定义仍可空；SQLite 要把该列改为 `NOT NULL` 需要重建 `audit_scripts` 父表。该表被 `audit_script_versions` 外键引用，重建会扩大迁移面、增加迁移中断或外键一致性风险。本次保留该不成比例的表重建；每次初始化仍会回填已有 `NULL`/空字符串，且当前仓储写入路径始终提供 `updated_at`。
2. 未添加角色无关 selector 的组件 render test：当前无可靠 React 渲染测试运行器，且组件结构已经没有角色数据流或角色分支。已通过静态结构检查和现有纯函数测试验证；若未来引入 React Testing Library，再补真实渲染与角色上下文无关测试。
3. 尝试运行 `./.venv/bin/ruff` 时环境中不存在该可执行文件（exit 127），未将其作为通过项；所需 pytest、Node 测试、构建和 diff 检查均已成功。
