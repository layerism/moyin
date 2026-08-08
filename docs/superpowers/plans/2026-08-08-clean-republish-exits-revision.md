# 无改动重新发布退出修订实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使已发布流程在无改动修订状态下点击“重新发布”直接退出编辑，且不调用发布 API 或创建新版本。

**Architecture:** 由 `publishButtonState` 纯函数派生新的 `finish-revision` 动作，保持按钮文案为“重新发布”。`AcademicFlowDesigner` 在点击处理中消费该动作，只重置本地修订状态并显示提示；实际有改动时仍走原有发布链路。

**Tech Stack:** React 18、TypeScript、Node.js 内置测试运行器

## Global Constraints

- 无改动退出时不调用 `getRevisionImpact` 或 `onPublishProcess`。
- 不新增或覆盖 `flow_versions`，不修改后端发布接口。
- 提示文本固定为“未检测到改动，已退出编辑”。
- 学生名单为空或尚未加载不阻止无改动退出。
- 操作锁生效时仍禁用按钮。
- 不运行自动化测试或浏览器测试；只更新既有测试期望并进行源码差异审计。

---

### Task 1: 增加无改动退出动作并接入点击处理

**Files:**
- Modify: `frontend/src/features/academic-flow/publishButtonState.ts:1-40`
- Modify: `frontend/tests/publishButtonState.test.ts:32-52`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:290-296`

**Interfaces:**
- Consumes: `revisionDirty`、`revisionEditing`、`workingProcess.published` 和 `operationLocked`。
- Produces: `PublishButtonAction` 新增 `finish-revision`；无改动修订状态返回可点击的“重新发布”按钮；点击后仅重置本地状态。

- [ ] **Step 1: 更新按钮状态测试期望**

将现有无改动修订用例改为：

```ts
test("revision without changes offers a local revision exit", () => {
  assert.deepEqual(
    getPublishButtonState({
      hasUnpublishedChanges: false,
      operationLocked: false,
      published: true,
      revisionEditing: true,
      rosterActiveCount: 0,
    }),
    {
      action: "finish-revision",
      disabled: false,
      label: "重新发布",
      title: undefined,
    },
  );
});
```

使用 `rosterActiveCount: 0` 明确验证退出操作不依赖学生名单。按项目约定不执行该测试。

- [ ] **Step 2: 实现按钮状态动作**

将动作联合类型扩展为：

```ts
export type PublishButtonAction =
  | "publish"
  | "begin-revision"
  | "finish-revision"
  | "republish";
```

在已发布只读分支之后、通用发布状态计算之前增加：

```ts
if (input.published && input.revisionEditing && !input.hasUnpublishedChanges) {
  return {
    action: "finish-revision",
    disabled: input.operationLocked,
    label: "重新发布",
    title: undefined,
  };
}
```

保留实际发布状态中的名单、操作锁和提示派生逻辑。

- [ ] **Step 3: 实现本地退出处理**

在 `handlePublishButtonClick` 的 `begin-revision` 分支之后增加：

```ts
if (publishButtonState.action === "finish-revision") {
  setWorkingProcess(structuredClone(process));
  setRevisionEditingRequested(false);
  setRevisionDirty(false);
  setRevisionImpact(null);
  setPendingPublishProcess(null);
  setPublishedShareUrl("");
  setActionNotice("未检测到改动，已退出编辑");
  return;
}
```

该分支必须在 `void preparePublish()` 之前返回，确保不调用任何发布 API。

- [ ] **Step 4: 审计实现边界**

运行：

```bash
git diff --check -- frontend/src/features/academic-flow/publishButtonState.ts frontend/tests/publishButtonState.test.ts frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
git diff -- frontend/src/features/academic-flow/publishButtonState.ts frontend/tests/publishButtonState.test.ts frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
rg -n "finish-revision|preparePublish|getRevisionImpact|onPublishProcess|未检测到改动" frontend/src/features/academic-flow frontend/tests/publishButtonState.test.ts
```

预期：`finish-revision` 点击分支在 `preparePublish` 前返回；后端文件无差异；实际有改动的 `republish` 路径保持不变。

- [ ] **Step 5: 清理项目缓存**

检查并仅清理源码树产生的缓存，排除 `.venv` 和 `node_modules`：

```bash
find backend frontend \( -path 'backend/.venv' -o -path 'frontend/node_modules' \) -prune -o -type d \( -name '__pycache__' -o -name '.pytest_cache' -o -name '*.egg-info' \) -print
```

若无输出则无需删除；若有输出，逐项确认后仅删除列出的缓存目录。

- [ ] **Step 6: 提交完成检查点**

```bash
git add frontend/src/features/academic-flow/publishButtonState.ts frontend/tests/publishButtonState.test.ts frontend/src/features/academic-flow/AcademicFlowDesigner.tsx docs/superpowers/plans/2026-08-08-clean-republish-exits-revision.md
git commit -m "fix: exit unchanged flow revision locally"
```

- [ ] **Step 7: 重启本地服务**

停止当前 FastAPI 与 Vite 开发进程，然后按本地方式重新启动：

```bash
cd backend
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

cd frontend
npm run dev -- --host 0.0.0.0 --port 5173
```

仅核对启动日志和健康端点；界面行为交由用户手动确认。
