## Task 4: 扩展前端脚本模型与 API 客户端

**Files:**

- Modify: `frontend/src/features/academic-flow/auditScripts.ts`
- Modify: `frontend/src/features/academic-flow/api.ts`
- Modify: `frontend/tests/auditScripts.test.ts`

- [ ] **Step 1: 写类型映射与固定版本失败测试**

将测试夹具增加：

```typescript
description: "校验文件命名与结构",
updatedAt: "2026-07-17T10:00:00+00:00",
```

断言脚本选项继续使用 API 返回的当前版本；当节点已经保存旧版本时，`getSelectedAuditScriptValue(node)` 仍返回旧的 `uploaded:<id>:<version>`，不会自动切到列表中的最新版。

- [ ] **Step 2: 运行前端定向测试并确认失败**

Run: `cd frontend && node --experimental-strip-types --test tests/auditScripts.test.ts`

Expected: FAIL，类型尚不包含管理元数据或缺少旧版本回显逻辑。

- [ ] **Step 3: 扩展类型和 API 方法**

`AuditScriptSummary` 增加 `description`、`updatedAt`。API 调整为：

```typescript
uploadAuditScript(name: string, description: string, file: File): Promise<AuditScriptSummary>
updateAuditScript(scriptId: string, description: string, file: File): Promise<AuditScriptSummary>
```

两个方法都使用 `FormData`；更新方法请求 `PUT /api/workflow-admin/audit-scripts/{id}`。保留模板下载方法。

为了让旧版本节点在下拉框中可见，`getAuditScriptOptions(scripts, node?)` 在当前列表不包含节点固定版本值时，追加一个只用于回显的选项：`<节点脚本名>（固定 vN）`。用户重新选择管理员脚本时，仍写入当前最新版。

- [ ] **Step 4: 运行测试并提交**

Run: `cd frontend && node --experimental-strip-types --test tests/auditScripts.test.ts`

Expected: PASS。

```bash
git add frontend/src/features/academic-flow/auditScripts.ts frontend/src/features/academic-flow/api.ts frontend/tests/auditScripts.test.ts
git commit -m "Extend audit script client model"
```

---

