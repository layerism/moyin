## Task 6: 将节点检查器收敛为纯脚本选择器

**Files:**

- Modify: `frontend/src/features/academic-flow/AuditScriptSelector.tsx`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/tests/auditScripts.test.ts`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: 增加选择行为测试**

补充断言：

- 普通教师和超级管理员使用相同的脚本选项；
- 选中管理员脚本写入该脚本当前版本与哈希；
- 旧节点固定版本值可回显；
- 选择“不启用材料审核”会清空上传脚本标识。

- [ ] **Step 2: 移除节点内管理能力**

从 `AuditScriptSelector` 删除：

- `isSuperAdmin` prop；
- 模板下载处理；
- 文件上传处理；
- 上传中状态和管理按钮。

组件只负责加载脚本列表、显示选择下拉框、调用 `resolveAuditScriptSelection()` 和呈现列表加载错误。

同步从 `AcademicFlowDesigner` 与 `App.tsx` 移除仅为节点内管理而存在的 `isSuperAdmin` 传递，并删除不再使用的 `.audit-script-actions`、`.audit-script-upload` 样式。

- [ ] **Step 3: 运行前端测试和构建并提交**

Run: `cd frontend && node --experimental-strip-types --test tests/auditScripts.test.ts tests/auditScriptManager.test.ts`

Expected: PASS。

Run: `cd frontend && npm run build`

Expected: PASS。

```bash
git add frontend/src/features/academic-flow/AuditScriptSelector.tsx frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/App.tsx frontend/tests/auditScripts.test.ts frontend/src/styles.css
git commit -m "Separate audit script management from nodes"
```

---

