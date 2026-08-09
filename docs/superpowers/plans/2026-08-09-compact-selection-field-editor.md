# 选择字段紧凑编辑器实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for inline execution, or `superpowers:subagent-driven-development` when the user explicitly chooses the single-subagent path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将单项选择和多项选择字段改为默认折叠、单项展开、菜单化操作的紧凑编辑界面，同时保持现有数据与业务逻辑不变。

**Architecture:** `FormFieldEditor` 继续拥有所有表单数据变更函数，只增加按字段/选项 ID 保存的临时展开和菜单状态。选择字段使用折叠摘要与条件渲染的展开内容，文本字段保留原结构；字段和选项共用同文件内的轻量操作菜单，样式集中在现有 `styles.css`。

**Tech Stack:** React 18、TypeScript、现有 CSS、原生 DOM 事件与可访问性属性。

## Global Constraints

- 当前分支实施；设计提交 `ebfaef2` 是本任务代码修改前的回滚检查点。
- 只暂存并提交本计划及本任务文件，不包含 `AGENTS.md`、`docs/05_oa_graph.md`、`.superpowers/` 等用户或无关改动。
- 只修改单项选择和多项选择字段；单行文本和多行文本布局保持不变。
- 不修改 `FormField`、`FormFieldConfig`、字段 ID、选项 ID、`onChange()` 数据流或验证规则。
- 不修改后端、数据库、流程版本、学生端或信息填写节点以外的组件。
- 不增加依赖、Context、全局状态、持久化字段、确认弹窗或第三方菜单组件。
- 选择字段初始全部收起，同一时间最多展开一个；新增选择字段后只展开新字段。
- 字段和选项的上移、下移、删除完整保留并收进“⋯”菜单。
- disabled 状态允许展开查看，但禁止菜单、输入、添加、排序、删除和其他数据修改。
- 按项目约定不运行自动化测试、构建或业务页面浏览器测试；只做静态业务逻辑审计，由用户手动验收。
- 实现过程中不做中间提交；完成静态审计、缓存清理和服务重启后只创建一个功能完成提交。

---

## 文件结构

- `frontend/src/features/academic-flow/FormFieldEditor.tsx`：展开状态、菜单状态、失效目标清理、选择字段摘要、条件内容和现有数据操作连接。
- `frontend/src/styles.css`：选择字段摘要、紧凑内容、选项行、操作菜单、错误、焦点、禁用和窄屏样式。
- `docs/superpowers/plans/2026-08-09-compact-selection-field-editor.md`：本实施计划。

### Task 1: 建立最小临时状态与菜单基础组件

**Files:**
- Modify: `frontend/src/features/academic-flow/FormFieldEditor.tsx:1-64,235-307`

**Interfaces:**
- Produces: `ActionMenuTarget` 联合类型，精确标识字段或选项菜单。
- Produces: `FieldActionMenu` 同文件组件，接收按钮禁用状态、打开状态、菜单项和开关回调。
- Produces: `isSelectionType(type: FormFieldType): boolean`。
- Consumes: 现有 `FormField`、`FormFieldType`、`displayedFields` 和 `disabled`。

- [ ] **Step 1: 增加 React 状态与菜单目标类型**

  在文件顶部增加 React hooks 导入，并在类型标签后定义：

  ```tsx
  import { useEffect, useState } from "react";

  type ActionMenuTarget =
    | { kind: "field"; fieldId: string }
    | { kind: "option"; fieldId: string; optionId: string };

  type ActionMenuItem = {
    danger?: boolean;
    disabled?: boolean;
    label: string;
    onSelect: () => void;
  };

  function isSelectionType(type: FormFieldType): boolean {
    return type === "radio" || type === "checkbox";
  }
  ```

  在 `FormFieldEditor` 内增加：

  ```tsx
  const [expandedSelectionFieldId, setExpandedSelectionFieldId] = useState<string | null>(null);
  const [openActionMenu, setOpenActionMenu] = useState<ActionMenuTarget | null>(null);
  ```

