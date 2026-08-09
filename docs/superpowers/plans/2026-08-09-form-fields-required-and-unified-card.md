# 表单字段统一必填与卡片交互实施计划

> **执行方式：** 用户选择在当前任务中直接实施，由根代理按计划顺序修改并完成静态审计。

**Goal:** 让四种表单字段共享同一编辑卡片，并使新旧字段在前后端均无条件按必填校验。

**Architecture:** `required` 保留为兼容字段，前端规范化和保存时统一写成 `true`，后端配置层继续校验其布尔形状但答案层无条件执行必填规则。`FormFieldEditor` 删除文本/选择两套渲染分支，改为一套通用摘要、展开和类型专属设置。

**Tech Stack:** React、TypeScript、CSS、Python、既有 Node test runner、pytest 测试代码。

## Global Constraints

- 当前 `main` 分支实施，不创建工作树。
- 不启动额外 subagent；由根代理完成业务修改与静态审计。
- 开发过程中不运行 pytest、Node test、TypeScript 构建或浏览器自动化，只更新测试代码并做静态业务逻辑审计。
- 保留 `FormField.required: boolean` 和后端 `required` 配置键，不新增数据库迁移、API、依赖或字段类型。
- 历史 `required: false` 必须立即按必填处理；非布尔 `required` 仍由后端配置校验拒绝。
- 四种字段均保留标题原位编辑、类型转换、拖拽、锁定、错误标记和操作菜单。
- 用户已有 `AGENTS.md`、`INSTALL.md`、`MEMORY.md` 不暂存、不覆盖。
- 已有设计提交作为开发前检查点；实现与静态审计结束后只创建一个最终检查点提交。
- 结束前清理源码目录中的 `.pytest_cache`、`__pycache__`、`*.egg-info`，并以本地方式重启 FastAPI 与 Vite。

---

### Task 1: 前端字段规范化和答案校验统一必填

**Files:**
- Modify: `frontend/src/features/academic-flow/formFields.ts:15-210`
- Create: `frontend/tests/formFields.test.ts`

**Interfaces:**
- Consumes: `FormFieldConfig[]`、`FormField`、`validateRange()`。
- Produces: `normalizeFormFields()` 与 `upgradeFormFields()` 返回的所有对象均有 `required: true`；`validateFormAnswers()` 对历史 false 无条件校验必填。

- [ ] **Step 1: 增加前端规范化测试代码**

  创建 `frontend/tests/formFields.test.ts`：

  ```ts
  import assert from "node:assert/strict";
  import test from "node:test";

  import {
    normalizeFormFields,
    upgradeFormFields,
    validateFormAnswers,
    validateFormFieldConfig,
  } from "../src/features/academic-flow/formFields.ts";

  const optionalFields = [
    { id: "text", label: "姓名", required: false, type: "text" as const },
    {
      id: "radio",
      label: "方向",
      options: [
        { id: "a", label: "学术" },
        { id: "b", label: "实践" },
      ],
      required: false,
      type: "radio" as const,
    },
    {
      id: "checkbox",
      label: "材料",
      options: [
        { id: "a", label: "论文" },
        { id: "b", label: "附件" },
      ],
      required: false,
      type: "checkbox" as const,
    },
  ];

  test("normalizes historical optional fields as required", () => {
    assert.deepEqual(normalizeFormFields(optionalFields).map((field) => field.required), [true, true, true]);
    assert.deepEqual(upgradeFormFields(optionalFields).map((field) => field.required), [true, true, true]);
  });

  test("rejects empty answers for historical optional fields", () => {
    assert.deepEqual(validateFormAnswers(optionalFields, {}), {
      text: "此项为必填项",
      radio: "请选择一项",
      checkbox: "请至少选择一项",
    });
  });

  test("requires at least one checkbox selection", () => {
    const fields = [{ ...optionalFields[2], maxSelections: 0 }];
    assert.deepEqual(validateFormFieldConfig(fields), {
      checkbox: ["最少选择数不能大于最多选择数"],
    });
  });
  ```

- [ ] **Step 2: 强制前端规范化结果为必填**

  对对象字段也覆盖兼容值：

  ```ts
  : {
      ...field,
      answerKey: field.id,
      legacy: false,
      options: field.options?.map((option) => ({ ...option })),
      required: true,
    }
  ```

  `upgradeFormFields()` 的对象分支同样在复制选项后写入 `required: true`。字符串旧字段和 `createFormField()` 继续显式写入 `true`。

