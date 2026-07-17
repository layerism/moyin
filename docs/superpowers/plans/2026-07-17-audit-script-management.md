# File Audit Script Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将文件审核脚本的模板下载、上传和版本更新集中到教务流程列表页，由超级管理员管理；普通教师只在文件上传节点中选择管理员发布的固定版本，并为后续审核执行提供安全的版本解析入口。

**Architecture:** 继续使用现有 SQLite 元数据表与 `backend/scripts/global/<script_id>/<version>/` 不可变目录。后端补充描述、更新时间和固定版本解析服务；前端新增列表页管理弹窗，节点检查器降级为纯选择器。节点仍保存脚本 ID、版本和哈希，因此脚本更新不会改变既有流程配置。

**Tech Stack:** FastAPI、SQLite、Python `pathlib/hashlib`、React 18、TypeScript、Vite、Node test runner、Pytest。

## Global Constraints

- 保留当前分支，不创建 worktree。
- 不提交 `docs/05_oa_graph.md`、`.superpowers/brainstorm/`、`.superpowers/sdd/` 等既有无关改动。
- 管理入口与模板下载、创建、更新接口仅允许 `super_admin`；普通教师只能读取活动脚本元信息。
- API 不返回脚本源代码、`directory_path` 或服务器绝对路径。
- 更新脚本只新增不可变版本目录，不覆盖或删除历史版本。
- 本期只解析执行目标，不运行脚本、不加载项目 `.env`。

---

## Task 1: 扩展脚本元数据并兼容已有数据库

**Files:**

- Modify: `backend/app/core/database.py`
- Modify: `backend/app/repositories/audit_scripts.py`
- Modify: `backend/tests/test_audit_scripts_api.py`

- [ ] **Step 1: 先写失败测试，覆盖描述、更新时间和旧库迁移**

在 `backend/tests/test_audit_scripts_api.py` 通过仓储层直接增加断言，避免本任务提前依赖下一任务的 API 表单改造：

```python
created = create_audit_script(
    "材料基础校验",
    "校验文件结构与字段",
    "check.py",
    b"def run(payload): return {'passed': True}",
    admin_id,
)
assert created["description"] == "校验文件结构与字段"
assert created["updatedAt"]
assert list_audit_scripts()[0]["description"] == "校验文件结构与字段"
```

另建一个只含旧版 `audit_scripts` 表结构的临时数据库，调用 `initialize_database()` 后断言 `description`、`updated_at` 两列存在，且历史记录满足 `description = ''`、`updated_at = created_at`。

- [ ] **Step 2: 运行定向测试并确认失败原因正确**

Run: `cd backend && pytest -q tests/test_audit_scripts_api.py`

Expected: FAIL，仓储签名/摘要缺少 `description`/`updatedAt` 或旧表缺少新列。

- [ ] **Step 3: 添加幂等迁移**

在 `initialize_database()` 中调用 `_apply_audit_script_metadata_migration(connection)`。该函数使用 `PRAGMA table_info(audit_scripts)` 判断列是否存在，并依次执行：

```python
ALTER TABLE audit_scripts ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE audit_scripts ADD COLUMN updated_at TEXT;
UPDATE audit_scripts SET updated_at = created_at WHERE updated_at IS NULL;
```

记录迁移 ID `20260717_add_audit_script_metadata`。新建表定义直接包含：

```sql
description TEXT NOT NULL DEFAULT '',
updated_at TEXT NOT NULL,
```

- [ ] **Step 4: 扩展仓储接口与清单**

将仓储签名调整为：

```python
def create_audit_script(
    name: str, description: str, filename: str, content: bytes, admin_id: int
) -> dict[str, object]: ...

def create_audit_script_version(
    script_id: str, description: str, filename: str, content: bytes, admin_id: int
) -> dict[str, object]: ...
```

新增 `_normalize_description()`，去除首尾空白，要求非空且最多 500 字符。创建时写入 `description` 与 `updated_at`；更新版本时同时更新 `current_version`、`description` 与 `updated_at`。`list_audit_scripts()` 和 `_summary()` 返回：

```python
{
    "id": script_id,
    "name": name,
    "description": description,
    "language": language,
    "version": version,
    "sha256": sha256,
    "updatedAt": updated_at,
}
```