- [ ] **Step 2: 清理外部字段更新后失效的 ID 状态**

  使用以 `fields` 为依赖的 effect，在 effect 内重新标准化字段，避免将派生数组加入依赖：

  ```tsx
  useEffect(() => {
    const currentFields = normalizeFormFields(fields);
    setExpandedSelectionFieldId((current) =>
      current && currentFields.some(
        (field) => field.id === current && isSelectionType(field.type),
      )
        ? current
        : null,
    );
    setOpenActionMenu((current) => {
      if (!current) return null;
      const field = currentFields.find((item) => item.id === current.fieldId);
      if (!field) return null;
      if (current.kind === "field") return current;
      return field.options?.some((option) => option.id === current.optionId)
        ? current
        : null;
    });
  }, [fields]);
  ```

  该 effect 只能清理状态，不能调用 `onChange()` 或复制字段数据到本地状态。

- [ ] **Step 3: 增加点击外部和 Esc 关闭菜单的原生事件**

  ```tsx
  useEffect(() => {
    if (!openActionMenu) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-form-field-menu]")) return;
      setOpenActionMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenActionMenu(null);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openActionMenu]);
  ```

  再增加 disabled 切换清理，避免已打开菜单在页面转为只读后残留：

  ```tsx
  useEffect(() => {
    if (disabled) setOpenActionMenu(null);
  }, [disabled]);
  ```

- [ ] **Step 4: 在文件底部增加共享菜单组件**

  ```tsx
  function FieldActionMenu({
    ariaLabel,
    disabled,
    items,
    onOpenChange,
    open,
  }: {
    ariaLabel: string;
    disabled: boolean;
    items: ActionMenuItem[];
    onOpenChange: (open: boolean) => void;
    open: boolean;
  }) {
    return (
      <div className="form-field-action-menu-wrap" data-form-field-menu>
        <button
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={ariaLabel}
          className="form-field-menu-trigger"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onOpenChange(!open);
          }}
          type="button"
        >⋯</button>
        {open ? (
          <div className="form-field-action-menu" onClick={(event) => event.stopPropagation()} role="menu">
            {items.map((item) => (
              <button
                className={item.danger ? "danger" : undefined}
                disabled={disabled || item.disabled}
                key={item.label}
                onClick={() => {
                  item.onSelect();
                  onOpenChange(false);
                }}
                role="menuitem"
                type="button"
              >{item.label}</button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  ```

- [ ] **Step 5: 静态核对基础状态边界**

  确认 hooks 位于组件顶层；effect 只依赖 `fields`、`openActionMenu` 或 `disabled`；事件监听均有对称清理；菜单目标只保存 ID；页面转为 disabled 时关闭菜单；菜单按钮和菜单项 disabled 时均不能操作；点击菜单容器阻止摘要点击冒泡。

### Task 2: 接通新增、类型切换、排序和删除状态

**Files:**
- Modify: `frontend/src/features/academic-flow/FormFieldEditor.tsx:34-80`

**Interfaces:**
- Consumes: Task 1 的 `expandedSelectionFieldId`、`openActionMenu`、`isSelectionType()`。
- Produces: `addField(type)`、`changeFieldType(fieldIndex, type)`、`deleteField(fieldIndex, fieldId)`。
- Preserves: 现有 `updateField()`、`moveField()`、`updateOption()`、`moveOption()` 数据路径。

- [ ] **Step 1: 增加选择字段新增处理器**

  ```tsx
  const addField = (type: FormFieldType) => {
    const field = createFormField(type);
    onChange([...upgradeFormFields(fields), field]);
    if (isSelectionType(type)) setExpandedSelectionFieldId(field.id);
    setOpenActionMenu(null);
  };
  ```

  将顶部新增按钮的 `onClick` 改为 `onClick={() => addField(type)}`。文本字段新增不得修改 `expandedSelectionFieldId`。

