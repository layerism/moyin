# 登录账号历史与密码空白实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for inline implementation. If the user explicitly requests delegation, use at most one subagent for the whole implementation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保留点击输入框后出现的账号历史，同时保证登录页首次打开时姓名、学号/工号和密码为空，且密码不由浏览器自动填充。

**Architecture:** 不改变账号历史存储和选择逻辑，只调整两个现有登录表单的原生 `autocomplete` 契约。登录模式关闭浏览器表单与字段自动填充，注册模式继续使用标准的新账号和新密码语义。

**Tech Stack:** React、TypeScript、Vite、HTML 表单自动填充属性。

## Global Constraints

- 在当前分支实施，不创建 worktree。
- 设计文档提交 `af52a25` 作为实施前检查点；实现完成后只创建一个代码提交，中间不提交。
- 不暂存用户已有的 `AGENTS.md`、`docs/05_oa_graph.md` 和 `.superpowers/` 文件。
- 不运行自动化测试、构建、浏览器或 Playwright；只做静态业务审计并交由用户手测。
- 不修改 `rememberedAccount`、`localStorage` 数据结构、后端认证、数据库或 OA 业务逻辑。
- 实现后使用本地 Vite 方式重启前端，不使用 Docker。

## File Map

- `frontend/src/features/auth/AuthPortal.tsx`：主教师/学生登录页，保留账号历史并关闭登录模式浏览器自动填充。
- `frontend/src/features/auth/StudentAccessGate.tsx`：分享链接学生登录页，统一关闭登录模式浏览器自动填充。

---

### Task 1: 调整主登录页自动填充契约

**Files:**
- Modify: `frontend/src/features/auth/AuthPortal.tsx:143-200`

**Interfaces:**
- Consumes: `mode: "login" | "register"`、空的 `EMPTY_AUTH_FORM`、现有 `AccountHistoryPicker`。
- Preserves: `rememberLoginAccount` 只保存 `identifier` 和 `name`；`selectRememberedAccount` 不修改 `password`。
- Produces: 登录模式表单和密码字段均为 `autoComplete="off"`，注册模式继续使用 `new-password`。

- [ ] **Step 1: 关闭登录模式的表单自动填充**

将表单开始标签改为：

```tsx
<form
  autoComplete={mode === "login" ? "off" : "on"}
  id={`${fieldPrefix}-auth-form`}
  name={`${fieldPrefix}-auth-form`}
  onSubmit={submit}
>
```

- [ ] **Step 2: 保持历史账号字段初始空白**

确认姓名和学号/工号输入框继续使用：

```tsx
autoComplete="off"
value={form.name}
```

```tsx
autoComplete="off"
value={form.identifier}
```

不向表单初始状态写入历史账号，也不改变 `onFocus` 展示历史账号的逻辑。

- [ ] **Step 3: 关闭登录密码自动填充**

将密码输入框属性改为：

```tsx
autoComplete={mode === "register" ? "new-password" : "off"}
name={mode === "register" ? "new-password" : "account-secret"}
```

注册确认密码继续使用 `autoComplete="new-password"`。

### Task 2: 调整分享链接登录页自动填充契约

**Files:**
- Modify: `frontend/src/features/auth/StudentAccessGate.tsx:94-120`

**Interfaces:**
- Consumes: `mode: "login" | "register"` 和空的本地表单状态。
- Produces: 登录模式姓名、学号、密码均关闭浏览器自动填充；注册模式保留标准字段语义。

- [ ] **Step 1: 关闭登录模式的表单自动填充**

将表单开始标签改为：

```tsx
<form
  autoComplete={mode === "login" ? "off" : "on"}
  className="oa-auth-form"
  onSubmit={submit}
>
```

- [ ] **Step 2: 按模式设置姓名和学号字段**

```tsx
autoComplete={mode === "register" ? "name" : "off"}
```

```tsx
autoComplete={mode === "register" ? "username" : "off"}
```

- [ ] **Step 3: 按模式设置密码字段**

```tsx
autoComplete={mode === "register" ? "new-password" : "off"}
name={mode === "register" ? "new-password" : "account-secret"}
```

确认密码继续使用 `autoComplete="new-password"`。

### Task 3: 静态审计、重启和提交

**Files:**
- Inspect: `frontend/src/features/auth/AuthPortal.tsx`
- Inspect: `frontend/src/features/auth/StudentAccessGate.tsx`

**Interfaces:**
- Produces: 一个只包含两个前端文件的实现提交和用户手测清单。

- [ ] **Step 1: 静态审计数据边界**

```bash
rg -n "EMPTY_AUTH_FORM|rememberLoginAccount|selectRememberedAccount|autoComplete|account-secret" \
  frontend/src/features/auth/AuthPortal.tsx \
  frontend/src/features/auth/StudentAccessGate.tsx \
  frontend/src/features/auth/rememberedAccount.ts
```

Expected: 初始表单仍为空；账号历史仍只写入 `identifier` 和 `name`；登录密码字段使用 `off`，注册密码字段使用 `new-password`。

- [ ] **Step 2: 检查差异格式和范围**

```bash
git diff --check
git diff --name-only
```

Expected: 本次代码改动只出现在两个允许文件；用户原有文件未被修改或暂存。

- [ ] **Step 3: 重启本地 Vite 前端**

先只读解析当前监听 `127.0.0.1:5173` 的进程，向精确 PID 发送 `TERM`，再从 `frontend/` 启动：

```bash
./node_modules/.bin/vite --host 127.0.0.1
```

Expected: 新 Vite 进程监听 `127.0.0.1:5173`；不调用 Docker，不构建。

- [ ] **Step 4: 只暂存两个前端文件并提交**

```bash
git add frontend/src/features/auth/AuthPortal.tsx frontend/src/features/auth/StudentAccessGate.tsx
git diff --cached --check
git diff --cached --name-only
git commit -m "fix: keep login passwords empty"
```

Expected: 实现提交只包含两个前端文件。

- [ ] **Step 5: 交付用户手测清单**

```text
1. 打开教师登录页：姓名、工号、密码均为空。
2. 点击姓名或工号：出现历史账号；选择后仅姓名、工号回填。
3. 打开学生登录页：姓名、学号、密码均为空，历史账号行为相同。
4. 打开分享链接登录页：姓名、学号、密码均为空。
5. 切换到注册模式：新密码和确认密码输入不受影响。
6. 已由浏览器密码管理器保存的记录不再由页面主动请求填充；浏览器自身扩展仍可能提供用户触发的密码菜单。
```

## Plan Self-Review

- Spec coverage: 主登录页、分享链接登录页、历史账号保留、密码空白和注册模式均有对应步骤。
- Scope: 仅修改两个 React 文件，不新增依赖或抽象。
- Data consistency: `rememberedAccount` 不改，密码从不进入应用持久化数据。
- Verification policy: 不运行测试、构建或浏览器，只做静态审计并交由用户手测。