`manifest.json` 增加 `description` 字段。

- [ ] **Step 5: 运行测试并提交**

Run: `cd backend && pytest -q tests/test_audit_scripts_api.py`

Expected: PASS。

```bash
git add backend/app/core/database.py backend/app/repositories/audit_scripts.py backend/tests/test_audit_scripts_api.py
git commit -m "Extend audit script metadata"
```

---

## Task 2: 扩展管理 API 并保持权限边界

**Files:**

- Modify: `backend/app/api/routes/workflow_admin.py`
- Modify: `backend/tests/test_audit_scripts_api.py`

- [ ] **Step 1: 写 API 失败测试**

补充以下场景：

- `POST` 缺少或提交空描述时返回 `422`；
- `PUT` 接收 `description + file`，版本递增且描述更新；
- 普通教师对 `PUT` 返回 `403`；
- 列表响应包含描述和更新时间，但不包含 `directoryPath`、`entryFilename`、源代码；
- 更新时上传不同语言文件返回 `422`。

- [ ] **Step 2: 运行定向测试并确认失败**

Run: `cd backend && pytest -q tests/test_audit_scripts_api.py`

Expected: FAIL，路由尚未接收 `description`。

- [ ] **Step 3: 修改 FastAPI 表单参数**

`post_audit_script()` 新增：

```python
description: Annotated[str, Form(min_length=1, max_length=500)]
```

`put_audit_script()` 同样新增 `description`，并将其传入仓储。继续使用 `Depends(get_current_super_admin)` 保护模板、创建、更新和归档接口；`GET /audit-scripts` 继续使用路由级教师鉴权。

- [ ] **Step 4: 运行测试并提交**

Run: `cd backend && pytest -q tests/test_audit_scripts_api.py`

Expected: PASS。

```bash
git add backend/app/api/routes/workflow_admin.py backend/tests/test_audit_scripts_api.py
git commit -m "Expose audit script management metadata"
```

---

## Task 3: 增加固定版本运行时解析入口

**Files:**

- Create: `backend/app/services/audit_script_runtime.py`
- Create: `backend/tests/test_audit_script_runtime.py`

- [ ] **Step 1: 写解析器失败测试**

测试创建两个版本后，调用：

```python
descriptor = resolve_audit_script_version(script_id, 1, version_1_sha256)
assert descriptor.version == 1
assert descriptor.language == "py"
assert descriptor.entry_path.name == "handler.py"
```

并覆盖：节点哈希不匹配、数据库版本不存在、入口路径逃逸脚本根目录、文件缺失、磁盘文件哈希变化。所有异常统一为 `AuditScriptResolutionError`，且错误信息不泄漏绝对路径。

- [ ] **Step 2: 运行测试并确认模块尚不存在**

Run: `cd backend && pytest -q tests/test_audit_script_runtime.py`

Expected: FAIL，无法导入运行时解析模块。

- [ ] **Step 3: 实现只读解析服务**

定义不可变描述符：

```python
@dataclass(frozen=True)
class AuditScriptRuntimeDescriptor:
    script_id: str
    version: int
    language: Literal["py", "js"]
    entry_path: Path
    sha256: str
```

实现：

```python
def resolve_audit_script_version(
    script_id: str,
    version: int,
    expected_sha256: str,
) -> AuditScriptRuntimeDescriptor: ...
```

解析器从 `audit_script_versions` 读取固定版本，使用 `Path.resolve()` 与 `is_relative_to()` 确认版本目录和入口文件位于 `Path(settings.audit_scripts_root).resolve()` 下，再校验文件存在和实际 SHA-256。不要执行文件，也不要读取环境变量。

- [ ] **Step 4: 运行测试并提交**

Run: `cd backend && pytest -q tests/test_audit_script_runtime.py`

Expected: PASS。

```bash
git add backend/app/services/audit_script_runtime.py backend/tests/test_audit_script_runtime.py
git commit -m "Add audit script runtime resolver"
```

---

## Task 4: 扩展前端脚本模型与 API 客户端

**Files:**

- Modify: `frontend/src/features/academic-flow/auditScripts.ts`
- Modify: `frontend/src/features/academic-flow/api.ts`
- Modify: `frontend/tests/auditScripts.test.ts`

- [ ] **Step 1: 写类型映射与固定版本失败测试**