- [ ] **Step 2: 增加类型切换处理器**

  ```tsx
  const changeFieldType = (fieldIndex: number, type: FormFieldType) => {
    const fieldId = displayedFields[fieldIndex].id;
    updateField(fieldIndex, { type });
    setExpandedSelectionFieldId(isSelectionType(type) ? fieldId : null);
    setOpenActionMenu(null);
  };
  ```

  字段类型 select 调用 `changeFieldType(fieldIndex, event.target.value as FormFieldType)`，继续由 `normalizeFieldSettings()` 处理适用字段。

- [ ] **Step 3: 增加字段删除处理器**

  ```tsx
  const deleteField = (fieldIndex: number, fieldId: string) => {
    onChange(upgradeFormFields(fields).filter((_, index) => index !== fieldIndex));
    setExpandedSelectionFieldId((current) => (current === fieldId ? null : current));
    setOpenActionMenu(null);
  };
  ```

  选择字段菜单与文本字段现有删除按钮都调用该处理器，避免删除后的展开状态分叉。

- [ ] **Step 4: 保持排序和选项操作的数据函数不变**

  字段菜单项调用 `moveField(fieldIndex, -1 | 1)`；选项菜单项调用 `moveOption(fieldIndex, optionIndex, -1 | 1)`；选项删除仍调用：

  ```tsx
  updateField(fieldIndex, {
    options: (field.options ?? []).filter((_, index) => index !== optionIndex),
  });
  ```

  菜单组件在动作后统一关闭。字段排序不得重设 `expandedSelectionFieldId`，确保展开状态跟随字段 ID。

- [ ] **Step 5: 静态核对业务调用链**

  逐一确认新增、类型切换、字段排序、字段删除、选项编辑、选项排序、选项删除、添加选项、“其他”选项和多选数量限制最终仍通过 `normalizeFieldSettings()` 与 `onChange(nextFields)`，没有直接修改 props 或创建第二套数据状态。

### Task 3: 渲染选择字段折叠摘要和展开内容

**Files:**
- Modify: `frontend/src/features/academic-flow/FormFieldEditor.tsx:82-232`

**Interfaces:**
- Consumes: Task 1 的 `FieldActionMenu` 与状态目标。
- Consumes: Task 2 的新增、类型切换和删除处理器。
- Produces: `.selection-field-card`、`.selection-field-summary`、`.selection-field-content`、`.selection-option-index` 结构。
- Preserves: 文本字段当前 `.form-field-card-header`、`.form-field-base-settings` 和 textarea 设置结构。

- [ ] **Step 1: 将 map 回调改为可声明局部变量的块级结构**

  ```tsx
  {displayedFields.map((field, fieldIndex) => {
    const selectionField = isSelectionType(field.type);
    const expanded = selectionField && expandedSelectionFieldId === field.id;
    const fieldErrors = errors[field.id] ?? [];
    const fieldMenuOpen = openActionMenu?.kind === "field"
      && openActionMenu.fieldId === field.id;
    return (
      <section
        className={`form-field-card${selectionField ? " selection-field-card" : ""}${
          fieldErrors.length ? " has-errors" : ""
        }`}
        key={field.id}
      >
        {/* summary/header and conditional content */}
      </section>
    );
  })}
  ```

  不使用 `:has()` 作为唯一错误状态来源，显式添加 `has-errors` 以便折叠状态也可显示错误。

