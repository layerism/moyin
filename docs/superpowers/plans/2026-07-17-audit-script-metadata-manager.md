# 预置审核脚本元信息管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为超级管理员增加可查看并编辑预置审核脚本名称与说明的弹窗。

**Architecture:** 继续以 `backend/scripts/*/manifest.json` 为唯一真源，由受超级管理员权限保护的 PATCH 接口原子更新可变元信息。React 弹窗复用现有 API 客户端与页面视觉系统，不恢复上传或版本管理。

**Tech Stack:** Python 3.11、FastAPI、Pydantic、React 18、TypeScript、CSS。

## Global Constraints

- 不增加任何第三方依赖。
- 不修改脚本 ID、语言、版本、入口或代码文件。
- 不恢复上传、删除、模板下载或在线代码编辑。
- 仅超级管理员可修改元信息，普通教师仍可读取列表。
- 遵循仓库规则：实现期间不运行测试、构建或浏览器验证，仅做静态业务审计；中间不提交。

---

### Task 1: 后端元信息写入服务与 API

**Files:**
- Modify: `backend/app/services/audit_script_catalog.py`
- Modify: `backend/app/api/routes/workflow_admin.py`

**Interfaces:**
- Consumes: `settings.audit_scripts_root`、`get_current_super_admin()`。
- Produces: `update_audit_script_metadata(script_id: str, name: str, description: str) -> dict[str, object]`、`PATCH /api/workflow-admin/audit-scripts/{script_id}/metadata`。

- [x] **Step 1: 扩展清单记录**

在 `_AuditScriptManifest` 保存 `manifest_path: Path`，并以清单与入口文件的最新 mtime 生成 `updatedAt`。

- [x] **Step 2: 实现原子元信息修改**

实现 `update_audit_script_metadata()`：复用现有清单解析与字段上限，拒绝重复 ID、不存在脚本和重复名称；只替换 JSON 中的 `name`/`description`，用 `tempfile.NamedTemporaryFile` 与 `os.replace` 在原目录完成原子写入，异常时清理临时文件。

- [x] **Step 3: 暴露受权限保护的 PATCH 路由**

新增 Pydantic 请求模型，字段长度为 `name: 1..120`、`description: 1..500`；路由使用 `Depends(get_current_super_admin)`，将不存在、名称冲突、无效清单和写入失败映射为不泄露路径的 HTTP 错误。

### Task 2: 前端管理弹窗

**Files:**
- Create: `frontend/src/features/academic-flow/AuditScriptMetadataDialog.tsx`
- Modify: `frontend/src/features/academic-flow/api.ts`
- Modify: `frontend/src/features/home/HomeView.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: `workflowApi.listAuditScripts()`、`teacherIdentity.role`。
- Produces: `workflowApi.updateAuditScriptMetadata(scriptId, payload)`、`AuditScriptMetadataDialog({ onClose })`。

- [x] **Step 1: 增加 API 客户端方法**

向 `workflowApi` 增加 PATCH 方法，返回 `AuditScriptSummary`，继续复用统一 `request()` 的 cookie 与错误处理。

- [x] **Step 2: 实现列表/编辑两态弹窗**

组件打开时读取列表，分别渲染 loading、error、empty 和 list 状态。列表项展示名称、说明、语言、版本、更新时间与“编辑”操作；编辑态提供名称、说明、取消和保存，并完整处理空值、忙碌与错误状态。

- [x] **Step 3: 集成超级管理员入口**

在 `AcademicFlowView` 内增加弹窗开关，仅当 `teacherIdentity.role === "super_admin"` 时在“创建流程”旁渲染“审核脚本”按钮与弹窗。

- [x] **Step 4: 补充现有视觉系统的最小样式**

复用 `.modal-backdrop`、现有颜色、边框、圆角和按钮层级，仅新增弹窗容器、列表、表单与窄屏布局所需选择器；不改动其他页面。

### Task 3: 静态审计与交付

**Files:**
- Modify: `docs/superpowers/specs/2026-07-17-audit-script-metadata-manager-design.md`
- Modify: `docs/superpowers/plans/2026-07-17-audit-script-metadata-manager.md`

- [x] **Step 1: 业务逻辑静态审计**

检查权限边界、字段限制、原子替换、路径边界、列表状态、弹窗关闭与禁用行为；用 `rg` 确认未恢复上传/删除/模板路由。不运行测试、构建或浏览器。

- [x] **Step 2: 清理、提交与重启**

删除 `.pytest_cache`、`__pycache__` 和 `*.egg-info` 等中间缓存；仅暂存本次修改文件，创建完成检查点，然后按仓库现有启动方式重启服务。
