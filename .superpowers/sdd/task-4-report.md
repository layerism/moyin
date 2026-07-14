# Task 4 实施报告：教师端已发布流程修订交互与影响确认

## 实施范围

本任务仅修改任务指定的前端文件，并新增 `RevisionImpactDialog.tsx`、`flowRevision.ts` 与 `flowRevision.test.ts`。仓库中不存在独立的 `FlowNodeCanvas.tsx` 或 `NodeInspector.tsx`；两者均内嵌于 `AcademicFlowDesigner.tsx`，因此节点级删除策略和 deadline 只读接口在该文件内做了最小调整，未创建或修改额外组件文件。

## TDD 记录

1. 先新增 `frontend/tests/flowRevision.test.ts`，覆盖“已发布节点不可删除”和“修订新增节点可删除”。
2. 执行 `node --experimental-strip-types --test tests/flowRevision.test.ts`，确认因 `flowRevision.ts` 不存在而失败，错误为 `ERR_MODULE_NOT_FOUND`。
3. 实现最小策略函数 `canDeleteRevisionNode` 后再次执行，2 项测试全部通过。

## 实现结果

- 对接 `8ba6ae2` 后端接口：映射 `publishedNodeIds`、`publishedVersionNo`、`hasUnpublishedChanges`，并增加完整的 `RevisionImpact` / `sourceVersionImpacts` 类型与 `workflowApi.getRevisionImpact()`。
- `PUT /draft` 的完整响应直接回写为当前流程，保存修订后立即刷新服务端元数据；本地发布态设计变更会立即设置 `hasUnpublishedChanges: true`。
- 已发布流程恢复节点内容编辑、新增、连线、删线、拖动和排序；旧已发布节点的删除按钮被锁定提示替代，删除处理函数同时执行策略校验；修订新增节点仍可删除。
- 发布态按钮文案为“保存修订”和“重新发布”；状态按元数据显示“修订中”或“已发布”。
- “重新发布”先保存修订，再请求 revision impact 并打开确认弹窗；确认后调用既有发布回调，取消不触发发布。
- 影响弹窗显示当前/下一版本、内容变更节点数、新增节点数、需重新提交节点数和受影响学生数，并明确说明受影响提交将仅作为审计历史保留。
- 发布态节点检查器保持可编辑，但 deadline 字段只读，并引导至“填写进度”；运行时 deadline 更新不再写回修订内容。

`AcademicProcess` 中修订元数据保持可选，以兼容任务范围外现有的本地草稿/fallback 构造器；`ServerFlow` 对这三个后端字段采用必填约束，服务端流程映射始终完整填充。

## 验证结果

- `cd frontend && node --experimental-strip-types --test tests/*.test.ts`：16/16 通过。
- `cd frontend && npm run build`：TypeScript 与 Vite production build 通过。
- `git diff --check`：通过，无输出。
- 按任务要求未执行浏览器测试；后端测试不在本前端子任务验证范围内。
