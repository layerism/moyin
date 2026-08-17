# 学生端单选题下拉框实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将学生运行表单中的单项选择题改为单行原生下拉框，同时保持答案结构、校验规则和多选题行为不变。

**Architecture:** 只替换 `RuntimeFormFields` 的 `radio` 渲染分支，继续从 `selectedOptionId` 读取答案，并通过现有 `onUpdate` 写回相同对象。复用 `styles.css` 已存在的 `runtime-form-field-select` 样式，不新增组件、状态或接口。

**Tech Stack:** React 18、TypeScript、原生 HTML `<select>`、CSS

## Global Constraints

- 仅单项选择题改为下拉框；多项选择题继续使用复选框。
- 教师“学生预览”与学生实际填写页同步生效。
- 保留 `selectedOptionId`、`otherText`、草稿、提交和后端持久化格式。
- 保留现有失焦校验、错误文本关联和只读答案展示。
- 不修改数据库、后端接口、流程快照或表单字段配置结构。
- 不新增自定义下拉弹层，复用原生 `<select>` 和现有样式。
- 按项目约定不运行测试或浏览器自动化，只进行静态业务逻辑审计。
- 本计划提交作为实施前检查点；实现过程中不提交，完成后只创建一次结果提交。

---

### Task 1: 将单选按钮列表替换为原生下拉框

**Files:**
- Modify: `frontend/src/features/academic-flow/RuntimeFormFields.tsx:72-93`
- Reference only: `frontend/src/styles.css:5458-5472`
- Reference only: `frontend/src/features/academic-flow/formFields.ts:177-192`

**Interfaces:**
- Consumes: `selectedRadio: string | null`、`field.options`、`onBlur(fieldId)`、`onUpdate(answerKey, value, fieldId)`。
- Produces: 与现有逻辑相同的 `{ otherText: null, selectedOptionId: string }` 答案对象；不产生新类型或类名。

- [ ] **Step 1: 用受控 `<select>` 替换 `radio` 分支**

将 `RuntimeFormFields.tsx` 中 `field.type === "radio"` 的选项列表替换为：

```tsx
{field.type === "radio" ? (
  <div className="runtime-form-field-select">
    <select
      aria-describedby={error ? errorId : undefined}
      aria-label={field.label}
      value={selectedRadio ?? ""}
      onBlur={() => onBlur(field.id)}
      onChange={(event) => onUpdate(field.answerKey, {
        otherText: null,
        selectedOptionId: event.target.value,
      }, field.id)}
    >
      <option disabled value="">请选择</option>
      {(field.options ?? []).map((option) => (
        <option key={option.id} value={option.id}>{option.label}</option>
      ))}
    </select>
  </div>
) : null}
```

删除原有单选按钮的 `name`、`checked` 和逐项 `<label>`；这些属性不再适用于原生单选下拉框。

- [ ] **Step 2: 静态审计答案和错误链路**

运行只读检查：

```bash
git diff -- frontend/src/features/academic-flow/RuntimeFormFields.tsx
git diff --check -- frontend/src/features/academic-flow/RuntimeFormFields.tsx
sed -n '18,125p' frontend/src/features/academic-flow/RuntimeFormFields.tsx
sed -n '170,205p' frontend/src/features/academic-flow/formFields.ts
sed -n '5450,5485p' frontend/src/styles.css
```

逐项确认：

- `value` 仍读取 `selectedRadio`，空值显示“请选择”；
- `onChange` 仍写入 `otherText: null` 和 `selectedOptionId`；
- `onBlur` 仍传入 `field.id`；
- `aria-describedby` 仍关联 `errorId`，并新增 `aria-label={field.label}`；
- `checkbox` 分支、`ReadonlyFormFields` 和 `formFields.ts` 无差异；
- 现有 `.runtime-form-field-select select` 提供全宽、42px 最小高度、灰色边框和白色背景。

- [ ] **Step 3: 清理限定缓存并创建结果提交**

显式跳过 `.venv` 和 `node_modules`，只清理项目源码范围内允许删除的缓存，再提交唯一目标文件：

```bash
find backend frontend \( -path backend/.venv -o -path frontend/node_modules \) -prune -o -type d \( -name .pytest_cache -o -name __pycache__ -o -name '*.egg-info' \) -prune -print
find backend frontend \( -path backend/.venv -o -path frontend/node_modules \) -prune -o -type d \( -name .pytest_cache -o -name __pycache__ -o -name '*.egg-info' \) -prune -exec rm -r -- {} +
git status --short
git add frontend/src/features/academic-flow/RuntimeFormFields.tsx
git commit -m "feat: render runtime radio fields as selects"
```

预期：结果提交只包含 `RuntimeFormFields.tsx`，工作树中的其他已有改动保持原状。

- [ ] **Step 4: 以本地方式重启并核对服务进程**

先使用 `lsof -nP -iTCP:8000 -sTCP:LISTEN` 和 `lsof -nP -iTCP:5173 -sTCP:LISTEN` 识别本项目现有进程，仅终止已确认属于当前项目的进程。然后分别启动：

```bash
cd backend
./.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

```bash
cd frontend
export PATH="$PWD/../.local/node/bin:$PATH"
npm run dev
```

预期：后端日志出现 `Application startup complete`，前端日志出现 `VITE ... ready`；不发送 HTTP 业务请求。
