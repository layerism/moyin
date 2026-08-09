# Task 7：审核脚本管理集成验证与交付检查

**状态：`DONE_WITH_CONCERNS`**  
**验证日期：** 2026-07-17  
**提交范围：** `0ee3cd5..ba936c8`  
**原则：** 本次仅做验证；未上传真实脚本、未调用会改变开发数据的管理接口、未修改功能代码或提交工作区内容。

## 1. 自动化验证

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 后端聚焦测试（首次） | `cd backend && pytest -q tests/test_audit_scripts_api.py tests/test_audit_script_runtime.py` | 未执行：当前 shell 的 `PATH` 不含 `pytest`（`command not found`）。|
| 后端聚焦测试（项目既有虚拟环境） | `cd backend && .venv/bin/python -m pytest -q tests/test_audit_scripts_api.py tests/test_audit_script_runtime.py` | **PASS：16 passed, 1 warning, 0.72s**。唯一 warning 为依赖 `starlette.formparsers` 的 `PendingDeprecationWarning`，与本功能无关。|
| 前端聚焦测试 | `cd frontend && node --experimental-strip-types --test tests/auditScripts.test.ts tests/auditScriptManager.test.ts` | **PASS：13 passed, 0 failed, 114ms**。Node 输出 type stripping experimental warning。|
| 前端生产构建 | `cd frontend && npm run build` | **PASS**：`tsc -b && vite build` 成功，108 modules transformed，676ms。|
| 服务可达性（非浏览器） | `curl -sS -o /tmp/audit-script-management-academic-flow.html -w '%{http_code} %{content_type}\\n' http://localhost:5173/academic-flow` | **PASS**：`200 text/html`。仅证明开发服务器对目标路由可达，不证明页面渲染正确。|

测试产生的 `backend` 目录下 `__pycache__`、`.pytest_cache` 和 `*.egg-info` 中间缓存已按项目约定清理；未触碰 `.venv`。

## 2. 权限、版本与安全语义

自动化测试覆盖并通过以下关键语义：

- 普通教师可列出脚本元信息；直接请求 Python 模板、创建脚本、更新脚本均为 `403`（`test_teacher_can_list_but_cannot_download_or_upload_script`）。
- 超级管理员创建脚本获得版本 `1`；同语言更新后版本递增至 `2`，旧版本文件仍存在；跨语言更新为 `422`（`test_super_admin_creates_immutable_new_version_and_archives_script`）。
- API 列表与创建响应不暴露 `directoryPath`、`entryFilename` 或 `source`；运行时路径逃逸、期望哈希不匹配、文件缺失/篡改和底层读库错误均被统一拒绝，错误消息不泄露绝对路径（`test_audit_script_runtime.py`）。
- 节点选择逻辑测试确认已选脚本保存不可变的 ID、版本和 SHA-256；若后续已有最新版本，旧节点仍回显“固定 v2”，而不自动升级（`frontend/tests/auditScripts.test.ts`）。

静态核对与测试结论一致：

- 管理入口仅在 `teacherIdentity.role === "super_admin"` 时渲染：`frontend/src/features/home/HomeView.tsx:576-580`。
- 模板下载、创建、更新 API 均依赖 `get_current_super_admin`：`backend/app/api/routes/workflow_admin.py:37-73`。
- 管理弹窗包含两类模板下载、上传、名称/描述/文件字段、版本表格和更新操作：`frontend/src/features/academic-flow/AuditScriptManagerDialog.tsx:120-203`。
- 文件上传节点仅提供“材料审核脚本”下拉选择：`frontend/src/features/academic-flow/AuditScriptSelector.tsx:40-58`。
- 固定版本回显与新选择写入 ID/版本/哈希：`frontend/src/features/academic-flow/auditScripts.ts:24-91`。

## 3. 浏览器/UI 验证

**目标 URL：** `http://localhost:5173/academic-flow`  
**目标 viewport：** 桌面与窄屏；**实际 viewport：** 未取得。

已严格按 Browser/IAB 工作流初始化。运行时要求的模块
`/Users/luyukun/.codex/plugins/cache/openai-bundled/browser/26.715.21425/skills/control-in-app-browser/scripts/browser-client.mjs`
不存在，初始化直接返回：

```text
Module not found: .../scripts/browser-client.mjs
```

