# 类型化表单字段实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. The repository allows at most one subagent; do not use per-task subagent dispatch. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 OA 表单节点扩展为支持必填／选填的单行文本、多行文本、单选和多选字段，并在教师配置、学生暂存、正式提交及只读展示中保持一致和历史兼容。

**Architecture:** 在前后端各建立一个无第三方依赖的表单字段纯逻辑模块，集中处理旧字段归一化、配置校验、答案规范化和答案校验。教师端和学生端分别拆出聚焦组件，原有设计器与运行页只负责状态编排；后端继续以发布版本配置为可信源，并在持久化前过滤未知答案。

**Tech Stack:** React 18、TypeScript、原生 HTML 表单控件、FastAPI、Python 3.12、SQLite；不新增依赖。

## Global Constraints

- 设计依据：`docs/superpowers/specs/2026-07-22-typed-form-fields-design.md`。
- 不新增流程节点类型，不修改 DAG、时间窗口、个别延期、审核和版本修订状态机。
- 已发布节点继续只允许修改节点标题、节点说明、起始时间和截止时间；字段结构保持锁定。
- 历史 `infoFields: string[]` 和历史提交快照不做数据库批量迁移。
- 新字段和选项使用稳定 ID；`other` 是保留选项值。
- 暂存允许不完整答案，但必须过滤未知字段和未知选项；正式提交执行严格校验。
- 不引入第三方表单构建器、校验库、富文本或 Markdown 编辑器。
- 按项目要求，不运行自动化测试、构建或浏览器测试；只做业务逻辑和静态差异审计，交由用户手动验收。
- 实施开始前创建一个 Git 检查点，全部实现完成后创建一个最终检查点；中间不提交。
- 不暂存或修改已有的 `AGENTS.md`、`docs/05_oa_graph.md` 和 `.superpowers/` 用户文件。

## File Map

### 新建

- `backend/app/domain/form_fields.py`：后端字段归一化、发布配置校验、答案过滤和提交校验。
- `frontend/src/features/academic-flow/formFields.ts`：前端字段类型辅助、旧格式归一化、编辑期升级、答案读取和客户端校验。
- `frontend/src/features/academic-flow/FormFieldEditor.tsx`：教师端字段配置卡片与选项编辑器。
- `frontend/src/features/academic-flow/RuntimeFormFields.tsx`：学生端填写控件、字段级错误和只读答案展示。

### 修改

- `backend/app/domain/workflow.py`：把表单字段配置校验接入流程草稿、影响预览和发布共用入口。
- `backend/app/domain/workflow_runtime.py`：保留现有非表单节点校验，并把表单节点转发到新模块。
- `backend/app/repositories/flow_instances.py`：暂存和提交前保存规范化后的答案。
- `backend/app/api/routes/student_flows.py`：将字段错误转换为结构化 `422` 响应。
- `frontend/src/types.ts`：声明字段、选项和兼容字段联合类型。
- `frontend/src/features/academic-flow/academicFlowData.ts`：新建表单节点时生成对象字段。
- `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`：接入字段编辑器和发布前配置提示。
- `frontend/src/features/academic-flow/api.ts`：让 `ApiError` 携带字段错误。
- `frontend/src/features/academic-flow/StudentRuntimePage.tsx`：接入类型化填写和只读组件，并管理校验触发状态。
- `frontend/src/styles.css`：字段卡片、选项列表、字符计数和错误状态样式。

---

### Task 1: 创建实施前检查点并确认范围

**Files:**
- Inspect only: repository status and current branch

**Interfaces:**
- Consumes: 已提交设计 `9826345`。
- Produces: 一个不包含用户未提交文件的实施前检查点。

- [ ] **Step 1: 确认分支与工作树**

Run:

```bash
git branch --show-current
git status --short
```

Expected: 当前分支为 `codex/oa-workflow-v1`；用户自有改动仍存在，但没有被暂存。

- [ ] **Step 2: 创建空检查点**

Run:

```bash
git commit --allow-empty -m "chore: checkpoint before typed form fields"
```

Expected: 生成一个仅标记实施起点的提交，不包含工作树文件。

### Task 2: 建立后端表单字段可信边界

**Files:**
- Create: `backend/app/domain/form_fields.py`
- Modify: `backend/app/domain/workflow.py:24-26`
- Modify: `backend/app/domain/workflow_runtime.py:56-66`

