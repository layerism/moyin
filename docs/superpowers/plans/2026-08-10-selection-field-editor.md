# Selection Field Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将单项选择和多项选择改为参考问卷式编辑与填写界面，同时保持现有字段及答案协议兼容。

**Architecture:** 继续复用 `FormFieldEditor` 与 `RuntimeFormFields` 的状态更新、拖拽、校验和答案结构，只调整选择字段的 JSX 结构与共享 CSS。单选与多选使用同一组选项列表样式，通过原生 `radio`/`checkbox` 输入区分。

**Tech Stack:** React 18、TypeScript、原生 HTML 表单控件、现有 CSS。

## Global Constraints

- 不增加依赖，不新增字段类型，不修改数据库和后端接口。
- 不展示“必填”控件或标签，数据层继续默认全部字段必填。
- 不允许在已创建字段上切换单选与多选类型。
- 保持 `radio`、`checkbox`、`options`、`allowOther`、`minSelections`、`maxSelections` 兼容。
- 按项目要求，开发过程不运行测试、构建或浏览器验证，只进行静态业务审计。

---

### Task 1: 重构教师端选择字段编辑卡片

**Files:**
- Modify: `frontend/src/features/academic-flow/FormFieldEditor.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: `FormField`, `createFormOption()`, `updateField()`、现有字段与选项拖拽逻辑。
- Produces: 保持 `onChange(fields: FormField[])` 不变的问卷式选择字段编辑界面。

- [ ] **Step 1: 重组选择字段展开区**

在 `selectionField` 分支中使用现有标题编辑能力、选项循环和操作菜单，增加与字段类型对应的只读圆形或方形标识；保留选项文本编辑、拖拽排序和删除。

- [ ] **Step 2: 改造“其他”项操作**

将复选框式 `allowOther` 控件替换为按钮：未启用时写入 `{ allowOther: true }`，已启用时写入 `{ allowOther: false }`，不改变持久化字段。

- [ ] **Step 3: 增加固定类型底栏**

选择字段展开区底部显示固定文本 `单选题` 或 `多选题`，不渲染类型选择器和“必填”控件；多选的最少、最多选择数设置继续保留。

- [ ] **Step 4: 调整教师端样式**

在 `styles.css` 中复用现有颜色、边框和间距变量，添加选择题标题区、类型标识、选项操作区和固定类型底栏样式；不影响文本字段卡片。

### Task 2: 统一学生端单选与多选列表

**Files:**
- Modify: `frontend/src/features/academic-flow/RuntimeFormFields.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: `selectedRadio`、`selectedCheckboxes`、`OTHER_OPTION_ID`、`onUpdate()`。
- Produces: 与现有答案结构完全相同的原生单选及多选列表。

- [ ] **Step 1: 将单选下拉框替换为单选列表**

为每个普通选项渲染 `input type="radio"`，同一字段共享稳定 `name`；选中时继续提交 `{ selectedOptionId, otherText }`。

- [ ] **Step 2: 统一“其他”项**

单选“其他”使用圆形输入，多选“其他”继续使用方形输入；被选中后显示文本框，并保持原有 `otherText` 更新规则。

- [ ] **Step 3: 统一学生端视觉样式**

复用 `.runtime-form-field-options` 作为纵向列表容器，以修饰类区分单选和多选；保留错误态、键盘交互和选择数量提示。

### Task 3: 静态业务审计与交付

**Files:**
- Review: `frontend/src/features/academic-flow/FormFieldEditor.tsx`
- Review: `frontend/src/features/academic-flow/RuntimeFormFields.tsx`
- Review: `frontend/src/styles.css`

**Interfaces:**
- Consumes: 设计规格与 Tasks 1–2 的最终差异。
- Produces: 无格式错误、无协议变更且范围受控的提交。

- [ ] **Step 1: 审计字段协议**

逐项确认 `onChange`、`onUpdate`、`allowOther`、普通选项 ID 和单选/多选答案对象未改变。

- [ ] **Step 2: 审计界面范围**

确认未引入字段类型切换器、“必填”控件、新依赖或无关重构，并执行 `git diff --check`。

- [ ] **Step 3: 清理、提交和重启**

清理项目缓存，只暂存本计划涉及文件，创建最终检查点提交；按本地方式重启 Vite 与 Uvicorn，并只检查端口和 HTTP 可达性。
