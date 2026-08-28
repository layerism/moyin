# Single Markdown Fill Blank Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将新填空题改为单一 Markdown 答题区，并按师生 Markdown 原文去除首尾空白后精确自动判分，同时保持已发布 v1 答题卡不变。

**Architecture:** 新协议使用 `schemaVersion="2.0"` 与 `graderVersion="answer-sheet-v2"`，并用 `format="single_markdown_exact"` 区分新填空题；v2 仍可承载原样保留的 v1 填空题，使修订流程可以混用新旧题。前端在可编辑草稿中仅安全升级单空、尚未配置答案且非大小写敏感的旧题；后端按协议与题目格式分发校验、提交归一化和确定性判分。

**Tech Stack:** React 19、TypeScript、现有 `MarkdownBlurEditor` / `AnswerSheetMarkdown`、FastAPI 领域服务、Python、openpyxl。

**Spec:** `docs/superpowers/specs/2026-08-29-single-markdown-fill-blank-design.md`

## Global Constraints

- 新填空题只允许一个 Markdown 答案，判分表达式为 `studentAnswer.trim() === standardAnswer.trim()`。
- 不做大小写折叠、Unicode 归一化、内部空白归一化、渲染结果比较、多个标准答案、部分得分或 LLM 判分。
- 已发布的 `schemaVersion="1.0"` 快照、`answer-sheet-v1` 判分器、历史提交和历史成绩保持不变。
- 教师真实学生预览与正式学生端必须继续复用同一运行时组件和数据契约。
- Markdown 编辑继续使用单一源码编辑区，失焦后原位渲染，不增加工具栏，不改变 `react-markdown`、`remark-math`、`rehype-katex` 共享链。
- 只修改本计划列出的答题卡文件；保留工作区既有无关修改。
- 遵守项目规则：修改过程中不运行测试、TypeScript 构建或浏览器验证；完成后只做静态业务审计、本地重启和缓存清理。
- 本次代码实现只产生一个结果提交；不得在任务中间提交。

---

### Task 1: 建立 v2 前端契约和安全草稿升级

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/features/academic-flow/answerSheet.ts`
- Modify: `frontend/src/features/academic-flow/answerSheetEditorState.ts`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Modify: `frontend/src/features/academic-flow/AnswerSheetEditor.tsx`

**Interfaces:**
- Produces: `AnswerSheetSingleMarkdownFillBlankQuestion`，字段为 `type: "fill_blank"`、`format: "single_markdown_exact"`、`content`、`id`、`points`、`required`。
- Produces: `isSingleMarkdownFillBlankQuestion(question): question is AnswerSheetSingleMarkdownFillBlankQuestion`。
- Produces: `upgradeAnswerSheetAuthoring(config, key): AnswerSheetAuthoring`；返回 v2 契约，并只转换满足设计文档四项安全条件的旧填空题。
- Consumes: 后续教师编辑、学生运行时、分值汇总和提交校验均通过类型守卫分发新旧结构。

- [x] **Step 1: 将填空题类型拆成旧版与单 Markdown 联合类型**

在 `types.ts` 保留现有 `AnswerSheetBlank`，将当前填空结构命名为 `AnswerSheetLegacyFillBlankQuestion`，新增：

```ts
export type AnswerSheetSingleMarkdownFillBlankQuestion = {
  content: string;
  format: "single_markdown_exact";
  id: string;
  points: number;
  required: boolean;
  type: "fill_blank";
};

export type AnswerSheetFillBlankQuestion =
  | AnswerSheetLegacyFillBlankQuestion
  | AnswerSheetSingleMarkdownFillBlankQuestion;