- [ ] **Step 2: 为选择字段渲染摘要行**

  ```tsx
  {selectionField ? (
    <div className="selection-field-summary">
      <button
        aria-expanded={expanded}
        className="selection-field-summary-main"
        onClick={() => {
          setExpandedSelectionFieldId(expanded ? null : field.id);
          setOpenActionMenu(null);
        }}
        type="button"
      >
        <span className="selection-field-summary-copy">
          <strong>{field.label.trim() || "未命名字段"}</strong>
          <small>
            {fieldTypeLabels[field.type]} · {field.required ? "必填" : "选填"} ·
            {` ${field.options?.length ?? 0} 个选项`}
          </small>
        </span>
        {fieldErrors.length ? <span className="selection-field-error-badge">需修正</span> : null}
        <span aria-hidden="true" className={`selection-field-chevron${expanded ? " expanded" : ""}`}>⌄</span>
      </button>
      <FieldActionMenu
        ariaLabel={`字段操作 ${field.label.trim() || "未命名字段"}`}
        disabled={disabled}
        items={[
          { disabled: fieldIndex === 0, label: "上移", onSelect: () => moveField(fieldIndex, -1) },
          { disabled: fieldIndex === displayedFields.length - 1, label: "下移", onSelect: () => moveField(fieldIndex, 1) },
          { danger: true, label: "删除字段", onSelect: () => deleteField(fieldIndex, field.id) },
        ]}
        onOpenChange={(open) => setOpenActionMenu(open ? { kind: "field", fieldId: field.id } : null)}
        open={fieldMenuOpen}
      />
    </div>
  ) : (
    <div className="form-field-card-header">{/* 保留现有文本字段标题和按钮 */}</div>
  )}
  ```

  `FieldActionMenu.disabled` 使用字段整体 `disabled`；边界排序通过各菜单项的 `disabled` 控制。

- [ ] **Step 3: 只在选择字段展开时渲染设置内容**

  将现有字段基础设置、选择字段类型设置和错误文案包入：

  ```tsx
  {(!selectionField || expanded) ? (
    <div className={selectionField ? "selection-field-content" : undefined}>
      {/* 现有 base settings、textarea settings、selection settings、errors */}
    </div>
  ) : null}
  ```

  文本字段仍始终渲染现有内容。选择字段折叠时只渲染摘要，减少 DOM 和纵向高度。

- [ ] **Step 4: 将选择选项改为紧凑单行与菜单操作**

  ```tsx
  <div className="form-field-option-row" key={option.id}>
    <span aria-hidden="true" className="selection-option-index">{optionIndex + 1}</span>
    <input
      aria-label={`选项 ${optionIndex + 1}`}
      disabled={disabled}
      value={option.label}
      onChange={(event) => updateOption(fieldIndex, optionIndex, event.target.value)}
    />
    <FieldActionMenu
      ariaLabel={`选项操作 ${optionIndex + 1}`}
      disabled={disabled}
      items={[
        { disabled: optionIndex === 0, label: "上移", onSelect: () => moveOption(fieldIndex, optionIndex, -1) },
        { disabled: optionIndex === (field.options?.length ?? 0) - 1, label: "下移", onSelect: () => moveOption(fieldIndex, optionIndex, 1) },
        {
          danger: true,
          label: "删除选项",
          onSelect: () => updateField(fieldIndex, {
            options: (field.options ?? []).filter((_, index) => index !== optionIndex),
          }),
        },
      ]}
      onOpenChange={(open) => setOpenActionMenu(open
        ? { kind: "option", fieldId: field.id, optionId: option.id }
        : null)}
      open={openActionMenu?.kind === "option"
        && openActionMenu.fieldId === field.id
        && openActionMenu.optionId === option.id}
    />
  </div>
  ```

- [ ] **Step 5: 保留展开内容的全部原能力**

  确认展开内容仍包含字段标题、字段类型、必填、全部普通选项、添加选项、“其他”开关、多选最少/最多选择数和每条错误文案。添加选项继续追加 `createFormOption()`，不重设展开字段。

- [ ] **Step 6: 静态核对交互隔离**

  确认摘要主体和菜单按钮是同级元素，不存在 button 嵌套；菜单点击不会切换展开；展开按钮在 disabled 状态仍可点击；菜单和输入控件在 disabled 状态不可操作；文本字段结构与文案未被改成折叠摘要。

### Task 4: 增加紧凑样式、菜单状态和窄屏规则

**Files:**
- Modify: `frontend/src/styles.css:2907-3024,3048-3070`

**Interfaces:**
- Consumes: Task 3 产生的 selection/menu class names。
- Produces: 48px 摘要、约 34px 选项行、白底轻边框菜单、错误/焦点/禁用样式。
- Preserves: 文本字段现有 `.form-field-card` 和基础控件样式。

