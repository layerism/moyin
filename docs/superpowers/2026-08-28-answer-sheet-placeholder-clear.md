# 答题卡默认文字首次编辑清理

## 目标

将单选题和多选题的题干、选项默认文字从业务内容改为纯 UI 占位提示。教师点击题干或选项进入 Markdown 源码编辑态时，输入区为空并直接获得光标。

## 根因

- `createAnswerSheetQuestion()` 当前把“请输入题干”“选项 1”“选项 2”写入题目配置。
- `SelectionEditor` 当前把“新增选项”写入新增选项配置。
- `MarkdownBlurEditor` 进入源码态时原样使用这些配置值，因此默认文字不会在点击后消失。
- 这些默认文字是非空字符串，会被现有题目发布校验当作真实内容。

## 交互与数据规则

- 新建单选题或多选题时，题干与两个初始选项的 `content` 均为空字符串。
- 添加新选项时，新选项的 `content` 为空字符串。
- 失焦预览继续显示“请输入题干”或按当前位置生成的“选项 N”占位提示。
- 点击或使用键盘进入源码编辑态后，空内容不显示占位文字；输入区保持空白并获得焦点。
- 兼容现有草稿：题干值恰为“请输入题干”，或选项值恰为“选项 1”“选项 2”“新增选项”时，首次进入编辑态将其清为空字符串。
- 其他题干与选项内容保持不变。
- 填空题题干包含稳定的 `[[blank:...]]` 结构标记，不属于本次清理范围。

## 修改范围

- `frontend/src/features/academic-flow/answerSheet.ts`
- `frontend/src/features/academic-flow/AnswerSheetEditor.tsx`
- `frontend/src/features/academic-flow/MarkdownBlurEditor.tsx`
- `frontend/src/features/academic-flow/markdownBlurEditor.ts`
- `frontend/tests/answerSheet.test.ts`

不修改数据结构、后端接口、学生端渲染、Markdown 解析链、CSS 或判分规则。

## Markdown 边界

- 保持支持：纯文本、一二级标题、粗体、斜体、有序与无序列表、引用、GFM 表格、行内与块级代码、行内与块级数学公式。
- 保持禁用或降级：链接、图片、原始 HTML、删除线、任务列表、脚注、分隔线、三级及以下标题。

## 验证边界

依照项目规范，不运行测试、类型检查或浏览器自动化。实现时先同步纯逻辑回归测试，再进行调用链审计、任务文件差异检查、`git diff --check`、限定缓存清理、本地服务重启及 5173/8000 监听进程核对。