- [ ] **Step 3: 删除答案校验中的可选分支**

  文本、单选、多选空值判断改为无条件：

  ```ts
  } else if (!value) {
    errors[field.id] = "此项为必填项";
  }
  ```

  ```ts
  } else if (!valid) {
    errors[field.id] = "请选择一项";
  }
  ```

  ```ts
  if (!count) {
    errors[field.id] = "请至少选择一项";
    continue;
  }
  const minimum = Math.max(field.minSelections ?? 0, 1);
  ```

- [ ] **Step 4: 统一多选配置有效最小值**

  `validateFormFieldConfig()` 使用：

  ```ts
  const effectiveMinimum = Math.max(field.minSelections ?? 0, 1);
  ```

  其他标题、选项、范围和“其他”内容规则不改动。

### Task 2: 后端配置形状兼容并无条件校验必填

**Files:**
- Modify: `backend/app/domain/form_fields.py:75-175,250-370`
- Create: `backend/tests/test_form_fields.py`

**Interfaces:**
- Consumes: `validate_form_config(node)`、`normalize_form_answers(node, payload, strict=True)`。
- Produces: 历史 `required: false` 配置形状有效，但空答案触发四种字段必填错误；多选有效最小值至少为 1。

- [ ] **Step 1: 增加后端历史 false 回归测试代码**

  创建 `backend/tests/test_form_fields.py`：

  ```python
  import pytest

  from app.domain.form_fields import (
      FormAnswerValidationError,
      FormFieldConfigError,
      normalize_form_answers,
      validate_form_config,
  )


  def form_node(*fields: dict[str, object]) -> dict[str, object]:
      return {"kind": "form", "title": "信息表", "infoFields": list(fields)}


  def test_historical_optional_fields_are_effectively_required() -> None:
      node = form_node(
          {"id": "text", "label": "姓名", "type": "text", "required": False},
          {
              "id": "radio",
              "label": "方向",
              "type": "radio",
              "required": False,
              "options": [{"id": "a", "label": "学术"}, {"id": "b", "label": "实践"}],
          },
          {
              "id": "checkbox",
              "label": "材料",
              "type": "checkbox",
              "required": False,
              "options": [{"id": "a", "label": "论文"}, {"id": "b", "label": "附件"}],
          },
      )
      validate_form_config(node)

      with pytest.raises(FormAnswerValidationError) as exc_info:
          normalize_form_answers(node, {}, strict=True)

      assert exc_info.value.field_errors == {
          "text": "此项为必填项",
          "radio": "请选择一项",
          "checkbox": "请至少选择一项",
      }


  def test_required_must_remain_boolean() -> None:
      node = form_node({"id": "text", "label": "姓名", "type": "text", "required": "yes"})
      with pytest.raises(FormFieldConfigError, match="必填配置无效"):
          validate_form_config(node)


  def test_checkbox_maximum_cannot_be_zero() -> None:
      node = form_node(
          {
              "id": "checkbox",
              "label": "材料",
              "type": "checkbox",
              "required": False,
              "maxSelections": 0,
              "options": [{"id": "a", "label": "论文"}, {"id": "b", "label": "附件"}],
          }
      )
      with pytest.raises(FormFieldConfigError, match="最少选择数不能大于最多选择数"):
          validate_form_config(node)
  ```

- [ ] **Step 2: 保留 required 布尔形状校验**

  `_validate_normalized_fields()` 中继续保留：

  ```python
  if type(field.get("required")) is not bool:
      raise FormFieldConfigError(f"{prefix}：必填配置无效")
  ```

  不从 `_FIELD_KEYS` 删除 `required`。

- [ ] **Step 3: 配置和答案校验改为无条件必填**

  多选配置：

  ```python
  effective_minimum = max(minimum or 0, 1)
  ```

  文本与单选答案：

  ```python
  if not trimmed:
      errors[field_id] = "此项为必填项"
  ```

  ```python
  elif answer["selectedOptionId"] is None:
      errors[field_id] = "请选择一项"
  ```

  多选答案：

  ```python
  if not selected:
      errors[field_id] = "请至少选择一项"
      return
  minimum = max(field.get("minSelections") or 0, 1)
  ```

  非严格草稿规范化仍允许空值；只有 `strict=True` 执行答案错误。