```

把 `AnswerSheetConfig.schemaVersion` 扩为 `"1.0" | "2.0"`。私有填空答案增加联合分支：

```ts
{
  answerMarkdown: string;
  format: "single_markdown_exact";
  type: "fill_blank";
}
```

`AnswerSheetPrivateKey` 和 `AnswerSheetGrade` 的协议字段分别扩为 v1/v2 字面量联合；不改变选择题答案、成绩汇总和逐题结果字段。

- [x] **Step 2: 让新答题卡和新填空题直接使用 v2**

在 `answerSheet.ts` 将 `createDefaultAnswerSheet()` 生成的版本改为：

```ts
schemaVersion: "2.0"
graderVersion: "answer-sheet-v2"
```

`createAnswerSheetQuestion("fill_blank")` 返回：

```ts
{
  content: "",
  format: "single_markdown_exact",
  id,
  points: 1,
  required: true,
  type: "fill_blank",
}
```

`createPrivateAnswer()` 对该结构返回空 `answerMarkdown`；对旧结构继续返回 `blanks` 映射。

- [x] **Step 3: 增加统一类型守卫和 v2 分值/校验分发**

在 `answerSheet.ts` 导出：

```ts
export function isSingleMarkdownFillBlankQuestion(
  question: AnswerSheetQuestion,
): question is AnswerSheetSingleMarkdownFillBlankQuestion {
  return question.type === "fill_blank"
    && "format" in question
    && question.format === "single_markdown_exact";
}
```

`answerSheetMaxScore()` 对新填空读取 `question.points`，对旧填空累加 `blanks`。`validateAnswerSheetAuthoring()` 对新填空检查正整数分值、私有答案 `format` 一致且 `answerMarkdown.trim()` 非空；旧填空继续调用既有标记/逐空校验。`validateAnswerSheetSubmission()` 对新填空只接受 `{answerMarkdown: string}`，必答时使用 `trim()` 判断空值；旧提交继续接受 `blankValues`。

- [x] **Step 4: 实现安全草稿升级**

在 `answerSheet.ts` 增加 `upgradeAnswerSheetAuthoring()`：

```ts
export function upgradeAnswerSheetAuthoring(
  config: AnswerSheetConfig,
  key: AnswerSheetPrivateKey,
): AnswerSheetAuthoring
```

对每个旧填空题，只有在恰好一个 blank、`caseSensitive === false`、尚未配置非空有效答案、标记恰好出现一次时，才转换为新结构；题干移除 marker，分值取原 blank 分值，标准答案初始化为空字符串。已配置答案的旧题仍包含大小写折叠与 Unicode 归一化语义，必须原样保留。只要进入可编辑草稿，返回契约统一写成 v2；输入对象不得原地修改。

- [x] **Step 5: 在编辑入口使用升级后的契约**

`AnswerSheetEditor` 在 `disabled === false` 时以 `upgradeAnswerSheetAuthoring(config, gradingKey)` 的结果作为本次渲染和后续 `onChange` 基础；只读时保持传入 v1 原样。`AcademicFlowDesigner.addNode()` 创建答题卡密钥时改为 v2 字面量，避免新节点出现公私版本不一致。

- [x] **Step 6: 更新折叠摘要**

`getAnswerSheetQuestionMeta()` 对新填空返回 ``${question.points} 分``；旧填空返回 ``${points} 分 · 旧版填空``；选择题摘要不变。

### Task 2: 收敛教师端为题干、整题分值和一个标准答案

**Files:**
- Modify: `frontend/src/features/academic-flow/AnswerSheetEditor.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: Task 1 的新填空题类型守卫与私有 `answerMarkdown` 分支。
- Produces: 新 `SingleMarkdownFillBlankEditor`，只编辑一个标准答案；既有 `FillBlankEditor` 仅服务未安全升级的旧题。

- [x] **Step 1: 让新填空题显示整题分值**

在题目设置行中，选择题和新填空题都显示 `answer-sheet-question-points`；只有旧填空题继续隐藏整题分值。分值输入更新 `question.points`，必答仍靠右显示，从而与截图中的独立逐空分值相比更紧凑。

- [x] **Step 2: 清除题干标记交互**

新填空题的 `MarkdownBlurEditor` 使用 `placeholder="请输入题干"`，不提供 `clearOnEditValues` 中的标记文案。旧题继续保留旧编辑器，防止无法安全迁移的数据丢失。

- [x] **Step 3: 增加单标准答案 Markdown 编辑区**

新增同文件组件：

```tsx
function SingleMarkdownFillBlankEditor({ answer, disabled, onAnswerChange }: {
  answer: AnswerSheetPrivateAnswer;
  disabled: boolean;
  onAnswerChange: (answer: AnswerSheetPrivateAnswer) => void;
})
```

组件标题显示“标准答案”，说明显示“去除首尾空白后精确匹配”，并使用：