将测试夹具增加：

```typescript
description: "校验文件命名与结构",
updatedAt: "2026-07-17T10:00:00+00:00",
```

断言脚本选项继续使用 API 返回的当前版本；当节点已经保存旧版本时，`getSelectedAuditScriptValue(node)` 仍返回旧的 `uploaded:<id>:<version>`，不会自动切到列表中的最新版。

- [ ] **Step 2: 运行前端定向测试并确认失败**

Run: `cd frontend && node --experimental-strip-types --test tests/auditScripts.test.ts`

Expected: FAIL，类型尚不包含管理元数据或缺少旧版本回显逻辑。

- [ ] **Step 3: 扩展类型和 API 方法**

`AuditScriptSummary` 增加 `description`、`updatedAt`。API 调整为：

```typescript
uploadAuditScript(name: string, description: string, file: File): Promise<AuditScriptSummary>
updateAuditScript(scriptId: string, description: string, file: File): Promise<AuditScriptSummary>
```

两个方法都使用 `FormData`；更新方法请求 `PUT /api/workflow-admin/audit-scripts/{id}`。保留模板下载方法。

为了让旧版本节点在下拉框中可见，`getAuditScriptOptions(scripts, node?)` 在当前列表不包含节点固定版本值时，追加一个只用于回显的选项：`<节点脚本名>（固定 vN）`。用户重新选择管理员脚本时，仍写入当前最新版。

- [ ] **Step 4: 运行测试并提交**

Run: `cd frontend && node --experimental-strip-types --test tests/auditScripts.test.ts`

Expected: PASS。

```bash
git add frontend/src/features/academic-flow/auditScripts.ts frontend/src/features/academic-flow/api.ts frontend/tests/auditScripts.test.ts
git commit -m "Extend audit script client model"
```

---

## Task 5: 实现超级管理员脚本管理弹窗

**Files:**

- Create: `frontend/src/features/academic-flow/auditScriptManager.ts`
- Create: `frontend/src/features/academic-flow/AuditScriptManager.tsx`
- Create: `frontend/tests/auditScriptManager.test.ts`
- Modify: `frontend/src/features/home/HomeView.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: 为表单规则写失败测试**

在纯 TypeScript 模块中测试：

- 名称去除首尾空格后不能为空且不超过 120 字符；
- 描述不能为空且不超过 500 字符；
- 新增只接受 `.py`/`.js`；
- 更新必须保持原语言；
- 更新模式锁定功能名称但允许修改描述。

Run: `cd frontend && node --experimental-strip-types --test tests/auditScriptManager.test.ts`

Expected: FAIL，管理表单模型尚不存在。

- [ ] **Step 2: 实现可测试的表单状态与校验**

在 `auditScriptManager.ts` 导出：

```typescript
export type AuditScriptFormMode =
  | { kind: "create" }
  | { kind: "update"; script: AuditScriptSummary };

export function validateAuditScriptForm(input: {
  mode: AuditScriptFormMode;
  name: string;
  description: string;
  file: File | null;
}): string | null;
```

错误信息使用用户可理解的中文，并与后端限制一致。

- [ ] **Step 3: 实现管理弹窗组件**

`AuditScriptManager.tsx` 接收 `onClose`。打开时调用 `listAuditScripts()`。列表展示名称、描述、语言、当前版本和格式化后的更新时间；顶部提供 Python/JavaScript 模板下载和“上传新脚本”。每行提供“更新版本”。

组件内部只有两种视图：

1. 列表视图；
2. 新增/更新表单视图。

禁止再打开嵌套弹窗。提交期间禁用关闭与重复提交；成功后回到列表并以返回值更新对应项；失败信息显示在弹窗内 `role="alert"`。更新模式锁定名称并限制同语言文件。

- [ ] **Step 4: 在教务流程页接入超级管理员入口**

在 `AcademicFlowView` 增加 `scriptManagerOpen` 状态。在现有“创建流程”按钮旁，仅当：

```typescript
teacherIdentity.role === "super_admin"
```

时渲染“审核脚本”按钮。普通教师 DOM 中不存在该按钮。打开时渲染 `AuditScriptManager`。

在 `styles.css` 添加与现有 `.modal-backdrop`、`.drive-tools` 视觉语言一致的弹窗、表格、表单、错误态和移动端布局样式，不改变页面整体布局。

- [ ] **Step 5: 运行测试和类型构建并提交**

Run: `cd frontend && node --experimental-strip-types --test tests/auditScriptManager.test.ts tests/auditScripts.test.ts`

Expected: PASS。

Run: `cd frontend && npm run build`

Expected: PASS，无 TypeScript 错误。

```bash
git add frontend/src/features/academic-flow/auditScriptManager.ts frontend/src/features/academic-flow/AuditScriptManager.tsx frontend/tests/auditScriptManager.test.ts frontend/src/features/home/HomeView.tsx frontend/src/styles.css
git commit -m "Add audit script management dialog"
```

---

## Task 6: 将节点检查器收敛为纯脚本选择器

**Files:**

- Modify: `frontend/src/features/academic-flow/AuditScriptSelector.tsx`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/tests/auditScripts.test.ts`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: 增加选择行为测试**

