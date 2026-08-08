# Student Reviewing State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为学生节点的 `reviewing` 与 `submitted` 状态增加清晰的等待审核状态卡、提交时间和只读提交摘要。

**Architecture:** 在现有 `RuntimeNodeDialog` 中增加统一的等待审核判断和同文件轻量组件 `ReviewingSubmission`，复用 `ReadonlySubmission`、`formatDateTime()` 与现有运行时数据。页面级轮询保持 2 秒间隔，仅将触发集合从 `reviewing` 扩展为 `reviewing | submitted`；视觉使用现有紫色状态语义和纯 CSS 动画。

**Tech Stack:** React、TypeScript、CSS。

## Global Constraints

- `reviewing` 与 `submitted` 必须进入同一等待审核布局。
- 展示真实 `runtime.submittedAt`、`runtime.submission` 与 `runtime.audit?.attemptCount`，不得生成模拟数据。
- 提交时间缺失或无效时显示“提交时间暂未记录”。
- 审核次数缺失或小于 1 时显示“第 1 次审核”。
- 只读摘要必须复用现有 `ReadonlySubmission`，不得复制文件、表单或确认节点的展示逻辑。
- 等待期间不提供修改、暂存、重复提交或手动刷新按钮。
- 不显示百分比、模拟进度条或预计完成时间。
- 自动刷新间隔保持 2 秒，轮询触发集合扩展为 `reviewing | submitted`。
- CSS 旋转效果必须支持 `prefers-reduced-motion`。
- 不新增后端、数据库、API 类型、第三方依赖或独立组件目录。
- 不修改学生拓扑节点和 approved、rejected、audit_error、locked、scheduled、expired 等其他状态行为。
- 保护用户已有的 `AGENTS.md`、`docs/05_oa_graph.md` 和 `.superpowers/` 工作树内容。
- 按项目约定不运行自动化测试、构建或浏览器测试；只执行静态业务审计并交由用户手测。
- 当前 `e65f3b8` 为设计检查点；实施计划提交后开始代码修改，全部代码完成后只创建一次完成提交，中间不提交。

---

## File Map

- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx` — 扩展等待状态轮询、增加专用分支并复用只读提交摘要。
- Modify: `frontend/src/styles.css` — 增加等待审核状态卡、旋转图标、响应式和减少动画样式。
- Create: `docs/superpowers/plans/2026-08-08-student-reviewing-state.md` — 本实施计划。

### Task 1: 增加等待审核状态组件与轮询覆盖

**Files:**
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx:76-100,390-735`

**Interfaces:**
- Produces: `ReviewingSubmission({ node, runtime }: { node: AcademicFlowNode; runtime: RuntimeNodeInstance })`。
- Consumes: `runtime.status`, `runtime.submittedAt`, `runtime.submission`, `runtime.audit?.attemptCount`。
- Reuses: `ReadonlySubmission`, `formatDateTime()`。
- Preserves: `AuditResult` 对 rejected、audit_error 等非等待状态的展示。

- [ ] **Step 1: 将轮询条件扩展为两个等待状态**

把当前 `isReviewing` 派生值改为：

```tsx
const isAwaitingReview =
  instance?.nodeInstances.some(
    (node) => node.status === "reviewing" || node.status === "submitted",
  ) ?? false;
```

将轮询 effect 中的条件和依赖同步改为：

```tsx
useEffect(() => {
  if (!isAwaitingReview) return;
  let cancelled = false;
  const poll = () => {
    workflowApi
      .getInstance(instanceId)
      .then((value) => {
        if (!cancelled) {
          setInstance(value);
          setNotice("");
        }
      })
      .catch(() => {
        if (!cancelled) setNotice("审核状态暂时无法刷新，系统将自动重试");
      });
  };
  const timer = window.setInterval(poll, 2_000);
  return () => {
    cancelled = true;
    window.clearInterval(timer);
  };
}, [instanceId, isAwaitingReview]);
```

不得修改 2,000 ms 间隔或 API 调用。

- [ ] **Step 2: 在节点弹窗中派生等待状态**

在 `RuntimeNodeDialog` 的 `approvedForm` 等派生值附近增加：

```tsx
const awaitingReview = runtime.status === "reviewing" || runtime.status === "submitted";
```

将现有审核结果渲染限制为非等待状态，避免与新状态卡重复：

```tsx
{runtime.audit && !awaitingReview ? <AuditResult audit={runtime.audit} /> : null}
```

- [ ] **Step 3: 在现有状态分支中加入等待审核布局**

在 `readonly` 分支之后、`writable` 分支之前插入：

```tsx
) : awaitingReview ? (
  <ReviewingSubmission node={node} runtime={runtime} />
) : writable ? (
```

等待状态不得渲染 `runtime-node-actions`、`onSave`、`onSubmit` 或 `onRetryAudit`。

