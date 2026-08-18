# 审核脚本配置字段对齐实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将布尔配置字段改为与文本、数字字段一致的“标题、说明、等高控件”布局。

**Architecture:** `AuditScriptConfigForm` 继续根据 JSON 字段类型动态渲染，仅调整 boolean 分支的 JSX 层级。CSS 将普通输入选择器收紧为直接子元素，并新增等高布尔控件行，避免复选框继承普通输入框样式。

**Tech Stack:** React 18、TypeScript、现有 CSS。

## Global Constraints

- 不修改配置 JSON、字段顺序、值类型、校验或保存逻辑。
- 布尔控件行宽度为 `100%`，最小高度为 `42px`，沿用 `#d7dce5` 边框和 `6px` 圆角。
- 不运行自动化测试、不执行构建、不使用浏览器插件。
- 完成静态审计后重启本地服务，并创建结果 checkpoint。
- 不暂存既有安装、Docker 和根目录配置改动。

---

### Task 1: 统一布尔字段结构和样式

**Files:**
- Modify: `frontend/src/features/academic-flow/AuditScriptConfigForm.tsx`
- Modify: `frontend/src/styles.css`
- Create: `docs/superpowers/plans/2026-08-18-audit-script-config-field-alignment.md`

**Interfaces:**
- Consumes: `definition.type === "boolean"`、`value: AuditScriptValue`、`onChange(value)`。
- Produces: 与普通输入字段同层级、同宽度和同高度的布尔控件行。

- [x] **Step 1: 调整 boolean JSX 层级**

将 boolean 分支改为普通字段容器：

```tsx
<div className="audit-script-config-field">
  <span>{definition.label}</span>
  {definition.description ? <small id={descriptionId}>{definition.description}</small> : null}
  <label className="audit-script-config-boolean-control" htmlFor={inputId}>
    <span>启用</span>
    <input
      aria-describedby={describedBy}
      checked={value === true}
      disabled={disabled}
      id={inputId}
      onChange={(event) => onChange(event.target.checked)}
      type="checkbox"
    />
  </label>
</div>
```

这样标题和说明不再位于带边框容器内，点击控件行仍通过 `label` 切换复选框。

- [x] **Step 2: 收紧普通输入框选择器**

把以下选择器：

```css
.audit-script-config-field input,
.audit-script-config-field select,
.audit-script-config-field textarea
```

统一改为直接子元素选择器：

```css
.audit-script-config-field > input,
.audit-script-config-field > select,
.audit-script-config-field > textarea
```

焦点、错误边框和 textarea 规则同步使用直接子元素，确保嵌套在布尔控件行中的 checkbox 不继承普通输入框的 `width: 100%`、padding 和 min-height。

- [x] **Step 3: 新增等高布尔控件行**

用以下职责替换旧 `.audit-script-config-boolean` 样式：

```css
.audit-script-config-boolean-control {
  display: flex;
  width: 100%;
  min-height: 42px;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-top: auto;
  padding: 10px 12px;
  border: 1px solid #d7dce5;
  border-radius: 6px;
  background: #ffffff;
  color: #344054;
  font-weight: 400;
}
```

checkbox 保持 `18px × 18px` 和项目蓝色强调色；禁用状态继续由现有规则控制。

- [x] **Step 4: 静态审计**

执行：

```bash
rg -n "audit-script-config-boolean|audit-script-config-field > (input|select|textarea)" frontend/src/features/academic-flow/AuditScriptConfigForm.tsx frontend/src/styles.css
git diff --check -- frontend/src/features/academic-flow/AuditScriptConfigForm.tsx frontend/src/styles.css docs/superpowers/plans/2026-08-18-audit-script-config-field-alignment.md
```

人工确认 boolean 分支仍读取 `checked={value === true}`，仍通过 `onChange(event.target.checked)` 输出布尔值，普通输入分支未发生业务变化。

- [x] **Step 5: 重启服务并提交结果 checkpoint**

按项目本地启动约定重启前后端并核对 `8000`、`5173`。随后只提交本任务三个文件：

```bash
git add -- docs/superpowers/plans/2026-08-18-audit-script-config-field-alignment.md \
  frontend/src/features/academic-flow/AuditScriptConfigForm.tsx \
  frontend/src/styles.css
git commit -m "style: align audit script config fields"
```

### Task 2: 修正弹窗通用样式覆盖

用户复核截图显示，布尔控件和同一网格行的普通输入框仍被拉高。静态级联审计确认，后声明的 `.audit-script-metadata-form label/input` 覆盖了 Task 1 的布尔控件样式。

- [x] **Step 1: 将基本信息规则限定到 `.audit-script-basic-fields`**

把通用 `label`、`input`、`textarea`、焦点和错误选择器改为 `.audit-script-basic-fields > label` 作用域，避免覆盖 `AuditScriptConfigForm` 内部元素。

- [x] **Step 2: 保留动态配置表单自身的字段规则**

动态配置继续只由 `.audit-script-config-field` 和 `.audit-script-config-boolean-control` 控制；checkbox 保持 `18px × 18px`，布尔控件行保持 `42px`。

### Task 3: 阻止无说明字段的控件被网格行拉高

用户复核截图显示，“最大审核页数”“JPEG 质量”等无说明字段仍明显高于同列的正常输入框。DOM 与 CSS 静态审计确认：两列网格按同一行最高字段确定行高，`.audit-script-config-field` 作为拉伸后的内部 Grid，会把多余高度分配给自身的自动轨道，进而纵向拉伸直接子控件。

- [x] **Step 1: 固定字段内部内容的纵向排列方式**

为 `.audit-script-config-field` 增加 `align-content: start`，使标题、说明与控件按自身高度从顶部排列；同一网格行的剩余空间保留在字段容器底部，不再进入输入框或布尔控件行。

- [x] **Step 2: 静态审计并收尾**

核对普通输入框、下拉框、文本域和布尔控件仍由各自既有规则控制，不改变字段值、事件或校验逻辑。按项目约束不运行测试、不使用浏览器；完成后重启本地前后端并提交结果 checkpoint。

### Task 4: 补齐运行配置描述文字

用户进一步明确要求通过补齐描述文字实现两列字段的语义与视觉对齐，而不是只保留空白占位。

- [x] 为“最大审核页数”增加“单次审核最多处理的文件页数”。
- [x] 为“JPEG 质量”增加“数值越高，图片越清晰但传输数据越大”。
- [x] 保留字段键、类型、取值、校验范围和处理逻辑不变。

### Task 5: 隐藏内部脚本的无效默认值与非必要提示

- [x] 配置管理接口显式返回 `parameterDefaultsEditable`，由脚本可见性决定节点参数默认值是否允许编辑。
- [x] 内部脚本不展示“节点参数默认值”，管理列表中的可调配置数量同步排除这些参数。
- [x] 移除配置影响提示和保存成功提示，删除对应前端状态与无用样式。
- [x] 保留读取、保存、冲突和部分保存失败等错误反馈。

### Task 6: 草稿保存时刷新内部确认审核配置

配置管理更新内部确认审核脚本后，教师点击预览会先保存草稿。草稿保存原先直接校验节点携带的旧配置哈希，导致请求在创建预览前被拒绝。

- [x] `save_draft()` 完成流程结构与修订约束校验后，调用 `_bind_confirmation_visual_audits(config)`。
- [x] 使用当前脚本配置重新生成确认节点的版本、配置哈希、节点参数与运行配置，再执行统一脚本校验。
- [x] 普通文件节点继续执行原有固定版本和配置哈希校验，不放宽校验边界。
