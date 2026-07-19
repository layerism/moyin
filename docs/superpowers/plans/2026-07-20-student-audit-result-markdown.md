# 学生审核结果 Markdown 展示实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. If the user explicitly requests delegation, use at most one subagent for the whole plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学生审核结果只显示安全渲染的 `reason` Markdown，不再显示 `details` JSON，同时保留后端结构化结果和现有审核状态语义。

**Architecture:** 保持审核脚本、数据库和 API 契约不变，在现有 `AuditResult` 内使用 `react-markdown` 将 `reason` 转为 React 元素。显式跳过原始 HTML、禁用图片、保留默认安全 URL 转换，并用现有审核结果卡片承载紧凑 Markdown 排版；`details` 仍由后端返回但不进入学生 DOM。

**Tech Stack:** React 18、TypeScript、Vite、`react-markdown`、原生 CSS。

## Global Constraints

- 当前分支实施，不创建 worktree。
- 设计检查点为 `098939f`；实施期间不创建中间提交，完成后只创建一个实现提交。
- 不修改后端、数据库、审核任务状态机、DAG、审核脚本输出校验或 API 响应结构。
- `reason` 是学生可见 Markdown；`details` 继续持久化并保留在 API 中，但学生页面不得渲染。
- 不启用 GFM、`rehype-raw`、HTML 清洗库、数学公式、流程图或图片加载。
- 不使用 `dangerouslySetInnerHTML`，不覆盖 `react-markdown` 的默认安全 URL 转换。
- 不暂存或覆盖用户已有的 `AGENTS.md`、`docs/05_oa_graph.md` 和 `.superpowers/` 文件。
- 不运行自动化测试、构建、浏览器或 Playwright；只做静态调用链和差异审计，由用户手测。
- 完成后检查并清理仓库内 `__pycache__`、`.pytest_cache`、`*.egg-info`，再用本地进程重启前后端，不使用 Docker。

---

### Task 1: 增加安全 Markdown 渲染依赖

**Files:**

- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`

**Interfaces:**

- Produces: `react-markdown` 默认导出组件及其 TypeScript 类型。

- [ ] **Step 1: 安装唯一新增依赖**

在 `frontend` 目录执行：

```bash
npm install react-markdown
```

预期：只新增 `react-markdown` 及其 npm 必需传递依赖；不安装 `remark-gfm`、`rehype-raw` 或其他 Markdown 插件。

- [ ] **Step 2: 静态检查锁文件**

运行：

```bash
npm ls react-markdown --depth=0
git diff -- package.json package-lock.json
```

预期：`react-markdown` 位于 `dependencies`，锁文件解析到单一直接版本；不运行构建或测试。

### Task 2: 用安全 Markdown 替换审核 JSON 展示

**Files:**

- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx:1`
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx:577`

**Interfaces:**

- Consumes: `RuntimeNodeAudit.reason: string | null`、`RuntimeNodeAudit.status`。
- Produces: `AuditMarkdown({ value }: { value: string })` 和不渲染 `audit.details` 的 `AuditResult`。

- [ ] **Step 1: 引入 Markdown 组件**

在 React import 后增加：

```tsx
import Markdown from "react-markdown";
```

- [ ] **Step 2: 增加聚焦的安全渲染组件**

在 `AuditResult` 前增加：

```tsx
function AuditMarkdown({ value }: { value: string }) {
  return (
    <div className="runtime-audit-markdown">
      <Markdown
        skipHtml
        components={{
          a({ node: _node, ...props }) {
            return <a {...props} rel="noopener noreferrer" target="_blank" />;
          },
          img() {
            return null;
          },
        }}
      >
        {value}
      </Markdown>
    </div>
  );
}
```

不传 `urlTransform`，继续使用 `react-markdown` 默认安全协议过滤；图片组件固定返回 `null`，不能发起外部请求。

- [ ] **Step 3: 只依据状态和 `reason` 渲染学生结果**

将现有 `AuditResult` 替换为：

```tsx
function AuditResult({ audit }: { audit: NonNullable<RuntimeNodeInstance["audit"]> }) {
  const reason = audit.reason?.trim() ?? "";
  const visibleReason = reason || (
    audit.status === "rejected"
      ? "审核未提供具体说明，请根据节点要求修改后重新提交。"
      : ""
  );
  if (!visibleReason && audit.status !== "reviewing") return null;
  return (
    <section className={`runtime-audit-result ${audit.status}`}>
      <strong>
        {audit.status === "reviewing" ? `自动审核中（第 ${audit.attemptCount || 1} 次执行）` : "审核结果"}
      </strong>
      {visibleReason ? <AuditMarkdown value={visibleReason} /> : null}
    </section>
  );
}
```

必须删除 `JSON.stringify(audit.details)` 和审核结果 `<pre>`。不删除 `RuntimeNodeAudit.details` 类型，也不改变 API 映射。

### Task 3: 增加审核 Markdown 排版

**Files:**

- Modify: `frontend/src/styles.css:3938`

**Interfaces:**

- Consumes: `.runtime-audit-result`、`.runtime-audit-markdown` 及其 CommonMark 元素。
- Produces: 无嵌套卡片的紧凑审核结果排版。

- [ ] **Step 1: 收紧审核结果标题选择器**

将现有标题和普通段落规则替换为：

```css
.runtime-audit-result > strong {
  display: block;
  margin: 0;
}
```

避免该规则误作用于 Markdown 中的 `<strong>`。

- [ ] **Step 2: 增加正文、标题和列表样式**

增加：

```css
.runtime-audit-markdown {
  margin-top: 8px;
  color: #475467;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.runtime-audit-markdown > :first-child { margin-top: 0; }
.runtime-audit-markdown > :last-child { margin-bottom: 0; }

.runtime-audit-markdown h1,
.runtime-audit-markdown h2,
.runtime-audit-markdown h3,
.runtime-audit-markdown h4,
.runtime-audit-markdown h5,
.runtime-audit-markdown h6 {
  margin: 14px 0 6px;
  color: #344054;
  font-size: 15px;
  line-height: 1.45;
}

.runtime-audit-markdown p,
.runtime-audit-markdown ul,
.runtime-audit-markdown ol,
.runtime-audit-markdown blockquote,
.runtime-audit-markdown pre {
  margin: 8px 0;
}

.runtime-audit-markdown ul,
.runtime-audit-markdown ol {
  padding-left: 22px;
}

.runtime-audit-markdown li + li { margin-top: 4px; }
```

- [ ] **Step 3: 增加引用、代码和链接样式**

用 Markdown 容器专属规则替换旧 JSON `<pre>` 规则：

```css
.runtime-audit-markdown blockquote {
  padding-left: 12px;
  border-left: 3px solid #98a2b3;
  color: #667085;
}

.runtime-audit-markdown code {
  padding: 2px 4px;
  border-radius: 4px;
  background: #f2f4f7;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.92em;
}

.runtime-audit-markdown pre {
  max-height: 220px;
  padding: 10px;
  overflow: auto;
  border-radius: 4px;
  background: #f2f4f7;
  white-space: pre;
}

.runtime-audit-markdown pre code {
  padding: 0;
  background: transparent;
  font-size: inherit;
}

.runtime-audit-markdown a {
  color: #175cd3;
  text-underline-offset: 2px;
}

.runtime-audit-markdown a:focus-visible {
  outline: 2px solid #84adff;
  outline-offset: 2px;
}
```

### Task 4: 更新审核脚本作者文档

**Files:**

- Modify: `docs/06_check_scripts.md:8`

**Interfaces:**

- Produces: 与真实 `passed/reason/details` 协议和学生 Markdown 展示一致的脚本说明。

- [ ] **Step 1: 修正并补充结果字段说明**

将输出要求更新为：

```markdown
- 输出必须包含 `schemaVersion="1.0"`、布尔字段 `passed`、字符串字段 `reason` 和结构化对象 `details`。
- `reason` 是面向学生的审核结果，支持基础 CommonMark Markdown；需要展示多项问题时应在 `reason` 中使用标题、段落或列表。
- `details` 用于系统审计和结构化处理，学生页面不直接显示；不能依赖学生阅读 `details` 才能理解如何修改材料。
- `reason` 不应包含原始 HTML、Markdown 图片、OSS 对象键、内部文件 ID、脚本路径或技术异常信息。
```

将学生侧说明中的 `pass=false`、`pass=true` 分别改为 `passed=false`、`passed=true`。

### Task 5: 静态审计、清理、重启和提交

**Files:**

- Inspect: Task 1–4 全部文件
- Preserve: `AGENTS.md`、`docs/05_oa_graph.md`、`.superpowers/`

**Interfaces:**

- Produces: 一个实现提交、本地已重启服务和用户手测清单。

- [ ] **Step 1: 审计学生端不再渲染结构化结果**

运行：

```bash
rg -n "JSON.stringify\(audit.details|runtime-audit-result pre|dangerouslySetInnerHTML|rehype-raw|remark-gfm" frontend/src frontend/package.json
rg -n "react-markdown|skipHtml|runtime-audit-markdown|img\(\)|visibleReason" frontend/src frontend/package.json
```

预期：第一组无命中；第二组覆盖依赖、安全属性、禁用图片、空结果兜底和样式。`details` 类型与后端响应保持不变。

- [ ] **Step 2: 检查差异范围和格式**

运行：

```bash
git diff --check
git diff --name-only
git status --short
```

预期：本次文件为 `frontend/package.json`、`frontend/package-lock.json`、`StudentRuntimePage.tsx`、`frontend/src/styles.css`、`docs/06_check_scripts.md`；用户已有文件不进入暂存区。不运行测试、构建或浏览器。

- [ ] **Step 3: 检查并清理开发缓存**

先列出仓库内精确缓存目录：

```bash
find . -type d \( -name __pycache__ -o -name .pytest_cache -o -name '*.egg-info' \) -prune -print
```

仅删除该命令实际列出的仓库内目录；没有输出时不执行删除。

- [ ] **Step 4: 本地重启服务**

使用 `lsof` 找到 `127.0.0.1:8000` 和 `127.0.0.1:5173` 的精确监听 PID，向这些 PID 发送 `TERM`，然后分别运行：

```bash
cd backend
.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

```bash
cd frontend
npm run dev -- --host 127.0.0.1
```

再次使用 `lsof` 确认两个端口监听；不调用 Docker。

- [ ] **Step 5: 精确提交实现**

只暂存本计划列出的五个文件：

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/features/academic-flow/StudentRuntimePage.tsx frontend/src/styles.css docs/06_check_scripts.md
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: render student audit results as markdown"
```

预期：实现提交只包含上述五个文件。

- [ ] **Step 6: 交付用户手测清单**

1. 历史纯文本审核说明正常显示，JSON、内部文件 ID 和问题代码消失。
2. Markdown 标题、段落、列表、加粗、斜体、引用、链接、行内代码、代码块和分隔线正常排版。
3. 原始 HTML 不执行、不显示；Markdown 图片不加载。
4. 外部链接在新窗口打开，键盘焦点清晰。
5. `rejected` 且空 `reason` 时显示固定兜底说明。
6. `reviewing`、`approved`、`audit_error` 状态提示保持原语义。
7. 重新上传、提交、审核轮询和下游 DAG 开放保持正常。

## Plan Self-Review

- Spec coverage: 字段边界、基础 CommonMark、安全 HTML/图片策略、空结果兜底、排版、历史兼容和脚本文档均有明确任务。
- Security: 使用 React 元素渲染，显式 `skipHtml`，图片返回 `null`，不覆盖默认 URL 过滤，不使用 `dangerouslySetInnerHTML`。
- Scope: 后端、数据库、API 和审核状态机不变；只增加一个直接依赖并修改计划列出的五个相关文件。
- Type consistency: `AuditMarkdown.value` 与 `RuntimeNodeAudit.reason` 均为字符串，`details` 类型保留但 UI 不读取。
- Verification policy: 遵循仓库规则，不运行测试、构建或浏览器，只做静态审计、依赖锁检查、缓存清理和本地服务重启。
