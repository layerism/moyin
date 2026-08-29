# Multiple Accepted Markdown Answers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为单 Markdown 填空题增加多个独立可接受答案，学生答案去除首尾空白后命中任一项即得满分，并保持 v1/v2 已发布快照与历史成绩不变。

**Architecture:** 新增 `schemaVersion="3.0"` 与 `graderVersion="answer-sheet-v3"`，将 v3 私有答案建模为 `acceptedAnswerMarkdowns: string[]`；公开题目和学生提交仍保持单 Markdown 结构。前端将可编辑 v2 草稿安全升级为单元素数组，后端根据快照版本严格分发 v2 单答案和 v3 任一命中判分。

**Tech Stack:** React、TypeScript、现有 `MarkdownBlurEditor` / `AnswerSheetMarkdown`、FastAPI 领域服务、Python、openpyxl。

**Spec:** `docs/superpowers/specs/2026-08-29-answer-sheet-multiple-accepted-markdown-answers-design.md`

## Global Constraints

- 普通标准答案行的渲染态与编辑态最小高度均为 38px；多行内容达到局部最大高度后滚动。
- 学生提交继续使用 `{ "answerMarkdown": string }`，不得向学生公开可接受答案数量。
- v3 仅执行去除首尾空白后的源码精确匹配；区分大小写，不归一化内部空白、Unicode、数值、代数或 Markdown 渲染结果。
- v1/v2 已发布快照、提交和成绩不迁移、不重写、不重新计算。
- v3 标准答案反馈按编号独立渲染；Excel 使用 JSON 数组保存答案边界。
- 保留 `react-markdown`、`remark-math`、`rehype-katex` 共享解析链，不新增依赖。
- 不修改数据库表、学生提交结构、DAG、及格线、作答次数或反馈策略。
- 保留工作区已有无关修改，只暂存本计划列出的文件。
- 遵守仓库规则：修改过程中不运行测试、TypeScript 构建或浏览器检查；只进行静态业务审计。
- 本计划文档提交作为实施前 checkpoint；全部代码完成后只创建一个结果提交，中间不提交。

---

### Task 1: 建立 v3 前端协议与安全草稿升级

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/features/academic-flow/answerSheet.ts`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`

**Interfaces:**
- Produces: `AnswerSheetPrivateAnswer` 的 v3 分支 `{ acceptedAnswerMarkdowns: string[]; format: "single_markdown_exact"; type: "fill_blank" }`。
- Produces: `AnswerSheetConfig.schemaVersion`、`AnswerSheetPrivateKey`、`AnswerSheetGrade` 对 `3.0` / `answer-sheet-v3` 的类型支持。
- Produces: `upgradeAnswerSheetAuthoring()` 将 v2 `answerMarkdown` 安全转换为 v3 单元素数组。
- Consumes: Task 2 教师编辑器、Task 3 反馈页和 Task 4 后端使用相同字段名。

- [ ] **Step 1: 扩展类型联合并保留 v2 读取分支**

在 `frontend/src/types.ts` 中将版本联合扩为：

```ts
schemaVersion: "1.0" | "2.0" | "3.0";
graderVersion: "answer-sheet-v1" | "answer-sheet-v2" | "answer-sheet-v3";
```

保留现有 v2 私有答案，并新增 v3 分支：

```ts
| {
    answerMarkdown: string;
    format: "single_markdown_exact";
    type: "fill_blank";
  }
| {
    acceptedAnswerMarkdowns: string[];
    format: "single_markdown_exact";
    type: "fill_blank";
  }
```

- [ ] **Step 2: 让新答题卡和新标准答案使用 v3**

在 `createDefaultAnswerSheet()` 中写入 `schemaVersion: "3.0"`、`graderVersion: "answer-sheet-v3"`。`createPrivateAnswer()` 对单 Markdown 填空返回：

```ts
{
  acceptedAnswerMarkdowns: [""],
  format: "single_markdown_exact",
  type: "fill_blank",
}
```

在 `AcademicFlowDesigner.tsx` 的新答题卡节点密钥字面量中同步使用 v3。

- [ ] **Step 3: 将可编辑旧草稿统一升级为 v3**

将 `upgradeAnswerSheetAuthoring()` 的目标版本改为 v3。遍历单 Markdown 题的私有答案：

```ts
if (answer?.type === "fill_blank" && "answerMarkdown" in answer) {
  answers[question.id] = {
    acceptedAnswerMarkdowns: [answer.answerMarkdown],
    format: "single_markdown_exact",
    type: "fill_blank",
  };
}
```