### Task 3: 将四种字段收敛为通用摘要卡片

**Files:**
- Modify: `frontend/src/features/academic-flow/FormFieldEditor.tsx:69-970`

**Interfaces:**
- Consumes: Task 1 强制必填的 `normalizeFormFields()`、`upgradeFormFields()`、`createFormField()`。
- Produces: 单一 `expandedFieldId` 状态；四种类型共用 `.form-field-summary` 与 `.form-field-content`；`normalizeFieldSettings()` 始终返回 `required: true`。

- [ ] **Step 1: 泛化展开状态**

  删除 `isSelectionType()`，将状态改为：

  ```tsx
  const [expandedFieldId, setExpandedFieldId] = useState<string | null>(null);
  ```

  字段列表同步 effect 只检查字段 ID 是否仍存在：

  ```tsx
  setExpandedFieldId((current) =>
    current && currentFields.some((field) => field.id === current) ? current : null,
  );
  ```

  新增任意字段后 `setExpandedFieldId(field.id)`；类型转换后保持该字段展开；删除时清除相同 ID。

- [ ] **Step 2: 建立通用展开设置**

  `fieldSettings` 首项统一为字段类型下拉框：

  ```tsx
  <div className="form-field-common-settings">
    <label>
      <span>字段类型</span>
      <select
        disabled={disabled}
        value={field.type}
        onChange={(event) => changeFieldType(
          fieldIndex,
          event.target.value as FormFieldType,
        )}
      >
        <option value="text">单行文本</option>
        <option value="textarea">多行文本</option>
        <option value="radio">单项选择</option>
        <option value="checkbox">多项选择</option>
      </select>
    </label>
  </div>
  ```

  删除旧的字段标题输入框和 `form-field-required`。多行字符数、选择选项、“其他”开关和多选数量范围继续按字段类型条件渲染。

- [ ] **Step 3: 四种字段统一渲染摘要行**

  每次字段迭代统一计算：

  ```tsx
  const expanded = expandedFieldId === field.id;
  const toggleField = () => {
    setExpandedFieldId(expanded ? null : field.id);
    setOpenActionMenu(null);
  };
  const fieldMeta = field.type === "radio" || field.type === "checkbox"
    ? `${fieldTypeLabels[field.type]} · ${field.options?.length ?? 0} 个选项`
    : fieldTypeLabels[field.type];
  ```

  每个 `.form-field-card.form-field-collapsible` 内固定为两层：第一层 `.form-field-summary`，第二层为条件渲染的 `.form-field-content`。摘要的 `.form-field-summary-main` 按现有顺序移动并复用完整 `ReorderHandle`、标题按钮/输入和元数据切换块；元数据 `<small>` 渲染 `fieldMeta`，错误徽标使用 `.form-field-error-badge`，箭头使用 `.form-field-chevron`。`FieldActionMenu` 保持为 `.form-field-summary` 的第二列。标题按钮/输入继续保留现有 Enter、Escape、blur 行为；元数据块继续保留 Enter、Space 键盘切换。删除 `selectionField` 分支、摘要必填标签和文本字段旧 header。

- [ ] **Step 4: 通用展开内容**

  ```tsx
  {expanded ? (
    <div className="form-field-content" id={`form-field-content-${field.id}`}>
      {fieldSettings}
    </div>
  ) : null}
  ```

  错误信息仍在 `fieldSettings` 尾部渲染，因此折叠时通过摘要错误徽标提示，展开时显示具体消息。

- [ ] **Step 5: 类型转换始终写入 required true**

  `normalizeFieldSettings()` 四个返回分支全部使用：

  ```tsx
  required: true,
  ```

  保持文本类型删除选择配置、多行保留字符范围、选择类型补足两个默认选项、多选保留选择范围。

### Task 4: 删除学生端必填状态文字并泛化样式

**Files:**
- Modify: `frontend/src/features/academic-flow/RuntimeFormFields.tsx:18-155`
- Modify: `frontend/src/styles.css:3036-3520`

**Interfaces:**
- Consumes: Task 3 的通用 `.form-field-*` DOM 类名。
- Produces: 四类卡片一致的桌面/窄屏布局；学生字段标题不再显示“必填/选填”。

