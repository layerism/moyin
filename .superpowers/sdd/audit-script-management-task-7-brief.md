## Task 7: 集成验证与交付检查

**Files:**

- Verify: `backend/tests/test_audit_scripts_api.py`
- Verify: `backend/tests/test_audit_script_runtime.py`
- Verify: `frontend/tests/auditScripts.test.ts`
- Verify: `frontend/tests/auditScriptManager.test.ts`
- Verify: `docs/superpowers/specs/2026-07-17-audit-script-management-design.md`

- [ ] **Step 1: 运行后端相关测试**

Run: `cd backend && pytest -q tests/test_audit_scripts_api.py tests/test_audit_script_runtime.py`

Expected: PASS。

- [ ] **Step 2: 运行前端相关测试和构建**

Run: `cd frontend && node --experimental-strip-types --test tests/auditScripts.test.ts tests/auditScriptManager.test.ts`

Expected: PASS。

Run: `cd frontend && npm run build`

Expected: PASS。

- [ ] **Step 3: 做权限与版本语义人工核对**

使用超级管理员账号确认：教务流程页出现“审核脚本”；可下载两种模板；可填写名称、描述并上传；更新同语言脚本后版本递增。使用普通教师账号确认：入口不可见，但文件上传节点可选择脚本。

创建一个节点并选择版本 `1`，再上传版本 `2`：旧节点仍显示并保存版本 `1`；清空或新配置节点重新选择时保存版本 `2`。

- [ ] **Step 4: 检查安全边界**

确认响应中不存在绝对目录和源代码；普通教师直接请求模板、创建和更新接口均为 `403`；运行时解析器对路径逃逸、哈希不匹配和文件篡改均拒绝。

- [ ] **Step 5: 检查工作区和提交范围**

Run: `git status --short`

Expected: 只剩用户原有的 `docs/05_oa_graph.md` 与 `.superpowers/brainstorm/`、`.superpowers/sdd/` 未提交内容；本功能文件均已提交。

Run: `git log --oneline -8`

Expected: 能看到本计划各任务对应的独立提交，便于逐步回滚。
