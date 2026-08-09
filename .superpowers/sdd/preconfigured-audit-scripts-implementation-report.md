# 后台预置审核脚本实施报告

## 1. 实施范围

已按 `docs/superpowers/specs/2026-07-17-preconfigured-audit-scripts-design.md` 与 `docs/superpowers/plans/2026-07-17-preconfigured-audit-scripts.md` 完成 Tasks 1–4。Task 5 的最终清理、提交与服务重启由主代理处理。

## 2. 改动文件

### 后端

- 新增 `backend/app/services/audit_script_catalog.py`
- 修改 `backend/app/services/audit_script_runtime.py`
- 修改 `backend/app/api/routes/workflow_admin.py`
- 删除 `backend/app/repositories/audit_scripts.py`
- 删除 `backend/app/services/audit_script_templates.py`
- 重写 `backend/tests/test_audit_scripts_api.py`
- 修改 `backend/tests/test_audit_script_runtime.py`
- 修改 `.gitignore`
- 删除 `backend/scripts/.gitkeep`
- 新增 `backend/scripts/material-basic-check/manifest.json`
- 新增 `backend/scripts/material-basic-check/versions/1/handler.py`

### 前端

- 修改 `frontend/src/features/home/HomeView.tsx`
- 修改 `frontend/src/features/academic-flow/api.ts`
- 修改 `frontend/src/features/academic-flow/auditScripts.ts`
- 修改 `frontend/src/features/academic-flow/AuditScriptSelector.tsx`
- 修改 `frontend/src/features/academic-flow/academicFlowData.ts`
- 修改 `frontend/src/styles.css`
- 删除 `frontend/src/features/academic-flow/AuditScriptManagerDialog.tsx`
- 删除 `frontend/src/features/academic-flow/auditScriptManager.ts`
- 修改 `frontend/tests/auditScripts.test.ts`
- 修改 `frontend/tests/nodeSettingCapabilities.test.ts`
- 删除 `frontend/tests/auditScriptManager.test.ts`

## 3. 关键逻辑

### 3.1 只读目录与固定版本解析

- `list_audit_scripts()` 每次扫描 `settings.audit_scripts_root/*/manifest.json`，不再读取数据库。
- 校验脚本 ID、名称、描述、语言、正整数版本、入口文件名/扩展名、真实路径边界、文件存在性与大小上限。
- 单个非法目录记录不含绝对路径的 warning 并跳过；合法目录继续返回。
- 重复 ID 的所有合法候选均不对外返回，避免不确定选择。
- 返回字段保持前端契约：`id`、`name`、`description`、`language`、`version`、`sha256`、`updatedAt`。
- 运行时直接扫描并校验匹配 ID 的 manifest 元数据，在 manifest 层拒绝重复 ID，再仅校验节点请求的 `versions/<version>/<entry>` 并重新计算 SHA-256。
- manifest 的当前版本只作为可解析版本上限；最新版入口缺失、越界或超过大小限制时，不影响仍完整存在且哈希匹配的旧固定版本运行。列表接口仍要求最新版入口有效，因此不会向新节点提供损坏的最新版。
- 清单、版本、路径或哈希异常统一映射为不泄露内部路径的 `AuditScriptResolutionError("无法解析审核脚本版本")`。

### 3.2 HTTP API 与旧持久化删除

- 仅保留教师/管理员可读的 `GET /api/workflow-admin/audit-scripts`。
- 删除模板下载、上传、更新、归档路由及其 multipart/超级管理员专用逻辑。
- 删除旧审核脚本 repository 与模板压缩包生成服务。
- 路由删除后的实际 FastAPI 语义纳入测试：集合路径 POST 为 405，已不存在的模板/item 路径为 404。

### 3.3 版本控制示例脚本

- `.gitignore` 不再忽略 `backend/scripts/*`；既有全局 Python 缓存规则仍会忽略脚本目录下的 `__pycache__`。
- 示例脚本 `material-basic-check` 使用版本 1，并遵循现有 stdin/stdout JSON 协议。
- 处理结果的 `details.fileResults` 对每个输入文件保留一个结果，同时输出协议要求的 `checkedFileCount` 与 `issues`。
- 示例脚本不读取项目环境变量、不访问网络、不增加依赖。

### 3.4 前端只读选择

- 删除教务流程页“审核脚本”按钮、管理弹窗、上传/更新/模板下载 API 客户端及专用样式。
- 选择器仅保留“不启用材料审核”与后端扫描到的预置脚本。
- 选择脚本时继续写入 ID、版本、名称、语言与 SHA-256；清空选择时清除全部五个脚本字段。
- 节点引用的固定旧版本不在当前列表时，继续追加“固定 vN”回显项，不自动切换到最新版。
- 额外清除了 `academicFlowData.ts` 中遗留的硬编码内置脚本列表和新文件节点默认 `check_material.py` 绑定，避免新节点产生已删除脚本配置。

## 4. 测试代码与未执行说明

- 已编写/更新目录发现、非法字段、错误 JSON、缺失/超限入口、路径逃逸、重复 ID、稳定排序、只读 API、固定旧版本、缺失版本、哈希不匹配与防篡改测试。
- 主审查后补充回归测试：manifest 当前版本为 2 时，删除最新版入口或使最新版入口超过大小上限，版本 1 仍能按旧哈希解析；运行时遇到重复 manifest ID 仍拒绝解析。
- 已更新前端选项、无内置硬编码、清空五字段、固定旧版本和新文件节点默认无脚本测试。
- 根据本仓库明确约束，本代理未运行 pytest、Node 测试、构建、浏览器测试或服务启动；因此没有运行时通过结论，TDD 的 RED/GREEN 执行阶段也未进行。

## 5. 静态检查结果

- `git diff --check`：通过，无空白错误。
- 运行时链路静态检查：`find_audit_script_version()` 直接使用 `_valid_manifests()`，先检查唯一 ID 与 manifest 版本上限，再调用 `_record_for_version(manifest, requested_version)`；未调用要求最新版入口有效的 `_current_records()`。
- 后端应用源码检索：无审核脚本 POST/PUT/DELETE 路由、模板路由、旧 repository/template service 引用；仅测试中保留模板路径 404 断言。
- 前端源码检索：无 `AuditScriptManager`、上传/更新/模板下载方法、管理文案、`check_material.py`、`check_filename.mjs`、旧硬编码脚本表或解析函数引用。
- 保留链路检索：`AuditScriptSelector`、`listAuditScripts()`、固定版本回显以及五个节点脚本字段均存在。
- 示例目录结构：仅包含 `manifest.json` 与 `versions/1/handler.py`。
- `jq` 清单契约检查：通过。
- 示例入口 SHA-256：`c75dc5740d9321a1ce372dcfc5077d56b6ad53792e75146aa7c5ca6d8d088782`。
- 依赖清单：无改动。

## 6. 风险与疑问

- 主要剩余风险是自动化测试与构建尚未执行，需由用户手测或后续明确授权后验证。
- 历史数据库中的审核脚本表/迁移未做破坏性删除；应用层已不再读写它们。若后续要求物理清理数据库，需要单独设计向后兼容迁移。
- 未发现阻塞性实现疑问。
- 已避开用户既有未提交修改：`AGENTS.md`、`docs/05_oa_graph.md` 及既有 `.superpowers/` 产物均未修改；本报告是本次唯一新增的 `.superpowers/` 文件。