已经包含 `acceptedAnswerMarkdowns` 的答案保持原数组；选择题和不能安全升级的 v1 旧版填空保持原结构。`upgradeLegacyFillBlankQuestion()` 新生成的单 Markdown 私钥直接使用 `acceptedAnswerMarkdowns: [""]`。

- [ ] **Step 4: 更新前端发布校验**

`validateSingleMarkdownFillQuestion()` 对可编辑 v3 私钥执行：

```ts
const accepted = privateAnswer?.type === "fill_blank"
  && "acceptedAnswerMarkdowns" in privateAnswer
  ? privateAnswer.acceptedAnswerMarkdowns
  : null;
const normalized = accepted?.map((value) => value.trim()) ?? [];
```

拒绝数组缺失、空数组、非字符串、空字符串以及 `new Set(normalized).size !== normalized.length`。错误文案分别为“至少需要一个可接受答案”“可接受答案不能为空”“可接受答案不能重复”。学生提交校验保持 `answerMarkdown` 不变。

- [ ] **Step 5: 静态核对前端版本边界**

运行只读搜索：

```bash
rg -n 'schemaVersion: "2\.0"|graderVersion: "answer-sheet-v2"|answerMarkdown|acceptedAnswerMarkdowns' frontend/src
```

逐项确认保留的 v2 字段只服务只读历史数据，所有新建与可编辑路径均输出 v3。

### Task 2: 实现紧凑独立答案行教师 UI

**Files:**
- Modify: `frontend/src/features/academic-flow/MarkdownBlurEditor.tsx`
- Modify: `frontend/src/features/academic-flow/AnswerSheetEditor.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: Task 1 的 `acceptedAnswerMarkdowns` v3 分支。
- Produces: `MarkdownBlurEditor` 新可选属性 `editRequest?: number`，数值增加时进入源码编辑态。
- Produces: `SingleMarkdownFillBlankEditor` 的追加、删除、逐项修改和局部错误展示。

- [ ] **Step 1: 为原位编辑器增加显式编辑请求**

在 `MarkdownBlurEditor` 属性中增加 `editRequest = 0`，并加入：

```ts
useEffect(() => {
  if (editRequest > 0 && !disabled) setFocused(true);
}, [disabled, editRequest]);
```

现有调用不传该属性时行为保持不变。

- [ ] **Step 2: 将单答案编辑器改为答案数组列表**

`SingleMarkdownFillBlankEditor` 读取：

```ts
const acceptedAnswers = answer.type === "fill_blank"
  ? "acceptedAnswerMarkdowns" in answer
    ? answer.acceptedAnswerMarkdowns
    : "answerMarkdown" in answer
      ? [answer.answerMarkdown]
      : [""]
  : [""];
```

所有修改统一写回 v3：

```ts
onAnswerChange({
  acceptedAnswerMarkdowns: nextAnswers,
  format: "single_markdown_exact",
  type: "fill_blank",
});
```

每行渲染序号、`<MarkdownBlurEditor compact />` 和删除按钮。删除按钮在数组长度为 1 时禁用；添加按钮追加空字符串，并通过 `{ index, token }` 本地状态把递增 `token` 传给新行的 `editRequest`。

- [ ] **Step 3: 在答案行内标注空值与重复值**

组件内计算：

```ts
const normalized = acceptedAnswers.map((value) => value.trim());
const duplicateValues = new Set(
  normalized.filter((value, index) => value && normalized.indexOf(value) !== index),
);
```

空行显示“请输入答案”，重复行显示“与其他答案重复”；对应行增加 `is-invalid` 类。题目“确认”继续由 `validateAnswerSheetAuthoring()` 的全局校验阻止。

- [ ] **Step 4: 落实 A 方案紧凑样式**

在 `styles.css` 增加 `.answer-sheet-accepted-answer-list`、`.answer-sheet-accepted-answer-row`、`.answer-sheet-accepted-answer-index`、`.answer-sheet-accepted-answer-remove` 和 `.answer-sheet-add-accepted-answer`。答案行使用：

```css
.answer-sheet-accepted-answer-row .markdown-blur-source,
.answer-sheet-accepted-answer-row .markdown-blur-preview {
  min-height: 38px;
  max-height: 120px;
  overflow: auto;
  padding: 6px 8px;
}
```

移除 `.answer-sheet-single-answer-editor` 对 Markdown 区域的 `min-height: 48px` 覆盖。源码编辑态继承 14px 字号与现有 1.55 行高；错误行使用现有红色边框语义。

- [ ] **Step 5: 静态核对 UI 状态**

审读以下状态：一个空答案、三个有效答案、删除中间答案、重复答案、多行公式、只读 v2 单答案、只读 v3 多答案。确认只读 v2 不被写回，所有可编辑写入均为 v3。

### Task 3: 按编号展示允许反馈的标准答案

**Files:**
- Modify: `frontend/src/features/academic-flow/RuntimeAnswerSheet.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: v2 `answerMarkdown` 与 v3 `acceptedAnswerMarkdowns` 联合类型。
- Produces: `formatStandardAnswers(question, answer): string[]`。
- 学生填写组件与 `{ answerMarkdown }` 提交载荷保持不变。

