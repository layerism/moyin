# Task 4 实施报告：教师端已发布流程修订交互与影响确认

## 实施范围

本任务仅修改前端代码与本报告，未修改后端。仓库中不存在独立的 `FlowNodeCanvas.tsx` 或 `NodeInspector.tsx`；两者均内嵌于 `AcademicFlowDesigner.tsx`，因此节点级删除策略、异步编辑锁和 deadline 只读接口均在该文件内做最小调整。审查修复要求修订元数据必填，因此同步修改本地流程构造器 `academicFlowData.ts`。

## TDD 记录

1. 首轮先新增 `flowRevision.test.ts`，确认因 `flowRevision.ts` 不存在而出现 `ERR_MODULE_NOT_FOUND`，随后实现最小删除策略并使 2 项测试转绿。
2. 审查修复先扩展 fail-closed、运行时节点过滤和批量布局测试；首次运行因 `filterPublishedRuntimeNodes` 等导出不存在而失败。
3. 实现三个纯 helper 后，focused tests 5/5 通过；最终全量前端测试 19/19 通过。

## 实现结果

- 对接 `8ba6ae2` 后端接口：映射 `publishedNodeIds`、`publishedVersionNo`、`hasUnpublishedChanges`，并增加完整的 `RevisionImpact` / `sourceVersionImpacts` 类型与 `workflowApi.getRevisionImpact()`。
- `AcademicProcess.publishedNodeIds` 和 `hasUnpublishedChanges` 改为必填，`publishedVersionNo` 保持可选；所有本地流程构造器显式初始化相应修订元数据。
- 删除策略在发布流程元数据异常缺失时 fail-closed，将全部现有节点视为已发布节点；正常情况下旧节点显示锁定提示，修订新增节点仍可删除。
- 已发布流程支持节点内容编辑、新增、连线、删线、拖动和排序；每次本地设计变更立即设置 `hasUnpublishedChanges: true`。
- 保存、影响预检、重新发布确认期间统一启用设计锁：组件库、画布拖动、连线、删线、节点操作、自动布局和检查器字段均不可修改；所有设计变更回调同时执行锁状态校验，异步响应不会覆盖期间本地编辑。
- 自动布局通过 `layoutRevisionNodes` 一次计算全部位置，并只执行一次 `onProcessChange`，消除循环使用旧 `process` 的闭包覆盖问题。
- `TeacherProgressPanel` 仅接收 `publishedNodeIds` 对应节点；修订新增节点在重新发布前不会进入旧版本 deadline 控制。
- 发布态按钮文案为“保存修订”和“重新发布”，状态按元数据显示“修订中”或“已发布”。“重新发布”先保存修订，再请求 impact 并打开确认弹窗；确认后调用既有发布回调，取消不触发发布。
- 影响弹窗显示当前/下一版本、内容变更节点数、新增节点数、需重新提交节点数和受影响学生数，并明确说明受影响提交仅作为审计历史保留。
- 发布态节点检查器中的 deadline 字段只读，并引导至“填写进度”；运行时 deadline 更新不写回修订内容。

## 验证结果

- `cd frontend && node --experimental-strip-types --test tests/*.test.ts`：19/19 通过。
- `cd frontend && npm run build`：TypeScript 与 Vite production build 通过。
- `git diff --check`：通过，无输出。
- 浏览器测试由主代理统一执行，本子任务未执行浏览器测试。