**Interfaces:**
- Consumes: `node["infoFields"]`、学生 `payload`。
- Produces:
  - `normalize_form_fields(raw_fields: object) -> list[dict[str, Any]]`
  - `validate_form_config(node: dict[str, Any]) -> None`
  - `normalize_form_answers(node: dict[str, Any], payload: dict[str, Any], *, strict: bool) -> dict[str, Any]`
  - `FormAnswerValidationError.field_errors: dict[str, str]`

- [ ] **Step 1: 定义字段异常和旧格式归一化**

Create `backend/app/domain/form_fields.py` with these public contracts:

```python
from typing import Any

FORM_FIELD_TYPES = {"text", "textarea", "radio", "checkbox"}
OTHER_OPTION_ID = "other"


class FormFieldConfigError(ValueError):
    pass


class FormAnswerValidationError(ValueError):
    def __init__(self, field_errors: dict[str, str]) -> None:
        super().__init__("表单内容未通过校验")
        self.field_errors = field_errors


def normalize_form_fields(raw_fields: object) -> list[dict[str, Any]]:
    if not isinstance(raw_fields, list):
        raise FormFieldConfigError("表单字段必须是数组")
    normalized: list[dict[str, Any]] = []
    for index, raw_field in enumerate(raw_fields):
        if isinstance(raw_field, str):
            normalized.append({
                "id": f"legacy-{index}",
                "label": raw_field,
                "type": "text",
                "required": True,
                "answerKey": raw_field,
                "legacy": True,
            })
            continue
        if not isinstance(raw_field, dict):
            raise FormFieldConfigError(f"第 {index + 1} 个表单字段格式错误")
        normalized.append({
            **raw_field,
            "answerKey": str(raw_field.get("id") or ""),
            "legacy": False,
        })
    return normalized
```

Internal-only `answerKey` and `legacy` must never be written back into flow configuration.

- [ ] **Step 2: 实现发布配置校验**

Implement this exact public signature:

```python
def validate_form_config(node: dict[str, Any]) -> None:
    if node.get("kind") != "form":
        return
    fields = normalize_form_fields(node.get("infoFields", []))
    _validate_normalized_fields(str(node.get("title") or "未命名表单"), fields)
```

Implement the private `_validate_normalized_fields` in the same file with these ordered checks:

1. Reject blank labels for every field.
2. For object fields, reject blank IDs, duplicate IDs and the reserved field ID `other`.
3. Permit duplicate labels only when every conflicting entry is a legacy string field; this preserves old published flows. Reject duplicate labels whenever one of the conflicting fields uses the new object format.
4. Require `type` in `FORM_FIELD_TYPES` and require `required` to be a real boolean.
5. For `text`, reject `options`, `allowOther`, length limits and selection limits.
6. For `textarea`, reject choice settings, validate optional `minLength`/`maxLength` as non-negative integers excluding booleans, and require minimum not greater than maximum.
7. For `radio` and `checkbox`, require at least two ordinary option objects; reject blank, duplicate or reserved option IDs and blank or duplicate trimmed labels.
8. For `radio`, reject length and selection-limit settings.
9. For `checkbox`, validate optional `minSelections`/`maxSelections` as non-negative integers excluding booleans, require minimum not greater than maximum, and require maximum not greater than `len(options) + int(allowOther is True)`.

Error messages must include node title and field label, for example `表单“信息填写”的字段“申请理由”：最少字符数不能大于最多字符数`.

- [ ] **Step 3: 实现答案过滤与严格校验**

Implement this public signature:

```python
def normalize_form_answers(
    node: dict[str, Any],
    payload: dict[str, Any],
    *,
    strict: bool,
) -> dict[str, Any]:
    fields = normalize_form_fields(node.get("infoFields", []))
    return _normalize_answers(fields, payload, strict=strict)
```

Implement `_normalize_answers` in one pass over configured fields:

1. Initialize a fresh output dictionary and field-error dictionary; never copy unknown payload keys.
2. Use `field["answerKey"]` for payload lookup and output, so legacy text fields retain their label key while object fields use their stable ID.
3. For `text` and `textarea`, preserve a string value verbatim and replace a non-string input with an empty string. Under `strict=True`, validate required text after trimming; for a nonempty textarea validate Unicode character count against configured limits.
4. For `radio`, accept only a dictionary containing `selectedOptionId`. Retain the selection only when it is a configured option ID or `other` is enabled. Output exactly `{ "selectedOptionId": selected_or_none, "otherText": other_text_or_none }`.
5. For `checkbox`, accept only a dictionary containing a list `selectedOptionIds`. Deduplicate valid IDs, order ordinary IDs by configuration order, append `other` last when enabled and selected, and output exactly `{ "selectedOptionIds": ordered_ids, "otherText": other_text_or_none }`.
6. Retain `otherText` only when `other` is selected; otherwise store `None`.
7. Under `strict=True`, collect required, textarea length, checkbox count and missing-other-text failures keyed by normalized field ID. Under `strict=False`, skip these completeness failures while retaining the filtered shapes.
8. Raise `FormAnswerValidationError(field_errors)` only after processing every field; otherwise return the normalized output.

For optional textarea and checkbox fields, an entirely empty value bypasses minimum limits; once nonempty, configured minimums apply.

- [ ] **Step 4: 接入流程配置校验**

In `backend/app/domain/workflow.py`, call the new validator inside the existing node loop:

```python
for node in nodes:
    _validate_node_time_window(node)
    _validate_node_template(node)
    try:
        validate_form_config(node)
    except FormFieldConfigError as exc:
        raise FlowValidationError(str(exc)) from exc
```

This preserves the current `FlowValidationError -> HTTP 422` path for draft save, revision impact and publish.

- [ ] **Step 5: 保留非表单节点现有行为**

In `backend/app/domain/workflow_runtime.py`, change only the form branch:

```python
if kind == "form":
    normalize_form_answers(node, payload, strict=True)
    return
```

Do not alter confirmation, announcement or file validation.

### Task 3: 在仓储和 API 层保存规范化答案

**Files:**
- Modify: `backend/app/repositories/flow_instances.py:360-408`
- Modify: `backend/app/repositories/flow_instances.py:487-511`
- Modify: `backend/app/api/routes/student_flows.py:17-61`

**Interfaces:**
- Consumes: Task 2 `normalize_form_answers` and `FormAnswerValidationError`。
- Produces: 草稿与提交快照中的可信答案，以及结构化字段错误响应。

- [ ] **Step 1: 暂存前过滤表单答案**

After loading `config` in `save_node_draft`, resolve the node and normalize only form payloads:

```python
node = node_by_key(config, row["node_key"])
draft_payload = (
    normalize_form_answers(node, payload, strict=False)
    if node.get("kind") == "form"
    else payload
)
```

Write `canonical_json(draft_payload)` instead of the original payload. Keep incomplete configured answers; remove unknown fields/options.

- [ ] **Step 2: 提交前保存严格规范化结果**

In `submit_node`, keep file reconstruction unchanged. For form nodes, replace the original payload before writing the submission:

```python
if node.get("kind") == "form":
    submission_payload = normalize_form_answers(node, payload, strict=True)
else:
    validate_submission(node, submission_payload)
```

Do not call form normalization twice. The resulting `submission_payload` is the only object written to `payload_snapshot`.

- [ ] **Step 3: 增加结构化字段错误**

Import `FormAnswerValidationError` in the student route and add a specific branch before generic conflicts:

```python
def runtime_error(exc: Exception) -> HTTPException:
    if isinstance(exc, FormAnswerValidationError):
        return HTTPException(
            status_code=422,
            detail={
                "message": "表单内容未通过校验",
                "fieldErrors": exc.field_errors,
            },
        )
    # existing roster, not-found, deadline and conflict branches stay unchanged
```

Add `FormAnswerValidationError` to `post_submit`'s caught exceptions. Draft normalization must not raise field-required errors.

### Task 4: 建立前端字段模型和纯函数

**Files:**
- Modify: `frontend/src/types.ts:78-103`
- Create: `frontend/src/features/academic-flow/formFields.ts`
- Modify: `frontend/src/features/academic-flow/academicFlowData.ts:55-78`