- [ ] **Step 1: 将标准答案格式化函数改为数组返回值**

把 `formatStandardAnswer()` 改为 `formatStandardAnswers()`：选择题和 v1 旧版填空返回单元素数组；v2 单 Markdown 返回 `[answer.answerMarkdown]`；v3 返回 `answer.acceptedAnswerMarkdowns`；缺失或类型不匹配返回 `["未提供"]`。

- [ ] **Step 2: 让反馈页逐项渲染多答案**

每道题先显示题号，再对返回数组渲染嵌套列表：

```tsx
<ol className="answer-sheet-accepted-standard-list">
  {formatStandardAnswers(question, answer).map((markdown, answerIndex) => (
    <li key={answerIndex}>
      <span>答案 {answerIndex + 1}</span>
      <AnswerSheetMarkdown>{markdown}</AnswerSheetMarkdown>
    </li>
  ))}
</ol>
```

不得使用斜杠、分号或换行拼接多项 Markdown。

- [ ] **Step 3: 补充嵌套列表样式**

`.answer-sheet-accepted-standard-list` 使用紧凑网格；每项序号保持 12px 次要文字，Markdown 占据剩余宽度。保留现有 `.answer-sheet-standard-answers` 边框与题号层级。

- [ ] **Step 4: 静态核对反馈策略边界**

确认标准答案仍只由既有 `grade.standardAnswers` 控制：`score_only` 和未满足反馈条件时不新增答案数据，允许反馈时 v2 显示一项、v3 显示多项。

### Task 4: 实现后端 v3 严格校验与任一命中判分

**Files:**
- Modify: `backend/app/domain/answer_sheet.py`

**Interfaces:**
- Produces: `ANSWER_SHEET_GRADERS["3.0"] = "answer-sheet-v3"`。
- Produces: `_validate_private_question_answer(..., grader_version: str)` 严格区分 v2/v3 私钥字段。
- Produces: `_grade_question(..., grader_version: str)` 严格区分单答案与答案集合。
- Consumes: 学生提交仍为 `{ answerMarkdown: str }`。

- [ ] **Step 1: 注册 v3 并允许 v3 单 Markdown 公开题目**

扩展：

```py
ANSWER_SHEET_GRADERS = {
    "1.0": "answer-sheet-v1",
    "2.0": "answer-sheet-v2",
    "3.0": "answer-sheet-v3",
}
```

把公开题目限制改为 `single_markdown_fill and schema_version not in {"2.0", "3.0"}`；其他公开字段和学生提交归一化不变。

- [ ] **Step 2: 按评分器版本校验私有答案**

`validate_private_answer_key()` 将已校验的 `graderVersion` 传给 `_validate_private_question_answer()`。对于单 Markdown 题：

```py
if grader_version == "answer-sheet-v3":
    expected_keys = {"type", "format", "acceptedAnswerMarkdowns"}
else:
    expected_keys = {"type", "format", "answerMarkdown"}
```

v3 数组必须非空，所有元素必须为非空字符串，且 `trim()` 后集合大小等于数组长度；v2 继续要求一个非空 `answerMarkdown`。禁止两种字段同时存在。

- [ ] **Step 3: 按评分器版本执行确定性判分**

`grade_answer_sheet()` 将 `key["graderVersion"]` 传给 `_grade_question()`。单 Markdown 分支执行：

```py
actual = str((answer or {}).get("answerMarkdown", "")).strip()
accepted = (
    [str(value).strip() for value in private["acceptedAnswerMarkdowns"]]
    if grader_version == "answer-sheet-v3"
    else [str(private["answerMarkdown"]).strip()]
)
correct = actual in accepted
```

