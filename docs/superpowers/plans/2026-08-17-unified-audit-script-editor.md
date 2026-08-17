# 审核脚本统一编辑器实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将审核脚本的“编辑信息”和“配置”合并为单一入口、单一页面和单一保存动作。

**Architecture:** 保留 `manifest.json` 元信息与 `versions/1/config.json` 版本配置的后端职责及现有接口。前端统一由 `AuditScriptMetadataDialog` 加载详情、维护草稿并按“版本配置优先、基本信息随后”的顺序保存，仅提交发生变化的部分；`AuditScriptConfigForm` 继续负责 JSON 驱动的配置字段渲染。

**Tech Stack:** React 18、TypeScript、现有 FastAPI 管理接口、项目既有 CSS。

## Global Constraints

- 仅修改 v1 审核脚本管理前端，不改变审核脚本配置 JSON 结构、配置哈希和流程快照语义。
- 公开脚本允许编辑名称和功能说明；内部脚本基本信息只读。
- 配置字段继续根据 JSON 定义自动渲染。
- 修改过程中不运行自动化测试、不执行前端构建、不使用浏览器插件。
- 实施中不提交；完成静态业务审计、缓存清理和服务重启后，只创建一次结果 checkpoint。
- 保留工作树中 `.gitignore`、`AGENTS.md`、`README.md`、`docker-compose.yml`、`storage/.gitkeep` 和 `INSTALL.md` 的既有未提交改动。

---

## File Structure

- Modify: `frontend/src/features/academic-flow/AuditScriptMetadataDialog.tsx`
  - 收敛页面状态、脏值判断、字段校验、分段保存和列表同步。
- Modify: `frontend/src/features/academic-flow/auditScriptConfig.ts`
  - 提供配置草稿与当前详情的稳定等值比较函数，避免组件重复拼装比较逻辑。
- Modify: `frontend/src/styles.css`
  - 为统一页面的基本信息区域、只读信息和局部保存提示补充既有视觉语言下的样式。
- Add: `docs/superpowers/plans/2026-08-17-unified-audit-script-editor.md`
  - 记录本实施计划。

### Task 1: 统一编辑器状态与保存链路

**Files:**
- Modify: `frontend/src/features/academic-flow/auditScriptConfig.ts`
- Modify: `frontend/src/features/academic-flow/AuditScriptMetadataDialog.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: `workflowApi.getAuditScriptConfig(scriptId)`、`workflowApi.updateAuditScriptConfig(scriptId, payload)`、`workflowApi.updateAuditScriptMetadata(scriptId, payload)`。
- Produces: `hasAuditScriptConfigChanges(detail, parameterDefaults, runtimeSettings): boolean`，以及单入口统一编辑页面。

- [x] **Step 1: 增加稳定的配置草稿变化判断**

在 `auditScriptConfig.ts` 中增加导出函数，严格按详情中的字段定义逐项比较，避免依赖对象键顺序：

```ts
export function hasAuditScriptConfigChanges(
  detail: AuditScriptConfigDetail,
  parameterDefaults: Record<string, AuditScriptValue>,
  runtimeSettings: Record<string, AuditScriptValue>,
): boolean {
  return detail.parameters.some(
    (parameter) => parameterDefaults[parameter.key] !== parameter.default,
  ) || detail.runtimeSettings.some(
    (setting) => runtimeSettings[setting.key] !== setting.value,
  );
}
```

- [x] **Step 2: 删除独立的元信息编辑状态**

在 `AuditScriptMetadataDialog.tsx` 中移除：

```ts
const [editing, setEditing] = useState<AuditScriptManagementSummary | null>(null);
const startEditing = (...);
const saveMetadata = (...);
```

保留 `detail` 作为唯一编辑页面状态。打开任一脚本时统一调用 `getAuditScriptConfig()`，并同时初始化：

```ts
setDetail(nextDetail);
setName(nextDetail.name);
setDescription(nextDetail.description);
setParameterDefaults(createParameterDefaultDraft(nextDetail));
setRuntimeSettings(createRuntimeSettingDraft(nextDetail));
```

- [x] **Step 3: 增加统一脏值和有效性判断**

组件中计算：

```ts
const metadataChanged = Boolean(
  detail?.metadataEditable
  && (name.trim() !== detail.name || description.trim() !== detail.description),
);
const configChanged = detail
  ? hasAuditScriptConfigChanges(detail, parameterDefaults, runtimeSettings)
  : false;
const configErrors = detail
  ? getAuditScriptConfigErrors(detail, parameterDefaults, runtimeSettings)
  : {};