```tsx
<MarkdownBlurEditor
  disabled={disabled}
  onChange={(answerMarkdown) => onAnswerChange({
    answerMarkdown,
    format: "single_markdown_exact",
    type: "fill_blank",
  })}
  placeholder="请输入标准答案"
  value={singleAnswer?.answerMarkdown ?? ""}
/>
```

新题只渲染此组件；`[[blank:id]]`、添加/删除空、可接受答案 textarea 和大小写控件均不出现在新题中。

- [x] **Step 4: 收敛样式**

新增 `.answer-sheet-single-answer-editor` 和标题说明样式，复用现有白底、灰边框、蓝色焦点以及 `.markdown-blur-*`。删除不再被新题使用但仍被旧题依赖的规则之前，先保留 `.answer-sheet-blank-*`、`.answer-sheet-accepted-answers`、`.answer-sheet-case-sensitive`，确保旧题兼容；仅让新编辑区使用单列紧凑布局。

### Task 3: 学生端使用一个 Markdown 答题区

**Files:**
- Modify: `frontend/src/features/academic-flow/RuntimeAnswerSheet.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: Task 1 的 `isSingleMarkdownFillBlankQuestion()` 和 `{answerMarkdown}` 提交契约。
- Produces: 新填空题的可编辑/只读统一 Markdown 区；旧填空题仍使用 `FillQuestion` 行内输入。

- [x] **Step 1: 分发新旧填空题运行时**

在 `RuntimeAnswerSheet` 中，新填空题先渲染题干 `AnswerSheetMarkdown`，再渲染 `MarkdownBlurEditor`：

```tsx
<MarkdownBlurEditor
  disabled={readonly}
  onChange={(answerMarkdown) => update(question.id, { answerMarkdown })}
  placeholder="请输入 Markdown 答案"
  value={typeof answer.answerMarkdown === "string" ? answer.answerMarkdown : ""}