继续调用 `_selection_result()` 给予整题满分或 0 分。不得复用旧版 `_normalize_fill_text()`，以免引入大小写或 Unicode 归一化。

- [ ] **Step 4: 静态审计版本闭环**

逐条审读 `validate_public_answer_sheet()`、`validate_private_answer_key()`、`normalize_answer_sheet_submission()`、`grade_answer_sheet()` 和 `_grade_question()`，确认公开版本、私钥版本、评分器版本和结果快照版本始终一致。

### Task 5: 导出、最终静态审计、提交与本地重启

**Files:**
- Modify: `backend/app/services/node_submission_workbook.py`
- Audit: all files from Tasks 1-4

**Interfaces:**
- Consumes: v2 `answerMarkdown` 与 v3 `acceptedAnswerMarkdowns`。
- Produces: v3 Excel “标准答案”单元格中的 JSON 数组字符串。

- [ ] **Step 1: 让标准答案导出保留数组边界**

在文件顶部增加 `import json`。`_format_answer_sheet_standard()` 对单 Markdown 题执行：

```py
accepted = answer.get("acceptedAnswerMarkdowns")
if isinstance(accepted, list):
    return json.dumps(accepted, ensure_ascii=False, separators=(",", ":"))
answer_markdown = answer.get("answerMarkdown")
return answer_markdown if isinstance(answer_markdown, str) else ""
```

学生答案导出 `_format_answer_sheet_answer()` 保持原始 `answerMarkdown`；得分、正确性和审核结论列不变。

- [ ] **Step 2: 执行允许的静态检查**

只运行：

```bash
git diff --check
rg -n '3\.0|answer-sheet-v3|acceptedAnswerMarkdowns|answerMarkdown' frontend/src backend/app
git diff -- frontend/src/types.ts frontend/src/features/academic-flow/answerSheet.ts frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/features/academic-flow/MarkdownBlurEditor.tsx frontend/src/features/academic-flow/AnswerSheetEditor.tsx frontend/src/features/academic-flow/RuntimeAnswerSheet.tsx frontend/src/styles.css backend/app/domain/answer_sheet.py backend/app/services/node_submission_workbook.py
```

不得运行测试、`tsc`、Vite build 或浏览器验证。人工核对：新建 v3、v2 草稿升级、v2 只读、v1 旧题、空值、重复值、任一命中、反馈策略和 Excel JSON 数组。

- [ ] **Step 3: 清理限定缓存**

只列出并删除项目自身、且不在 `.venv` / `node_modules` 内的 `.pytest_cache`、`__pycache__` 和 `*.egg-info`。不得删除业务存储、构建产物或依赖目录。

- [ ] **Step 4: 创建唯一结果提交**

只暂存 Tasks 1-5 列出的代码文件：

```bash
git add frontend/src/types.ts \
  frontend/src/features/academic-flow/answerSheet.ts \
  frontend/src/features/academic-flow/AcademicFlowDesigner.tsx \
  frontend/src/features/academic-flow/MarkdownBlurEditor.tsx \
  frontend/src/features/academic-flow/AnswerSheetEditor.tsx \
  frontend/src/features/academic-flow/RuntimeAnswerSheet.tsx \
  frontend/src/styles.css \
  backend/app/domain/answer_sheet.py \
  backend/app/services/node_submission_workbook.py
git commit -m "feat: support multiple accepted markdown answers"
```

不得暂存 `.gitignore`、`AGENTS.md`、`README.md`、`docker-compose.yml`、`INSTALL.md`、`assets/`、`storage/` 或 `.superpowers/`。

- [ ] **Step 5: 非 Docker 本地重启并核对进程**

先使用 `lsof`、`ps` 和 `/proc/<pid>/cwd` 确认 5173/8000 现有进程属于本项目，再停止明确 PID。然后分别启动：

```bash
cd /ai/github-repo/moyin/backend
./.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

```bash
cd /ai/github-repo/moyin/frontend
export PATH="$PWD/../.local/node/bin:$PATH"
npm run dev -- --host 0.0.0.0 --port 5173
```

最终用 `lsof` 和 `/proc/<pid>/cwd` 确认 5173 对应 `frontend/`、8000 对应 `backend/`；不主动发送 HTTP 请求。

- [ ] **Step 6: 交付验证边界与 URL**

报告设计 checkpoint、结果提交、静态检查结果、未运行的测试/构建/浏览器验证、服务 PID/端口/工作目录，并提供：

```text
http://localhost:5173/academic-flow/d2daabec-7b18-4375-920b-14c200f9d9e4
```
