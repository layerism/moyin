# 学生行级延期设置实施报告

## 实现内容

- 教师进度接口为每名学生返回节点摘要：节点键、标题、运行状态、统一截止时间、个别覆盖截止时间和实际生效截止时间；未返回草稿、提交内容或其他学生数据。
- 现有 `set_student_deadline` 在 `BEGIN IMMEDIATE` 写事务内校验教师拥有已发布版本、节点存在、未通过状态、当前有效截止时间、带时区 ISO 时间、服务器当前时间、严格单调延后和去空白后的延期原因；合法值以 UTC ISO 时间和清理后的原因写入覆盖表与审计日志。
- 路由将延期业务校验转换为可展示的 HTTP 422，实例或节点不可见仍在查询阶段返回 404。
- 教师端延期入口已移动到学生表格操作列；同一时刻仅一名学生展开。节点筛选仅包含未通过且已有实际生效截止时间的节点；切换学生、关闭和取消均清空草稿。
- 行内表单包含固定学生信息、节点、当前生效截止时间、新时间、必填原因和保存/取消；无可延期节点时只显示空状态与取消。保存成功后收起再刷新，刷新失败明确提示写入已经成功。
- 新增行内表单、键盘焦点、禁用态和窄屏单列样式，且保留表格横向滚动。

## 修改文件

- `backend/app/repositories/flow_instances.py`
- `backend/app/api/routes/workflow_admin.py`
- `frontend/src/features/academic-flow/runtimeTypes.ts`
- `frontend/src/features/academic-flow/TeacherProgressPanel.tsx`
- `frontend/src/styles.css`

## 未运行验证

- 按绑定约束，未运行测试、构建、浏览器、Playwright 或服务。
- 按绑定约束，未暂存、提交、重启服务或清理缓存。

## 静态审计结果

- `git diff --check`（限定五个生产文件）通过，无空白错误。
- 差异范围仅包含五个计划列出的生产文件；`AGENTS.md`、`docs/05_oa_graph.md` 和既有 `.superpowers/` 改动保持未触及、未暂存。
- 调用链搜索确认唯一延期写入入口仍为 `set_student_deadline`，前端继续复用 `workflowApi.setStudentDeadline`。
- 后端静态检查确认 404 所需的实例/教师/已发布版本查询先于业务字段校验；已通过、无截止时间、无时区/非法时间、过去时间、相等时间和缩短时间均被拒绝，存储值统一使用 `normalized_deadline` 与 `clean_reason`。
- 前端静态检查确认 `expandedInstanceId` 只有一个展开行、切换清空草稿、空表格 `colSpan={6}`、保存后刷新失败单独提示；`pending_node_status` 仍带入节点起始时间与 DAG 前置状态重算。

## 自审与 Concerns

- 实现未增加依赖、API 路径、数据库结构或额外生产文件，且未改变学生端、流程版本、DAG、提交内容或下游节点状态。
- 未做运行时或渲染验证；主代理应在统一重启后手测：过期节点延期后的 draft/available/scheduled/locked 重算、并发提交时后端 422、权限 404、无节点空态、页面窄屏和保存后刷新失败提示。