/>
```

旧填空题继续调用当前 `FillQuestion` 并提交 `{blankValues}`。新题错误挂在 `errors[question.id]`，不再产生 `questionId:blankId` 字段。

- [x] **Step 2: 更新分值与标准答案格式化**

`questionPoints()` 对新题读取 `points`，旧题累加 blanks。`formatStandardAnswer()` 对新的私有答案返回 `answerMarkdown`，选择题与旧题保持现有格式。

- [x] **Step 3: 让标准答案通过 Markdown 渲染器显示**

`AnswerSheetGradeResult` 的每个标准答案列表项拆成题号文本和 `<AnswerSheetMarkdown>`，避免把新标准答案作为普通文本输出；选择题和旧填空题也沿用同一安全渲染链。

- [x] **Step 4: 增加运行时 Markdown 答案样式**

新增 `.runtime-markdown-answer`，使用与题目卡片一致的边框、圆角和最小高度；其内部 `.markdown-blur-source` 与 `.markdown-blur-preview` 宽度为 100%，只读时不出现可编辑焦点语义。不得改动只读答题卡统一宽度规则。

### Task 4: 后端按 v1/v2 和新旧填空格式确定性判分

**Files:**
- Modify: `backend/app/domain/answer_sheet.py`

**Interfaces:**
- Produces: v1/v2 版本映射；公开配置、私有答案、提交和判分结果均按节点实际 `schemaVersion` 分发。
- Consumes: 新填空公开字段 `{format, points}`、私有字段 `{type, format, answerMarkdown}`、提交字段 `{answerMarkdown}`。

- [x] **Step 1: 建立协议版本映射**

用不可变映射替代单一常量：

```py
ANSWER_SHEET_GRADERS = {
    "1.0": "answer-sheet-v1",
    "2.0": "answer-sheet-v2",
}
```

公开配置只接受映射中的版本；私有 key 必须使用对应 grader。v1 公开题只允许旧填空结构；v2 允许新格式和原样保留的旧填空结构。

- [x] **Step 2: 校验新填空公开与私有结构**

当 `question.get("format") == "single_markdown_exact"` 时，公开字段必须恰为公共字段加 `{"format", "points"}`，`points` 必须是正整数。私有答案必须恰为：

```py
{
    "type": "fill_blank",
    "format": "single_markdown_exact",
    "answerMarkdown": str,
}
```

可发布状态下 `answerMarkdown.strip()` 不得为空，且私有/公开 `format` 必须一致。旧填空继续调用现有 blanks 校验。

- [x] **Step 3: 归一化新提交但保留原文**

`_normalize_question_submission()` 对新填空只接受单键 `answerMarkdown`。值必须为字符串；必答且 `answerMarkdown.strip()` 为空时报“请输入答案”；非必答空答案返回 `None`；有效答案原文写回，不在归一化结果中调用 `strip()`。

- [x] **Step 4: 实现精确判分**

`_grade_question()` 对新填空执行：

```py
actual = str((answer or {}).get("answerMarkdown", "")).strip()
expected = str(private["answerMarkdown"]).strip()
correct = actual == expected
return _selection_result(question["id"], int(question["points"]), correct)
```

不得复用 `_normalize_fill_text()`，因为旧函数包含换行规范化、NFC 与可选 casefold。旧填空继续生成 `blankResults`，新填空只生成整题结果。

- [x] **Step 5: 让总分和成绩版本跟随节点协议**

`answer_sheet_max_score()` 对新填空读取 `points`，对旧填空累加 blanks。`grade_answer_sheet()` 返回当前节点 schema 和其映射 grader，不把标准答案写入成绩快照；v1 结果字段保持原值。

### Task 5: 更新 Excel 导出并完成静态业务审计

**Files:**
- Modify: `backend/app/services/node_submission_workbook.py`
- Modify: `docs/superpowers/specs/2026-08-29-single-markdown-fill-blank-design.md`
- Modify: `docs/superpowers/plans/2026-08-29-single-markdown-fill-blank.md`

**Interfaces:**
- Consumes: v2 新填空的 `points`、`answerMarkdown` 标准答案与学生提交。
- Produces: Excel 中单字段 Markdown 答案和与运行时一致的整题分值。

- [x] **Step 1: 更新题目和标准答案导出**

`_question_points()` 对新填空返回 `question["points"]`；旧题继续累加 blanks。`_format_answer_sheet_standard()` 对 `single_markdown_exact` 返回原始 `answerMarkdown`；旧填空仍按 blank ID 和答案数组格式化。

- [x] **Step 2: 更新学生答案导出**

`_format_answer_sheet_answer()` 对新填空返回学生原始 `answerMarkdown`，对旧题继续格式化 `blankValues`。未提交学生仍由现有名单导出逻辑写空字段。

- [x] **Step 3: 做跨层静态契约审计**

只运行只读搜索和差异检查，不运行测试、构建或浏览器插件：

```bash
rg -n "single_markdown_exact|answer-sheet-v2|answerMarkdown" frontend/src backend/app
rg -n "\[\[blank:|caseSensitive|acceptedAnswers|blankValues" frontend/src backend/app
git diff --check
git diff -- frontend/src/types.ts frontend/src/features/academic-flow/answerSheet.ts frontend/src/features/academic-flow/answerSheetEditorState.ts frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/features/academic-flow/AnswerSheetEditor.tsx frontend/src/features/academic-flow/RuntimeAnswerSheet.tsx frontend/src/styles.css backend/app/domain/answer_sheet.py backend/app/services/node_submission_workbook.py
```

逐项确认每个旧字段命中均位于 legacy 分支；新题在教师端、学生端、后端和导出中使用完全相同的字段名与判分边界。

- [x] **Step 4: 更新文档状态**

将设计文档状态改为“已批准并完成实现”，在本计划对应步骤勾选全部复核完成项。不得把测试或浏览器验证描述为已执行。

- [x] **Step 5: 清理项目缓存并本地重启**

先用只读命令解析 8000/5173 监听 PID 与 cwd，只停止确认属于 `/ai/github-repo/moyin` 的进程；清理项目内 `.pytest_cache`、`__pycache__`、`*.egg-info`。后端从 `backend/` 使用 `../.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`，前端先执行 `export PATH="$PWD/.local/node/bin:$PATH"`，再运行 `npm run dev -- --host 0.0.0.0`。只确认监听状态，不发送 HTTP 请求。

- [x] **Step 6: 创建唯一结果提交**

仅暂存本计划列出的代码与文档文件，复核暂存列表不包含工作区原有修改，然后提交：

```bash
git commit -m "feat: add single markdown fill blank"
```