const metadataValid = !detail?.metadataEditable || Boolean(name.trim() && description.trim());
const canSave = (metadataChanged || configChanged)
  && metadataValid
  && Object.keys(configErrors).length === 0
  && !saving;
```

把 `configErrors` 直接传给 `AuditScriptConfigForm`，使无效配置随输入即时标红；名称和说明为空时使用 `aria-invalid` 和字段级错误文案。

- [x] **Step 4: 实现统一保存函数**

以 `saveChanges()` 替换两个旧保存函数：

```ts
let currentDetail = detail;
if (configChanged) {
  currentDetail = await workflowApi.updateAuditScriptConfig(detail.id, {
    expectedConfigSha256: detail.configSha256,
    parameterDefaults,
    runtimeSettings,
  });
  // 立即同步 detail、配置草稿和列表更新时间。
}
if (metadataChanged) {
  const updatedMetadata = await workflowApi.updateAuditScriptMetadata(detail.id, {
    name: name.trim(),
    description: description.trim(),
  });
  currentDetail = {
    ...currentDetail,
    name: updatedMetadata.name,
    description: updatedMetadata.description,
    updatedAt: updatedMetadata.updatedAt,
  };
  // 同步 detail 和列表名称、说明、更新时间。
}
```

错误分支必须满足：

- 配置接口失败时不调用元信息接口。
- 配置已成功但元信息失败时保留已更新的配置基线，并提示“运行配置已保存，但基本信息保存失败：…”。
- 全部成功后提示“修改已保存”。
- 409 配置冲突继续提示重新加载，不覆盖当前 JSON 文件。

- [x] **Step 5: 合并列表按钮与编辑页面**

列表操作收敛为：

```tsx
<button onClick={() => void openEditor(script)} type="button">
  {script.metadataEditable || configurableCount > 0 ? "编辑" : "查看"}
</button>
```

统一页面顶部显示“编辑审核脚本”或“查看审核脚本”。页面依次包含：

```tsx
<section className="audit-script-basic-section">基本信息</section>
<AuditScriptConfigForm ... />
<footer>
  <button type="button">返回</button>
  {hasEditableContent ? <button disabled={!canSave}>保存修改</button> : null}
</footer>
```

公开脚本渲染名称输入框和说明文本域；内部脚本用只读文本展示。删除列表上的“编辑信息”“配置”双按钮及原独立元信息表单分支。

- [x] **Step 6: 补充统一页面样式**

在 `frontend/src/styles.css` 的审核脚本样式区域追加以下职责明确的类：

```css
.audit-script-basic-section { /* 与现有配置 section 相同的边框、圆角和内边距 */ }
.audit-script-basic-readonly { /* 名称与说明的只读层级 */ }
.audit-script-partial-save { /* 使用现有警告色表达局部保存 */ }
```

复用现有表单输入框、焦点、错误和按钮规则，不增加新的颜色体系或弹窗层级。

- [x] **Step 7: 执行静态业务逻辑审计**

只执行非运行时检查：

```bash
rg -n '编辑信息|>配置<|startEditing|saveMetadata' frontend/src/features/academic-flow/AuditScriptMetadataDialog.tsx
git diff --check -- frontend/src/features/academic-flow/AuditScriptMetadataDialog.tsx frontend/src/features/academic-flow/auditScriptConfig.ts frontend/src/styles.css
git diff -- frontend/src/features/academic-flow/AuditScriptMetadataDialog.tsx frontend/src/features/academic-flow/auditScriptConfig.ts frontend/src/styles.css
```

预期：旧双入口文案和旧独立状态函数均无匹配；差异检查无空白错误；人工确认内部脚本不可编辑元信息、配置保存先于元信息、局部失败不会丢失已保存基线。

- [x] **Step 8: 清理缓存并重启本地服务**

只清理项目约定的 Python 中间缓存；不删除依赖目录。随后按项目 `MEMORY.md` 的本地方式重启后端和前端，并用端口监听状态核对 `8000`、`5173`。

- [x] **Step 9: 创建结果 checkpoint**

仅暂存本任务文件：

```bash
git add -- docs/superpowers/plans/2026-08-17-unified-audit-script-editor.md \
  frontend/src/features/academic-flow/AuditScriptMetadataDialog.tsx \
  frontend/src/features/academic-flow/auditScriptConfig.ts \
  frontend/src/styles.css
git commit -m "feat: unify audit script editor"
```

提交后使用 `git status --short` 确认既有基础设施改动仍未被纳入。