- [ ] **Step 4: 增加同文件轻量等待审核组件**

在 `RuntimeNodeDialog` 之后、`RuntimeWarningDialog` 之前增加：

```tsx
function ReviewingSubmission({
  node,
  runtime,
}: {
  node: AcademicFlowNode;
  runtime: RuntimeNodeInstance;
}) {
  const attemptCount = Math.max(1, runtime.audit?.attemptCount || 1);
  const submittedAt = formatDateTime(runtime.submittedAt);
  const submittedAtLabel = submittedAt === "未记录"
    ? "提交时间暂未记录"
    : `提交于 ${submittedAt}`;
  return (
    <div className="runtime-reviewing-content">
      <section aria-live="polite" className="runtime-reviewing-card">
        <span aria-hidden="true" className="runtime-reviewing-spinner" />
        <div className="runtime-reviewing-copy">
          <span>审核处理中</span>
          <h3>材料已提交，正在自动审核</h3>
          <p>第 {attemptCount} 次审核 · {submittedAtLabel}</p>
          <small>审核结果会自动刷新，你可以先关闭此窗口处理其他事项。</small>
        </div>
      </section>
      <h3 className="runtime-reviewing-submission-title">本次提交内容</h3>
      <ReadonlySubmission
        node={node}
        payload={runtime.submission}
        submittedAt={runtime.submittedAt}
      />
    </div>
  );
}
```

不得读取草稿 `draft` 作为等待状态摘要；必须展示已落库的 `runtime.submission`。

- [ ] **Step 5: 静态检查状态分支和数据来源**

Run:

```bash
git diff --check -- frontend/src/features/academic-flow/StudentRuntimePage.tsx
rg -n "isAwaitingReview|awaitingReview|ReviewingSubmission|ReadonlySubmission|submittedAtLabel|setInterval\(poll, 2_000\)" frontend/src/features/academic-flow/StudentRuntimePage.tsx
rg -n "awaitingReview.*onSave|awaitingReview.*onSubmit|awaitingReview.*onRetryAudit" frontend/src/features/academic-flow/StudentRuntimePage.tsx || true
```

Expected:

- 页面轮询覆盖 `reviewing` 与 `submitted`，间隔仍为 2 秒；
- 两个状态进入唯一 `ReviewingSubmission` 分支；
- 等待状态使用 `runtime.submission` 和 `runtime.submittedAt`；
- `AuditResult` 不与等待状态卡重复渲染；
- 无空白错误。

### Task 2: 增加等待审核视觉样式

**Files:**
- Modify: `frontend/src/styles.css:4304-4340,5300-5360`

**Interfaces:**
- Consumes: `.runtime-reviewing-content`, `.runtime-reviewing-card`, `.runtime-reviewing-spinner`, `.runtime-reviewing-copy`, `.runtime-reviewing-submission-title`。
- Preserves: `.runtime-readonly-submission` 与 `.runtime-file-summary` 的既有卡片内容样式。

- [ ] **Step 1: 增加等待审核主体与状态卡样式**

在节点弹窗样式区域增加：

```css
.runtime-reviewing-content {
  padding: 18px 24px 24px;
}

.runtime-reviewing-card {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 14px;
  padding: 18px;
  border: 1px solid #b692f6;
  border-radius: 12px;
  background: #faf8ff;
}

.runtime-reviewing-spinner {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 50%;
  background: #f0e8ff;
}

.runtime-reviewing-spinner::before {
  width: 20px;
  height: 20px;
  border: 3px solid #d6bbfb;
  border-top-color: #7f56d9;
  border-radius: 50%;
  animation: runtime-reviewing-spin 900ms linear infinite;
  content: "";
}

.runtime-reviewing-copy {
  min-width: 0;
}

.runtime-reviewing-copy > span {
  color: #6941c6;
  font-size: 12px;
  font-weight: 800;
}

.runtime-reviewing-copy h3 {
  margin: 4px 0 7px;
  color: #2d1b69;
  font-size: 18px;
  line-height: 1.4;
}

.runtime-reviewing-copy p,
.runtime-reviewing-copy small {
  display: block;
  margin: 0;
  color: #667085;
  line-height: 1.6;
}

.runtime-reviewing-copy p {
  font-size: 13px;
  font-weight: 700;
}

.runtime-reviewing-copy small {
  margin-top: 4px;
  font-size: 12px;
}

.runtime-reviewing-submission-title {
  margin: 18px 0 0;
  color: #344054;
  font-size: 13px;
}

.runtime-reviewing-content .runtime-readonly-submission,
.runtime-reviewing-content .runtime-file-summary {
  margin: 10px 0 0;
}
```

- [ ] **Step 2: 增加动画和减少动画降级**

```css
@keyframes runtime-reviewing-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .runtime-reviewing-spinner::before {
    animation: none;
  }
}
```

不得增加 JavaScript 定时动画或第三方图标依赖。