**Interfaces:**
- Consumes: backend-compatible field schema and answer shapes。
- Produces:
  - `FormFieldType`, `FormFieldOption`, `FormField`, `FormFieldConfig`
  - `NormalizedFormField`
  - `createFormField(type: FormFieldType): FormField`
  - `createFormOption(): FormFieldOption`
  - `normalizeFormFields(fields: FormFieldConfig[]): NormalizedFormField[]`
  - `upgradeFormFields(fields: FormFieldConfig[]): FormField[]`
  - `validateFormFieldConfig(fields: FormFieldConfig[]): Record<string, string[]>`
  - `validateFormAnswers(fields, payload): Record<string, string>`
  - `formatFormAnswer(field, value): string`

- [ ] **Step 1: 扩展共享 TypeScript 类型**

Add:

```ts
export type FormFieldType = "text" | "textarea" | "radio" | "checkbox";
export type FormFieldOption = { id: string; label: string };
export type FormField = {
  id: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options?: FormFieldOption[];
  allowOther?: boolean;
  minLength?: number;
  maxLength?: number;
  minSelections?: number;
  maxSelections?: number;
};
export type FormFieldConfig = string | FormField;
```

Change `AcademicFlowNode.infoFields` to `FormFieldConfig[]`.

- [ ] **Step 2: 实现无副作用字段辅助函数**

Create `formFields.ts`. Use `crypto.randomUUID()` with the existing timestamp/random fallback only when creating or upgrading editable fields. Legacy read normalization uses deterministic IDs `legacy-${index}` and keeps `answerKey` equal to the original label.

```ts
export type NormalizedFormField = FormField & {
  answerKey: string;
  legacy: boolean;
};

export function normalizeFormFields(fields: FormFieldConfig[]): NormalizedFormField[];
export function upgradeFormFields(fields: FormFieldConfig[]): FormField[];
export function createFormField(type: FormFieldType): FormField;
export function createFormOption(): FormFieldOption;
export function validateFormFieldConfig(fields: FormFieldConfig[]): Record<string, string[]>;
export function validateFormAnswers(
  fields: FormFieldConfig[],
  payload: Record<string, unknown>,
): Record<string, string>;
export function formatFormAnswer(field: NormalizedFormField, value: unknown): string;
```

Mirror the backend rules exactly. Count trimmed Unicode characters with `Array.from(value.trim()).length`; do not use UTF-16 `.length` for validation.

- [ ] **Step 3: 创建新表单节点的对象字段**

In `createNode`, replace the three strings with three required text fields generated once:

```ts
infoFields: kind === "form"
  ? ["学号", "姓名", "联系电话"].map((label) => ({
      ...createFormField("text"),
      label,
    }))
  : [],
```

Do not upgrade published flow data during generic reads; only the editable teacher field component calls `upgradeFormFields`.

### Task 5: 实现教师端字段配置卡片

**Files:**
- Create: `frontend/src/features/academic-flow/FormFieldEditor.tsx`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:1380-1500`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: Task 4 field types and helpers。
- Produces:
  - `FormFieldEditor({ fields, disabled, onChange })`
  - 教师端字段级配置错误与不可发布提示。

- [ ] **Step 1: 建立字段编辑器组件**

Define the component contract:

```tsx
export function FormFieldEditor({
  disabled,
  fields,
  onChange,
}: {
  disabled: boolean;
  fields: FormFieldConfig[];
  onChange: (fields: FormField[]) => void;
})
```

On first actual edit, call `upgradeFormFields(fields)` and pass object fields upward. Do not call `onChange` from render or an effect solely to migrate data.

- [ ] **Step 2: 实现添加与通用字段配置**

The “添加字段” control presents four native buttons or a compact native select for `text`, `textarea`, `radio`, `checkbox`. Each card contains:

```tsx
<input aria-label="字段标题" value={field.label} />
<select aria-label="字段类型" value={field.type}>
  <option value="text">单行文本</option>
  <option value="textarea">多行文本</option>
  <option value="radio">单项选择</option>
  <option value="checkbox">多项选择</option>