补充断言：

- 普通教师和超级管理员使用相同的脚本选项；
- 选中管理员脚本写入该脚本当前版本与哈希；
- 旧节点固定版本值可回显；
- 选择“不启用材料审核”会清空上传脚本标识。

- [ ] **Step 2: 移除节点内管理能力**

从 `AuditScriptSelector` 删除：

- `isSuperAdmin` prop；
- 模板下载处理；
- 文件上传处理；
- 上传中状态和管理按钮。

组件只负责加载脚本列表、显示选择下拉框、调用 `resolveAuditScriptSelection()` 和呈现列表加载错误。

同步从 `AcademicFlowDesigner` 与 `App.tsx` 移除仅为节点内管理而存在的 `isSuperAdmin` 传递，并删除不再使用的 `.audit-script-actions`、`.audit-script-upload` 样式。

- [ ] **Step 3: 运行前端测试和构建并提交**

Run: `cd frontend && node --experimental-strip-types --test tests/auditScripts.test.ts tests/auditScriptManager.test.ts`

Expected: PASS。

Run: `cd frontend && npm run build`

Expected: PASS。

```bash
git add frontend/src/features/academic-flow/AuditScriptSelector.tsx frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/App.tsx frontend/tests/auditScripts.test.ts frontend/src/styles.css
git commit -m "Separate audit script management from nodes"
```

---

## Task 7: 集成验证与交付检查

**Files:**

- Verify: `backend/tests/test_audit_scripts_api.py`
- Verify: `backend/tests/test_audit_script_runtime.py`
- Verify: `frontend/tests/auditScripts.test.ts`
- Verify: `frontend/tests/auditScriptManager.test.ts`
- Verify: `docs/superpowers/specs/2026-07-17-audit-script-management-design.md`

- [ ] **Step 1: 运行后端相关测试**

Run: `cd backend && pytest -q tests/test_audit_scripts_api.py tests/test_audit_script_runtime.py`

Expected: PASS。

- [ ] **Step 2: 运行前端相关测试和构建**

Run: `cd frontend && node --experimental-strip-types --test tests/auditScripts.test.ts tests/auditScriptManager.test.ts`

Expected: PASS。

Run: `cd frontend && npm run build`

Expected: PASS。

- [ ] **Step 3: 做权限与版本语义人工核对**

使用超级管理员账号确认：教务流程页出现“审核脚本”；可下载两种模板；可填写名称、描述并上传；更新同语言脚本后版本递增。使用普通教师账号确认：入口不可见，但文件上传节点可选择脚本。

创建一个节点并选择版本 `1`，再上传版本 `2`：旧节点仍显示并保存版本 `1`；清空或新配置节点重新选择时保存版本 `2`。

- [ ] **Step 4: 检查安全边界**

确认响应中不存在绝对目录和源代码；普通教师直接请求模板、创建和更新接口均为 `403`；运行时解析器对路径逃逸、哈希不匹配和文件篡改均拒绝。

- [ ] **Step 5: 检查工作区和提交范围**

Run: `git status --short`

Expected: 只剩用户原有的 `docs/05_oa_graph.md` 与 `.superpowers/brainstorm/`、`.superpowers/sdd/` 未提交内容；本功能文件均已提交。

Run: `git log --oneline -8`

Expected: 能看到本计划各任务对应的独立提交，便于逐步回滚。