- [ ] **Step 3: 增加小屏幕布局**

在现有移动端媒体查询中增加：

```css
.runtime-reviewing-content {
  padding: 14px 16px 18px;
}

.runtime-reviewing-card {
  grid-template-columns: 36px minmax(0, 1fr);
  padding: 15px;
}

.runtime-reviewing-spinner {
  width: 36px;
  height: 36px;
}
```

- [ ] **Step 4: 静态检查视觉边界**

Run:

```bash
git diff --check -- frontend/src/styles.css
rg -n "runtime-reviewing-(content|card|spinner|copy|submission-title|spin)|prefers-reduced-motion" frontend/src/styles.css
rg -n "progress|预计|percent" frontend/src/features/academic-flow/StudentRuntimePage.tsx frontend/src/styles.css || true
```

Expected:

- 紫色状态卡、纯 CSS 旋转图标和提交摘要间距均有对应选择器；
- `prefers-reduced-motion` 禁用旋转；
- 小屏幕样式不产生横向溢出；
- 不存在进度百分比或预计时间文案；
- 无空白错误。

### Task 3: 完整静态审计、清理、完成提交和本地重启

**Files:**
- Verify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx`
- Verify: `frontend/src/styles.css`
- Verify: `docs/superpowers/specs/2026-08-08-student-reviewing-state-design.md`
- Verify: `docs/superpowers/plans/2026-08-08-student-reviewing-state.md`

**Interfaces:**
- Consumes: Tasks 1-2 的等待审核分支与视觉样式。
- Produces: 一次完成提交和可供用户手测的本地 FastAPI/Vite 服务。

- [ ] **Step 1: 对照设计文档审计全部差异**

Run:

```bash
git diff --check
git diff -- frontend/src/features/academic-flow/StudentRuntimePage.tsx frontend/src/styles.css docs/superpowers/plans/2026-08-08-student-reviewing-state.md
rg -n "reviewing|submitted|ReviewingSubmission|ReadonlySubmission|submittedAt|attemptCount" frontend/src/features/academic-flow/StudentRuntimePage.tsx
git diff --name-only -- backend frontend/src/features/academic-flow/runtimeTypes.ts
```

Expected:

- 差异仅包含 `StudentRuntimePage.tsx`、`styles.css` 和本计划；
- 后端与 `runtimeTypes.ts` 无差异；
- 其他节点状态分支保持原逻辑；
- 没有空白错误或无依据的进度信息。

- [ ] **Step 2: 预检并清理源码生成缓存**

先列出缓存，明确排除依赖目录：

```bash
find backend -path backend/.venv -prune -o -type d \( -name __pycache__ -o -name .pytest_cache -o -name '*.egg-info' \) -prune -print
find frontend -path frontend/node_modules -prune -o -type d \( -name .pytest_cache -o -name '*.egg-info' \) -prune -print
```

仅对上述预检实际列出的源码缓存目录执行删除；不得触碰 `backend/.venv` 或 `frontend/node_modules`。如果预检为空，则不执行删除命令。

- [ ] **Step 3: 创建唯一完成提交**

仅暂存计划范围文件：

```bash
git add \
  frontend/src/features/academic-flow/StudentRuntimePage.tsx \
  frontend/src/styles.css \
  docs/superpowers/plans/2026-08-08-student-reviewing-state.md
git diff --cached --check
git commit -m "feat: improve student reviewing state"
```

不得暂存 `AGENTS.md`、`docs/05_oa_graph.md` 或 `.superpowers/`。

- [ ] **Step 4: 重启本地非 Docker 服务**

使用 `lsof` 确认 8000 与 5173 的监听进程 cwd 属于本项目后，停止明确 PID。然后分别启动：

```bash
cd backend
./.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

```bash
cd frontend
npm run dev
```

不得使用 Docker，不启动第二组重复服务。

- [ ] **Step 5: 仅做服务可用性检查**

Run:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5173/
curl -s -w '\n%{http_code}\n' http://127.0.0.1:8000/api/health
```

Expected: 前端和后端均返回 HTTP 200；后端正文为 `{"status":"ok"}`。这只证明服务可访问，不等同于自动化或浏览器验收。

- [ ] **Step 6: 用户手测交付说明**

交付时明确说明未运行自动化测试、构建或浏览器测试，并建议用户手测：

```text
1. 文件节点提交后显示审核状态卡、审核次数、提交时间和文件摘要。
2. 表单节点提交后显示字段答案摘要。
3. submitted 兼容状态与 reviewing 使用相同布局并继续自动刷新。
4. 缺失提交时间或审核记录时显示降级文案。
5. 等待页面没有修改、重复提交、手动刷新、百分比或预计时间。
6. 审核通过、退回和异常后仍切换到原有页面。
7. 开启系统“减少动态效果”后旋转动画停止。
```