</select>
<label><input type="checkbox" checked={field.required} /> 必填</label>
<button type="button">删除字段</button>
```

Use `field.id` as the React key so editing labels never remounts the input. Reuse immutable array updates; do not add form libraries or global state.

- [ ] **Step 3: 实现类型专属配置**

- `textarea`: two native number inputs for `minLength` and `maxLength`.
- `radio`/`checkbox`: option rows keyed by `option.id`, with add/delete controls and stable ordering.
- Both choice types: `allowOther` checkbox.
- `checkbox`: number inputs for `minSelections` and `maxSelections`.
- Switching away from a type removes settings that no longer apply, so stale constraints do not reach the backend.

- [ ] **Step 4: 显示配置错误并接入设计器**

Use `validateFormFieldConfig(fields)` to render errors inside the matching card. Replace the current `infoFields.map(...)` block in `NodeInspector` with:

```tsx
<FormFieldEditor
  disabled={nodeCoreLocked}
  fields={node.infoFields}
  onChange={(infoFields) => onUpdateNode(node.id, { infoFields })}
/>
```

Before `preparePublish`, aggregate field errors across form nodes. If any exist, set `actionNotice` to `请先修正表单字段配置` and open the first invalid node inspector instead of sending a publish request. The backend remains the final guard.

- [ ] **Step 5: 添加教师端样式**

Add scoped classes under the existing inspector styles:

```css
.form-field-editor {}
.form-field-card {}
.form-field-card-header {}
.form-field-type-settings {}
.form-field-option-list {}
.form-field-option-row {}
.form-field-error {}
```

Maintain the existing modal scroll boundary. Use native controls, aligned action buttons, visible focus states, and a red error treatment; do not change unrelated inspector sections.

### Task 6: 实现学生填写、字段错误和只读展示

**Files:**
- Create: `frontend/src/features/academic-flow/RuntimeFormFields.tsx`
- Modify: `frontend/src/features/academic-flow/api.ts:36-69`
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx:117-184`
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx:296-515`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: Task 4 normalization/validation/format helpers and Task 3 error response。
- Produces:
  - `ApiError.fieldErrors: Record<string, string>`
  - `RuntimeFormFields` writable renderer
  - `ReadonlyFormFields` display renderer。

- [ ] **Step 1: 扩展 API 错误类型**

Update `ApiError` without affecting string-detail errors:

```ts
export class ApiError extends Error {
  public status: number;
  public fieldErrors: Record<string, string>;