- [ ] **Step 1: 为选择字段建立折叠容器和摘要布局**

  增加以下样式族：

  ```css
  .selection-field-card { gap: 0; padding: 0; overflow: visible; }
  .selection-field-summary { min-height: 48px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
  .selection-field-summary-main { min-width: 0; min-height: 48px; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 9px; padding: 7px 8px 7px 12px; border: 0; background: transparent; text-align: left; }
  .selection-field-summary-copy { min-width: 0; display: grid; gap: 2px; }
  .selection-field-summary-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #1e3a5f; font-size: 13px; }
  .selection-field-summary-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #718096; font-size: 11px; }
  .selection-field-chevron { color: #718096; transition: transform 140ms ease; }
  .selection-field-chevron.expanded { transform: rotate(180deg); }
  .selection-field-content { display: grid; gap: 10px; padding: 10px 12px 12px; border-top: 1px solid #e5ebf2; }
  ```

  保持白色背景，不增加渐变、大阴影、彩色标签或新的卡片层级。

- [ ] **Step 2: 增加错误、焦点和禁用状态**

  ```css
  .form-field-card.has-errors { border-color: #f04438; box-shadow: 0 0 0 2px rgb(240 68 56 / 8%); }
  .selection-field-error-badge { color: #b42318; font-size: 11px; font-weight: 700; }
  .selection-field-summary-main:focus-visible,
  .form-field-menu-trigger:focus-visible,
  .form-field-action-menu button:focus-visible { outline: 3px solid rgb(43 116 255 / 16%); outline-offset: 1px; }
  ```

  调整现有 `.form-field-card:has(.form-field-error)` 为兼容保留或由显式 `.has-errors` 接管，不影响文本字段错误外观。

- [ ] **Step 3: 将选项行改为序号、输入和菜单三列**

  ```css
  .form-field-option-row { grid-template-columns: 22px minmax(0, 1fr) auto; gap: 5px; }
  .selection-option-index { color: #8b99aa; font-size: 11px; text-align: center; }
  .selection-field-content .form-field-option-list { gap: 5px; }
  .selection-field-content .form-field-option-row input { min-height: 34px; }
  ```

  “添加选项”按钮设置为整行宽度并使用轻量虚线边框，但保留现有字体和蓝灰色系。

- [ ] **Step 4: 增加操作菜单定位与状态样式**

  ```css
  .form-field-action-menu-wrap { position: relative; padding-right: 8px; }
  .form-field-menu-trigger { width: 30px; min-height: 30px; padding: 0 !important; }
  .form-field-action-menu { width: 112px; position: absolute; z-index: 30; top: calc(100% + 4px); right: 8px; display: grid; gap: 2px; padding: 4px; border: 1px solid #d7e0eb; border-radius: 6px; background: #fff; box-shadow: 0 10px 24px rgb(31 41 55 / 14%); }
  .form-field-action-menu button { width: 100%; min-height: 30px; display: flex; align-items: center; justify-content: flex-start; border: 0; background: transparent; text-align: left; }
  .form-field-action-menu button:hover:not(:disabled) { background: #f2f6fb; }
  .form-field-action-menu button.danger { color: #b42318; }
  ```

  对选项行内菜单使用更小的右侧间距覆盖，避免菜单触发器挤压输入框。

- [ ] **Step 5: 增加窄屏降级**

  在现有 `@media (max-width: 760px)` 中让摘要辅助信息允许截断、基础设置变为单列、菜单保持右对齐且不超出节点设置面板。不得改变文本字段已有移动端规则。

- [ ] **Step 6: 静态核对 CSS 作用域**

  确认新规则限定在 `.selection-field-*`、`.form-field-action-menu*` 或选择字段内容下；没有覆盖学生端表单、其他弹窗或全局按钮；菜单 z-index 高于字段卡片但低于节点设置模态；`:focus-visible`、`:disabled`、错误和长标题截断均有明确样式。

### Task 5: 全链路静态审计、清理、提交与重启