- [ ] **Step 1: 删除运行时必填状态文字**

  从每个学生填写字段 header 中删除：

  ```tsx
  <span>{field.required ? "必填" : "选填"}</span>
  ```

  保留 `<strong>{field.label}</strong>`、输入控件、错误 `aria-describedby` 和答案更新逻辑；同时删除仅服务该状态文字的 `.runtime-form-field-label > span` 样式。

- [ ] **Step 2: 将选择字段样式类泛化**

  对应 Task 3 的 DOM，把以下选择器系统性重命名：

  ```text
  selection-field-card              -> form-field-collapsible
  selection-field-summary           -> form-field-summary
  selection-field-summary-main      -> form-field-summary-main
  selection-field-title-control     -> form-field-title-control
  selection-field-title-button      -> form-field-title-button
  selection-field-meta-toggle       -> form-field-meta-toggle
  selection-field-error-badge       -> form-field-error-badge
  selection-field-chevron           -> form-field-chevron
  selection-field-content           -> form-field-content
  ```

  删除 `.selection-field-summary-required`、`.form-field-card-header`、`.form-field-card-title`、`.form-field-base-settings` 和 `.form-field-required` 的废弃样式。

- [ ] **Step 3: 定义统一卡片网格**

  `.form-field-card.form-field-collapsible` 使用零间距、零内边距；`.form-field-summary-main` 的桌面网格为：

  ```css
  grid-template-columns: 28px minmax(120px, 1fr) auto;
  ```

  `.form-field-content` 保留边框分隔、内边距和类型设置间距；`.form-field-common-settings` 使用单列并把类型下拉宽度限制为合理范围。

- [ ] **Step 4: 保留类型专属与窄屏样式**

  选项列表、拖拽目标线、操作菜单、错误边框和焦点样式改用通用类名后保持原值。窄屏 `.form-field-summary-main` 保持标题可收缩，`.form-field-content .two-column` 改为单列，不再为必填标签预留第二行。

### Task 5: 静态验收、清理、提交和本地重启

**Files:**
- Review: `frontend/src/features/academic-flow/formFields.ts`
- Review: `frontend/src/features/academic-flow/FormFieldEditor.tsx`
- Review: `frontend/src/features/academic-flow/RuntimeFormFields.tsx`
- Review: `frontend/src/styles.css`
- Review: `backend/app/domain/form_fields.py`
- Review: `frontend/tests/formFields.test.ts`
- Review: `backend/tests/test_form_fields.py`
- Include: `docs/superpowers/plans/2026-08-09-form-fields-required-and-unified-card.md`

**Interfaces:**
- Consumes: Tasks 1-4 的完整变更。
- Produces: 静态审计通过的最终检查点，以及各一个存活的 FastAPI、Vite 本地服务进程。

- [ ] **Step 1: 审计必填闭环**

  逐项核对字符串旧字段、对象历史 false、新建字段、类型转换、文本空值、单选空值、多选空值、多选最小值和非布尔 required。

- [ ] **Step 2: 审计编辑器闭环**

  核对四种类型的新增自动展开、折叠/展开、标题编辑、类型转换、专属设置、删除、错误徽标、字段拖拽、选项拖拽和锁定状态。

- [ ] **Step 3: 执行非运行型检查**

  仅执行：

  ```bash
  git diff --check
  rg -n "required|必填|选填|expandedFieldId|form-field-summary|form-field-content" frontend/src/features/academic-flow backend/app/domain/form_fields.py frontend/tests backend/tests/test_form_fields.py
  git status --short
  ```

  对 `required` 命中逐项分类，确认登录表单、审计脚本参数等其他模块语义未改动。不执行 pytest、Node test、TypeScript build、Vite build 或浏览器自动化。

- [ ] **Step 4: 清理源码缓存**

  先解析仓库源码目录中的 `.pytest_cache`、`__pycache__`、`*.egg-info` 精确路径，再删除这些中间缓存；排除 `.git`、`node_modules` 和 `backend/.venv`。

- [ ] **Step 5: 创建最终检查点**

  只暂存本计划列出的七个实现/测试文件及实施计划，不纳入用户已有文件。提交信息：

  ```bash
  git commit -m "feat: unify required form field cards"
  ```

- [ ] **Step 6: 本地重启服务**

  精确确认并停止本项目占用 `8000`、`5173` 的旧进程，分别启动一个 FastAPI 与 Vite 实例。仅检查端口监听和前端 HTTP 响应，不执行浏览器验收。
