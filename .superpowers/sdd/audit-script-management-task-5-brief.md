## Task 5: 实现超级管理员脚本管理弹窗

**Files:**

- Create: `frontend/src/features/academic-flow/auditScriptManager.ts`
- Create: `frontend/src/features/academic-flow/AuditScriptManager.tsx`
- Create: `frontend/tests/auditScriptManager.test.ts`
- Modify: `frontend/src/features/home/HomeView.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: 为表单规则写失败测试**

在纯 TypeScript 模块中测试：

- 名称去除首尾空格后不能为空且不超过 120 字符；
- 描述不能为空且不超过 500 字符；
- 新增只接受 `.py`/`.js`；
- 更新必须保持原语言；
- 更新模式锁定功能名称但允许修改描述。

Run: `cd frontend && node --experimental-strip-types --test tests/auditScriptManager.test.ts`

Expected: FAIL，管理表单模型尚不存在。

- [ ] **Step 2: 实现可测试的表单状态与校验**

在 `auditScriptManager.ts` 导出：

```typescript
export type AuditScriptFormMode =
  | { kind: "create" }
  | { kind: "update"; script: AuditScriptSummary };

export function validateAuditScriptForm(input: {
  mode: AuditScriptFormMode;
  name: string;
  description: string;
  file: File | null;
}): string | null;
```

错误信息使用用户可理解的中文，并与后端限制一致。

- [ ] **Step 3: 实现管理弹窗组件**

`AuditScriptManager.tsx` 接收 `onClose`。打开时调用 `listAuditScripts()`。列表展示名称、描述、语言、当前版本和格式化后的更新时间；顶部提供 Python/JavaScript 模板下载和“上传新脚本”。每行提供“更新版本”。

组件内部只有两种视图：

1. 列表视图；
2. 新增/更新表单视图。

禁止再打开嵌套弹窗。提交期间禁用关闭与重复提交；成功后回到列表并以返回值更新对应项；失败信息显示在弹窗内 `role="alert"`。更新模式锁定名称并限制同语言文件。

- [ ] **Step 4: 在教务流程页接入超级管理员入口**

在 `AcademicFlowView` 增加 `scriptManagerOpen` 状态。在现有“创建流程”按钮旁，仅当：

```typescript
teacherIdentity.role === "super_admin"
```

时渲染“审核脚本”按钮。普通教师 DOM 中不存在该按钮。打开时渲染 `AuditScriptManager`。

在 `styles.css` 添加与现有 `.modal-backdrop`、`.drive-tools` 视觉语言一致的弹窗、表格、表单、错误态和移动端布局样式，不改变页面整体布局。

- [ ] **Step 5: 运行测试和类型构建并提交**

Run: `cd frontend && node --experimental-strip-types --test tests/auditScriptManager.test.ts tests/auditScripts.test.ts`

Expected: PASS。

Run: `cd frontend && npm run build`

Expected: PASS，无 TypeScript 错误。

```bash
git add frontend/src/features/academic-flow/auditScriptManager.ts frontend/src/features/academic-flow/AuditScriptManager.tsx frontend/tests/auditScriptManager.test.ts frontend/src/features/home/HomeView.tsx frontend/src/styles.css
git commit -m "Add audit script management dialog"
```

---

