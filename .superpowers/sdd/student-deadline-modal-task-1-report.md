# 学生节点延期二级弹窗：任务 1 实施报告

## 实施摘要

- 将 `TeacherProgressPanel` 的表格行内延期编辑改为全视口二级弹窗；学生行保持为单一 `<tr>`，不再插入跨列表单行。
- 以 `editingInstanceId` 表示当前编辑学生，打开时初始化首个符合既有规则的可延期节点与草稿；关闭时清空草稿并将焦点恢复至相应的“设置延期”触发按钮。
- 二级弹窗打开期间锁定 `document.body` 滚动；全视口遮罩的层级高于进度侧栏，且未注册遮罩关闭事件，因此背景点击保持无效。
- 保留既有 `setStudentDeadline` 调用、输入校验、成功刷新、刷新失败提示与失败时保留输入行为。

## 静态审计

| 命令 | 结果 |
| --- | --- |
| `git status --short` 与 `git diff -- frontend/src/features/academic-flow/TeacherProgressPanel.tsx frontend/src/styles.css`（编辑前） | 两个目标文件均无既有未提交修改；工作区其他修改未触及。 |
| `rg -n "expandedInstanceId|toggleExtension|student-extension-row|student-extension-card" frontend/src/features/academic-flow/TeacherProgressPanel.tsx frontend/src/styles.css` | 无匹配。 |
| `rg -n "editingInstanceId|openExtension|student-extension-backdrop|student-extension-dialog|student-extension-actions" frontend/src/features/academic-flow/TeacherProgressPanel.tsx frontend/src/styles.css` | 发现连贯的状态、打开、渲染与样式路径。 |
| `rg -n "setStudentDeadline|minimumExtensionValue|请选择新的截止时间|请填写延期原因|新的截止时间必须晚于" frontend/src/features/academic-flow/TeacherProgressPanel.tsx` | 既有 API 调用、最小时间值与四项校验提示均存在。 |
| `git diff --check -- frontend/src/features/academic-flow/TeacherProgressPanel.tsx frontend/src/styles.css` | 无输出，未发现空白错误。 |
| `git diff -- frontend/src/features/academic-flow/TeacherProgressPanel.tsx frontend/src/styles.css` | 仅包含批准的组件与样式模态化改动。 |

未运行自动化测试、构建、类型检查、浏览器工具或服务重启，符合任务边界。

## 变更文件

- `frontend/src/features/academic-flow/TeacherProgressPanel.tsx`
- `frontend/src/styles.css`

## 自查结论

- 焦点：打开后使用 `requestAnimationFrame` 聚焦对话框；关闭时按已保存的学生实例 ID 定位触发按钮并恢复焦点。
- 滚动：打开时保存并覆盖 `document.body.style.overflow`，effect 清理时恢复原值；对话框内容区独立纵向滚动并使用 `overscroll-behavior: contain`。
- 背景隔离：二级遮罩 `z-index: 150`，高于进度侧栏遮罩的 `z-index: 120`，覆盖视口；遮罩本身无点击或鼠标关闭处理。进度侧栏在弹窗开启时设置 `aria-hidden`。
- 响应式：桌面端字段为两列，`max-width: 760px` 时切换为单列；操作区变为等宽双按钮网格并限制按钮最小宽度，避免文字裁切。
- 范围：未改动后端、接口、数据模型、依赖或其他 UI。

## 关注事项

无阻塞关注事项。尚需由控制器重启服务后，交由用户完成真实浏览器中的十项验收标准手测。

## 焦点隔离修正（静态复核后追加）

- 在 `TeacherProgressPanel.tsx` 的二级弹窗上增加本地 `handleExtensionDialogKeyDown`。该处理器只拦截 `Tab`：对话框容器获得焦点时，`Tab` 转至首个可聚焦控件，`Shift+Tab` 转至末个控件；首/末控件分别向后/向前循环，阻止焦点进入 `aria-hidden` 的进度面板或底层页面。
- 未处理 `Escape`；遮罩仍无关闭监听，因此仍只有右上角关闭按钮和“取消”按钮可关闭弹窗。

| 命令 | 结果 |
| --- | --- |
| `rg -n "handleExtensionDialogKeyDown|onKeyDown=\\{handleExtensionDialogKeyDown\\}|editingInstanceId|openExtension|student-extension-backdrop|student-extension-dialog|student-extension-actions" frontend/src/features/academic-flow/TeacherProgressPanel.tsx frontend/src/styles.css` | 确认本地焦点循环已定义并挂载在二级对话框，原模态状态和样式路径完整。 |
| `rg -n "expandedInstanceId|toggleExtension|student-extension-row|student-extension-card" frontend/src/features/academic-flow/TeacherProgressPanel.tsx frontend/src/styles.css` | 无匹配。 |
| `rg -n "setStudentDeadline|minimumExtensionValue|请选择新的截止时间|请填写延期原因|新的截止时间必须晚于" frontend/src/features/academic-flow/TeacherProgressPanel.tsx` | 既有 API 调用和全部延期校验仍存在。 |
| `git diff --check -- frontend/src/features/academic-flow/TeacherProgressPanel.tsx frontend/src/styles.css` | 无输出，未发现空白错误。 |

本次仅修改 `TeacherProgressPanel.tsx` 和本报告；未运行测试、构建、类型检查、浏览器工具、服务重启，也未暂存或提交。

## JSX 可读性整理

- 仅调整 `teacher-progress-panel` 的 `<aside>` 子树缩进，使标题、提示、表格和闭合标签与外围 JSX 层级一致；未改变任何运行时行为。
- `git diff --check -- frontend/src/features/academic-flow/TeacherProgressPanel.tsx frontend/src/styles.css` 无输出。
