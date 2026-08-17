# 审核脚本管理弹窗显式关闭实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使审核脚本管理弹窗点击外部遮罩时保持打开，仅允许点击右上角 `×` 关闭。

**Architecture:** 仅移除 `AuditScriptMetadataDialog` 最外层遮罩对 `onClose` 的点击绑定。保留 `onClose` 作为右上角关闭按钮的回调，不改变保存状态、内部表单或其他弹窗。

**Tech Stack:** React 18、TypeScript、现有弹窗组件。

## Global Constraints

- 不增加键盘或遮罩反馈逻辑。
- 保存过程中继续禁用右上角关闭按钮。
- 不运行自动化测试、不执行构建、不使用浏览器插件。
- 完成后静态审计、重启本地服务，并创建结果 checkpoint。
- 不暂存既有安装、Docker 和根目录配置改动。

---

### Task 1: 移除遮罩点击关闭

**Files:**
- Modify: `frontend/src/features/academic-flow/AuditScriptMetadataDialog.tsx`
- Create: `docs/superpowers/plans/2026-08-17-audit-script-dialog-explicit-close.md`

**Interfaces:**
- Consumes: `onClose: () => void`。
- Produces: 仅右上角关闭按钮调用 `onClose` 的审核脚本管理弹窗。

- [x] **Step 1: 修改遮罩元素**

将：

```tsx
<div className="modal-backdrop audit-script-metadata-backdrop" onClick={saving ? undefined : onClose}>
```

改为：

```tsx
<div className="modal-backdrop audit-script-metadata-backdrop">
```

保留内部 `<section onClick={(event) => event.stopPropagation()}>` 和右上角按钮：

```tsx
<button disabled={saving} onClick={onClose} type="button">×</button>
```

- [x] **Step 2: 静态审计退出入口**

执行：

```bash
rg -n "audit-script-metadata-backdrop|onClick=\{onClose\}|Escape" frontend/src/features/academic-flow/AuditScriptMetadataDialog.tsx
git diff --check -- frontend/src/features/academic-flow/AuditScriptMetadataDialog.tsx docs/superpowers/plans/2026-08-17-audit-script-dialog-explicit-close.md
```

确认遮罩元素不含 `onClick`，右上角按钮仍调用 `onClose`，组件内不存在 `Escape` 关闭逻辑。

- [x] **Step 3: 重启服务并提交结果 checkpoint**

按项目本地启动约定重启后端与前端，核对 `8000`、`5173` 监听状态。随后只提交本任务两个文件：

```bash
git add -- docs/superpowers/plans/2026-08-17-audit-script-dialog-explicit-close.md \
  frontend/src/features/academic-flow/AuditScriptMetadataDialog.tsx
git commit -m "fix: require explicit audit script dialog close"
```
