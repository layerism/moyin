# Task 5：超级管理员文件审核脚本管理弹窗报告

## RED / GREEN

- **RED**：新增 `frontend/tests/auditScriptManager.test.ts` 后执行
  `cd frontend && node --experimental-strip-types --test tests/auditScriptManager.test.ts`，因
  `auditScriptManager.ts` 尚不存在而以 `ERR_MODULE_NOT_FOUND` 失败。
- **GREEN**：实现表单状态与校验后，同一测试通过 `5/5`：名称与描述长度/必填、`.py/.js` 类型、新建限制、更新语言一致性、更新名称锁定且描述可改。

## 变更

- `frontend/src/features/academic-flow/auditScriptManager.ts`：可单测的表单模式、初始状态与校验逻辑。
- `frontend/src/features/academic-flow/AuditScriptManagerDialog.tsx`：列表/表单两态管理弹窗；弹窗打开时读取列表；模板下载、上传、同语言版本更新、错误处理和成功后的本地列表更新。
- `frontend/src/features/home/HomeView.tsx`：仅 `teacherIdentity.role === "super_admin"` 渲染“审核脚本”入口及弹窗。
- `frontend/src/styles.css`：白色面板、蓝色主操作、表格、表单、错误态及窄屏布局。
- `frontend/tests/auditScriptManager.test.ts`：表单规则单元测试。

## 验证输出

```text
cd frontend && node --experimental-strip-types --test tests/auditScriptManager.test.ts tests/auditScripts.test.ts
tests 9; pass 9; fail 0

cd frontend && npm run build
tsc -b && vite build
108 modules transformed; built in 616ms; exit 0
```

渲染核验：以超级管理员身份在 `http://localhost:5173/` 打开“教务流程”，确认入口存在、弹窗显示模板下载/上传按钮与六列表头，并进入“上传新脚本”表单；390px 宽度下弹窗为全屏且操作按钮纵向排列。浏览器控制台 `error/warn` 均为空。开发服务已重启。

## React / 可访问性自审

- 列表请求只在组件挂载（即弹窗打开）时发起；表单提交与模板下载均由事件处理触发，未在 effect 中提交数据。
- 列表和表单为同一弹窗的互斥视图；提交期间关闭、取消、重复提交均禁用。
- 所有表单控件有可见 `label`，管理面板使用 `role="dialog"`、`aria-modal`、标题关联，接口及校验错误使用 `role="alert"`。
- 超级管理员入口以前端条件控制展示；后端权限边界仍由既有 API 强制执行。

## 顾虑

- brief 同时规定 `AuditScriptManager.tsx` 与 `auditScriptManager.ts`。当前 macOS 大小写不敏感卷上的 TypeScript 将它们识别为仅大小写不同的同一模块，`npm run build` 会报 TS1261。因此 JSX 组件命名为 `AuditScriptManagerDialog.tsx`；纯逻辑模块保留 brief 指定的 `auditScriptManager.ts` 与导出接口。该调整是编译兼容性所必需。
- 本次未向本地 API 实际提交新脚本或新版本，以免改变现有开发数据；相关请求已由前置 API 任务提供，客户端的成功分支以 API 返回摘要更新列表。

## 审查修复：文件内容校验

- 根因：前端提交前仅校验名称、描述、扩展名和更新语言；未覆盖后端已要求的文件大小及 UTF-8 编码。
- 修复：新增独立异步 `validateAuditScriptFileContent(file)`，保留 `validateAuditScriptForm` 的同步字段校验。该函数先检查 `file.size` 的非空与 1 MiB 上限，再读取字节，以 `TextDecoder("utf-8", { fatal: true })` 严格解码。上传/更新请求仅在两类校验均通过后发起；异步读取期间复用提交中禁用状态。
- 测试：使用真实 Node `File` 字节，覆盖空文件、`> 1 MiB`、非法 UTF-8 字节 `[0xc3, 0x28]` 与合法 UTF-8 Python 内容。

```text
cd frontend && node --experimental-strip-types --test tests/auditScriptManager.test.ts tests/auditScripts.test.ts
tests 13; pass 13; fail 0

cd frontend && npm run build
tsc -b && vite build
108 modules transformed; built in 668ms; exit 0
```