  constructor(status: number, message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}
```

Parse both shapes:

```ts
type ErrorDetail = string | {
  message?: string;
  fieldErrors?: Record<string, string>;
};
```

String details preserve current behavior. Object details use `message ?? "请求失败"` and carry `fieldErrors`.

- [ ] **Step 2: 建立学生可写字段组件**

Define:

```tsx
export function RuntimeFormFields({
  errors,
  fields,
  onBlur,
  onUpdate,
  payload,
}: {
  errors: Record<string, string>;
  fields: FormFieldConfig[];
  onBlur: (fieldId: string) => void;
  onUpdate: (answerKey: string, value: unknown) => void;
  payload: Record<string, unknown>;
})
```

Render native `input`, `textarea`, radio and checkbox controls from normalized fields. For choice answers, write the exact object shapes from the design. “其他” input appears only while selected. Every control group uses `aria-describedby` for its inline error.

- [ ] **Step 3: 实现交互校验与首错聚焦**

In `RuntimeNodeDialog`, track touched field IDs and a submit-attempt flag. Display an error when the field is touched or submit was attempted. On submit:

```ts
const fieldErrors = node.kind === "form"
  ? validateFormAnswers(node.infoFields, draft)
  : {};
if (Object.keys(fieldErrors).length > 0) {
  setSubmitAttempted(true);
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`[data-form-field-id="${CSS.escape(firstId)}"]`)?.focus();
  });
  return;
}
onSubmit();
```

Keep the submit button enabled for form fields so clicking it reveals errors. File upload disabling remains unchanged.

- [ ] **Step 4: 合并后端字段错误**

In `StudentRuntimePage.submit`, catch `ApiError` separately and retain its `fieldErrors` for the active node. Do not clear drafts on failure. Clear server field errors for one field when the student changes that answer; keep the top notice as the general message.

- [ ] **Step 5: 替换只读表单展示**

Create:

```tsx
export function ReadonlyFormFields({
  fields,
  payload,
}: {
  fields: FormFieldConfig[];
  payload: Record<string, unknown>;
})
```

Use `formatFormAnswer` to map option IDs back to labels, join multi-select labels with `、`, and append `其他：补充内容`. Replace only the form branch of `ReadonlySubmission`; keep file and confirmation branches unchanged.

- [ ] **Step 6: 添加学生端样式**

Add scoped styles:

```css
.runtime-form-field {}
.runtime-form-field.is-invalid {}
.runtime-form-field-options {}
.runtime-form-field-other {}
.runtime-form-field-count {}
.runtime-form-field-error {}
```

The textarea must have a visibly larger minimum height and vertical resize. Radio/checkbox rows must have aligned native controls and labels. Errors use red text/border and remain readable in the dialog's existing scroll area.

### Task 7: 静态审计、清理、重启与最终检查点

**Files:**
- Audit: all files listed in File Map
- Preserve: `AGENTS.md`, `docs/05_oa_graph.md`, `.superpowers/`

**Interfaces:**
- Consumes: Tasks 2-6 completed implementation。
- Produces: 静态审计记录、已重启本地服务和最终实现提交。

- [ ] **Step 1: 对照设计做业务逻辑审计**

Use targeted searches and inspect every caller:

```bash
rg -n "infoFields|normalize_form_answers|validate_form_config|FormAnswerValidationError" backend/app frontend/src
rg -n "fieldErrors|validateFormAnswers|ReadonlyFormFields|RuntimeFormFields" frontend/src
```

Confirm manually from the diff:

- legacy strings use label keys while new fields use stable IDs;
- draft and submit both filter unknown data;
- submit alone enforces required/min/max rules;
- optional empty textarea/checkbox bypasses minimum rules;
- `otherText` survives only when `other` is selected;
- published core locking still covers `infoFields`;
- file, confirmation and announcement paths are unchanged.

- [ ] **Step 2: 执行静态差异检查**

Run:

```bash
git diff --check
git diff --stat
git status --short
```

Expected: no whitespace errors; only scoped implementation files plus pre-existing user files appear. Do not run pytest, npm build or browser validation.

- [ ] **Step 3: 清理开发缓存**

Remove only generated cache directories inside the repository:

```bash
find backend frontend -type d \( -name .pytest_cache -o -name __pycache__ -o -name '*.egg-info' \) -prune -exec rm -rf {} +
```

Re-run `git status --short` and confirm no tracked source file was removed.

- [ ] **Step 4: 本地重启服务**

Stop only listeners on ports 8000 and 5173, then start without Docker:

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

```bash
cd frontend
npm run dev -- --host 127.0.0.1
```

Verify only service availability:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/docs
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5173/
```

Expected: both return `200`. This is availability verification, not browser or behavior testing.

- [ ] **Step 5: 创建唯一的实现提交**

Stage only the planned implementation files, never use `git add .`:

```bash
git add -- \
  backend/app/domain/form_fields.py \
  backend/app/domain/workflow.py \
  backend/app/domain/workflow_runtime.py \
  backend/app/repositories/flow_instances.py \
  backend/app/api/routes/student_flows.py \
  frontend/src/types.ts \
  frontend/src/features/academic-flow/formFields.ts \
  frontend/src/features/academic-flow/academicFlowData.ts \
  frontend/src/features/academic-flow/FormFieldEditor.tsx \
  frontend/src/features/academic-flow/AcademicFlowDesigner.tsx \
  frontend/src/features/academic-flow/api.ts \
  frontend/src/features/academic-flow/RuntimeFormFields.tsx \
  frontend/src/features/academic-flow/StudentRuntimePage.tsx \
  frontend/src/styles.css
git diff --cached --check
git commit -m "feat: add typed OA form fields"
```

Expected: one final implementation commit containing only the planned files.

## Manual Acceptance Checklist

After implementation, ask the user to verify in the running app:

1. A teacher can add all four field types and toggle required/optional.
2. Choice options remain focused while typing and stay aligned when added or deleted.
3. Invalid field configuration blocks publish and identifies the field.
4. Textarea character counting and min/max messages are correct.
5. Multi-select min/max rules and optional-empty behavior are correct.
6. Selecting “其他” requires text; deselecting it removes stale text.
7. Incomplete answers can be saved as drafts but cannot be submitted.
8. Unknown client fields/options do not appear after a draft reload or final submission.
9. Approved submissions render labels and readable answers rather than JSON.
10. An old published flow with string `infoFields` still fills, submits and displays correctly.
11. Published-node field configuration remains locked during revision.