根据任务约束，Browser runtime 明确失败后不得自行切换独立 Playwright，因此没有进行浏览器回退。以下 Browser 必需项均为 **BLOCKED（非功能失败）**：

| 检查 | 状态 | 原因 |
| --- | --- | --- |
| page identity（URL/title） | BLOCKED | 无法建立 Browser tab。|
| 非空白页面 | BLOCKED | 无 DOM snapshot。|
| 无 Vite/framework overlay | BLOCKED | 无截图或 DOM。|
| console（error/warn） | BLOCKED | 无浏览器 console access。|
| 截图/DOM 证据 | BLOCKED | 无可用 Browser runtime。|
| 超级管理员入口、管理弹窗、模板下载 UI | BLOCKED | 未能在当前会话取得管理员 UI。|
| 节点选择器交互及 v1→v2 固定版本 UI 路径 | BLOCKED | 不能创建/保存开发数据，且无 Browser runtime。|
| 普通教师入口隐藏与窄屏布局 | BLOCKED | 未能切换普通教师会话或设定 viewport。|

设计的浏览器交互路径本应为：管理员进入“教务流程”→点击“审核脚本”→核对模板下载与管理弹窗→在文件上传节点选择脚本→新增版本后核对旧节点固定版本→切换普通教师核对入口隐藏。该路径未执行；其权限与版本后端/纯函数部分已由第 2 节的测试证据覆盖。

## 4. Git 范围与工作区

验证时执行：

```text
git log --oneline -8
ba936c8 Validate audit script file content
49e66de Checkpoint before audit script file validation
b5fb663 Add audit script management dialog
fdb531a Checkpoint before audit script manager
24edf2d Extend audit script client model
2307d40 Harden audit script runtime errors
5c38b10 Add audit script runtime resolver
8b2f1f9 Extend audit script metadata
```

提交范围统计为 18 个文件、1,174 行新增、123 行删除；功能代码和测试均在已提交范围中。范围还包含一个既有的 `.superpowers/sdd/audit-script-management-task-4-report.md` 文档文件。

验证前的 `git status --short` 除预期的 `docs/05_oa_graph.md`、`.superpowers/brainstorm/`、`.superpowers/sdd/` 外，还出现已修改的 `AGENTS.md`。该文件及所有预存未提交内容均未改动。生成本报告后，本报告本身也作为预期的未跟踪 `.superpowers/sdd/` 交付物出现。

## 5. 结论与剩余风险

自动化、构建、权限、版本固定与运行时安全拒绝均通过，代码静态结构与设计说明相符。交付不标记为完全完成的唯一原因是 Browser/IAB 插件缺失其指定运行时模块，导致本次无法取得真实 UI、DOM、console、截图、管理员/普通教师会话或窄屏证据。

恢复 Browser/IAB 运行时后，应在不上传真实脚本的隔离测试数据下补做第 3 节的完整交互路径，并保存桌面和窄屏截图及 console 记录。

## 6. 控制器补充浏览器验证

后续核对发现初始化失败源于将插件根目录误解析为技能目录；实际运行时文件位于
`browser/26.715.21425/scripts/browser-client.mjs`。使用正确插件根目录重新连接 Browser/IAB 后，完成以下验证：

- 页面身份：`http://localhost:5173/academic-flow`，标题“文档自动填写系统”，主区域非空且无 Vite/framework 错误覆盖层；
- 超级管理员页面存在“审核脚本”按钮；打开后显示“文件审核脚本”对话框、Python/JavaScript 模板下载、上传新脚本及六列表头；
- 上传表单显示功能名称、功能描述、脚本文件、取消和上传操作；未选择文件时不会产生上传请求；
- 390 x 844 viewport 下对话框宽度 375px、高度 844px，`scrollWidth === clientWidth`，无横向溢出；
- 在流程画布临时新增文件上传节点后，节点设置仅显示“材料审核脚本”下拉框，没有模板下载或上传管理按钮；
- Browser console 的 `error`/`warn` 均为空；
- 临时节点已删除并通过“放弃修改并离开”清理，最终页面恢复到教务流程列表，未改变服务端流程或脚本数据。

因此本任务的 Browser/UI 阻塞已解除。普通教师真实会话未在浏览器中切换，但入口隐藏与管理 API `403` 已由条件渲染静态核对和后端自动化测试覆盖。
