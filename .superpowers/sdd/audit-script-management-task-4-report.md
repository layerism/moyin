# Task 4 + Task 6：审核脚本模型、API 与节点选择器收敛

Task 6 已与本任务合并执行，以同步新 API 签名、节点固定版本回显和节点检查器职责收敛。

## RED

- 在 `frontend/tests/auditScripts.test.ts` 的脚本夹具补充 `description`、`updatedAt`，并新增“旧版本节点继续回显固定版本，而非自动切换到最新版本”回归测试。
- 命令：`cd frontend && node --experimental-strip-types --test tests/auditScripts.test.ts`
- 结果：失败，新增测试期望 `uploaded:script-1:2` 的 `材料审核（固定 v2）` 选项；实际末项仍为列表返回的 `uploaded:script-1:3`。

## GREEN

- `AuditScriptSummary` 增加 `description`、`updatedAt`。
- `getAuditScriptOptions(scripts, node?)` 在最新列表没有节点固化值时追加仅供回显的 `固定 vN` 选项；`getSelectedAuditScriptValue` 继续使用节点固化的 ID/version。
- `workflowApi.uploadAuditScript` 改为以 `FormData` 提交名称、描述和文件；新增 `workflowApi.updateAuditScript`，以 `PUT /api/workflow-admin/audit-scripts/{id}` 提交描述和文件。
- 命令：`cd frontend && node --experimental-strip-types --test tests/auditScripts.test.ts`
- 结果：4 tests passed，0 failed。

## Task 6 变更

- `AuditScriptSelector` 已移除 `isSuperAdmin`、模板下载、文件上传、上传状态及管理按钮，仅保留列表加载、选择与错误呈现。
- 选择器以 `getAuditScriptOptions(scripts, node)` 渲染节点固定的旧版本回显项。
- `AcademicFlowDesigner` 与 `App` 已删除仅为节点内脚本管理而存在的 `isSuperAdmin` 传递；清除 `.audit-script-actions`、`.audit-script-upload` 样式。

## 验证与自审

- `git diff --check`：通过，无空白错误。
- 完整聚焦测试命令：`cd frontend && node --experimental-strip-types --test tests/auditScripts.test.ts tests/auditScriptManager.test.ts`。
- 测试输出：`tests 4`，`pass 4`，`fail 0`，`cancelled 0`，`skipped 0`。
- 完整构建命令：`cd frontend && npm run build`。
- 构建输出：`tsc -b && vite build` 成功，转换 `106 modules`，构建耗时 `640ms`。
- 变更文件：
  - `frontend/src/features/academic-flow/auditScripts.ts`
  - `frontend/src/features/academic-flow/api.ts`
  - `frontend/src/features/academic-flow/AuditScriptSelector.tsx`
  - `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
  - `frontend/tests/auditScripts.test.ts`
- 本任务未改动已有的用户工作区文件；提交时只暂存以上三项与本报告。

## 顾虑

- `tests/auditScriptManager.test.ts` 在当前工作树中不存在；Node 的 test runner 对该未匹配路径未报错，因此上述结果实际覆盖 `auditScripts.test.ts` 的 4 个测试。管理弹窗测试应由对应的管理 UI 任务提供。