**Files:**
- Review: `frontend/src/features/academic-flow/FormFieldEditor.tsx`
- Review: `frontend/src/features/academic-flow/formFields.ts`
- Review: `frontend/src/styles.css`
- Do not modify: `backend/`、`frontend/src/types.ts`、学生端文件

**Interfaces:**
- Consumes: Task 1-4 的完整实现。
- Produces: 一个功能完成提交，以及重启后的本地 FastAPI/Vite 服务。

- [ ] **Step 1: 审计数据逻辑未改变**

  只读追踪每个交互到现有数据函数，确认：

  - 新增字段仍使用 `createFormField()`；
  - 类型切换和字段补全仍使用 `normalizeFieldSettings()`；
  - 字段/选项排序仍交换原数组元素；
  - 选项删除仍按数组位置过滤；
  - 选项 ID、字段 ID、校验和 `onChange()` 输出结构不变；
  - `formFields.ts`、类型定义、后端和学生端无差异。

- [ ] **Step 2: 审计界面状态与可访问性**

  确认：

  - 初始展开 ID 为 `null`；
  - 同一时刻只有一个展开 ID 和一个菜单目标；
  - 新增选择字段展开，新建文本字段不改变展开状态；
  - 字段排序后展开状态跟随 ID；
  - 删除或类型切换后失效 ID 被清理；
  - 摘要按钮与菜单按钮不嵌套；
  - 菜单支持外部点击和 Esc 关闭；
  - 菜单项边界禁用、危险语义和可访问名称正确；
  - disabled 时只允许展开查看，不触发数据修改；
  - 折叠错误摘要和展开具体错误使用同一 `errors[field.id]`。

- [ ] **Step 3: 执行限定文件的静态差异审计**

  使用 `git diff --check` 和限定路径的 `git diff`，确认本任务源代码差异只有：

  ```text
  frontend/src/features/academic-flow/FormFieldEditor.tsx
  frontend/src/styles.css
  ```

  设计和计划文档已有独立提交。不得出现后端、数据类型、学生端、依赖清单或其他页面改动。

- [ ] **Step 4: 清理项目生成缓存**

  先精确列出项目源码内的 `.pytest_cache`、`__pycache__`、`*.egg-info`，排除 `.git`、`frontend/node_modules`、虚拟环境和用户无关目录；只删除已列出的可再生成缓存。

- [ ] **Step 5: 创建唯一的功能完成提交**

  先执行 `git status --short`，只暂存：

  ```text
  frontend/src/features/academic-flow/FormFieldEditor.tsx
  frontend/src/styles.css
  ```

  提交信息：

  ```bash
  git commit -m "feat: compact selection field editing"
  ```

  不得暂存 `AGENTS.md`、`docs/05_oa_graph.md`、`.superpowers/` 或其他现有改动。

- [ ] **Step 6: 本地重启服务并做存活验证**

  只读解析 5173 和 8000 端口的当前监听 PID及工作目录，停止确认属于本项目的进程。从 `backend/` 使用 `.venv/bin/python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`，从 `frontend/` 使用 `npm run dev`，不使用 Docker。

  仅执行服务存活检查：后端 `/api/health` 返回 HTTP 200 和 `{"status":"ok"}`，前端根页面返回 HTTP 200。不执行自动化测试、构建或业务页面浏览器测试。

## 手动验收清单

1. 单项选择和多项选择字段初始收起，文本字段保持原布局。
2. 选择字段摘要正确显示名称、类型、必填状态、选项数和错误状态。
3. 同时只能展开一个选择字段，新增选择字段后自动展开新字段。
4. 字段菜单可上移、下移、删除，边界项正确禁用。
5. 选项菜单可上移、下移、删除，边界项正确禁用。
6. 点击菜单不切换字段展开，点击外部或按 Esc 关闭菜单。
7. 展开后标题、类型、必填、选项、“其他”和多选数量限制均可编辑。
8. 切换字段类型后布局和数据设置正确归一化。
9. 错误字段折叠时显示“需修正”，展开后显示具体错误。
10. 发布后只读状态可以展开查看，但不能修改任何数据。
