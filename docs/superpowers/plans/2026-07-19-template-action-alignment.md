# 模板操作按钮对齐实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. If the user explicitly requests delegation, use at most one subagent. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使已上传模板卡片中的“替换模板”和“删除模板”在桌面及窄屏下等宽、同高、单行对齐，并保持长文件名稳定省略。

**Architecture:** 保留 `AcademicFlowDesigner.tsx` 现有文件信息、文件选择 `label` 和删除 `button`，仅在 `frontend/src/styles.css` 中把模板行改为“弹性文件信息 + 固定操作区”网格。桌面操作区使用两个固定等宽列，窄屏切换为占满容器的两个等宽列；不改变上传和删除事件。

**Tech Stack:** React 18、TypeScript、Vite、原生 CSS。

## Global Constraints

- 当前分支实施，不创建 worktree。
- 设计检查点为 `c203d7d`；实施期间不创建中间提交，完成后只创建一个实现提交。
- 只修改 `frontend/src/styles.css`，不修改 JSX、业务状态、文件上传接口或模板删除逻辑。
- 不新增组件、图标、依赖、JavaScript 尺寸测量或动画。
- 不暂存或覆盖用户已有的 `AGENTS.md`、`docs/05_oa_graph.md` 和 `.superpowers/` 文件。
- 不运行自动化测试、构建、浏览器或 Playwright；只做静态差异审计并交由用户手测。
- 完成后检查并清理仓库内 `__pycache__`、`.pytest_cache`、`*.egg-info`，再以本地进程方式重启前后端，不使用 Docker。

---

### Task 1: 对齐模板文件信息和操作按钮

**Files:**

- Modify: `frontend/src/styles.css:2379`
- Preserve: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:1564`

**Interfaces:**

- Consumes: `.node-template-file`、`.node-template-actions`、现有隐藏文件输入。
- Produces: 桌面两列模板行、同尺寸语义化操作按钮、窄屏等宽操作区。

- [ ] **Step 1: 将模板行改为稳定网格**

在现有模板样式中把文件行与操作区拆开定义：

```css
.node-template-file {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
}

.node-template-actions {
  display: grid;
  grid-template-columns: repeat(2, 92px);
  align-items: stretch;
  gap: 10px;
}
```

文件信息列继续使用 `min-width: 0`，文件名保持单行省略，不能推动操作区缩窄。

- [ ] **Step 2: 统一两个操作控件的几何和语义颜色**

复用现有 `label` 和 `button`，用共享规则统一尺寸，再分别设置普通操作色与危险操作色：

```css
.node-template-actions label,
.node-template-actions button {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 750;
  line-height: 1;
  white-space: nowrap;
}

.node-template-actions label {
  border: 1px solid #84adff;
  background: #eff6ff;
  color: #175cd3;
}

.node-template-actions button {
  border: 1px solid #f1aeb5;
  background: #fff1f2;
  color: #b42318;
}
```

保留 `.node-template-actions input` 的现有隐藏规则，不改变文件选择行为。

- [ ] **Step 3: 增加窄屏等宽分栏**

在现有 `@media (max-width: 760px)` 中加入：

```css
.node-template-file {
  grid-template-columns: 1fr;
  align-items: stretch;
}

.node-template-actions {
  width: 100%;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
```

窄屏仍保留两个文字按钮，不隐藏、不堆叠、不改为图标。

### Task 2: 静态审计、清理、重启和提交

**Files:**

- Inspect: `frontend/src/styles.css`
- Preserve: `AGENTS.md`、`docs/05_oa_graph.md`、`.superpowers/`

**Interfaces:**

- Produces: 单一 CSS 实现提交和已重启的本地服务。

- [ ] **Step 1: 检查样式差异**

运行：

```bash
git diff --check -- frontend/src/styles.css
git diff -- frontend/src/styles.css
git status --short
```

预期：生产代码差异只有 `frontend/src/styles.css`；用户已有文件仍未暂存。不运行测试、构建或浏览器。

- [ ] **Step 2: 检查并清理开发缓存**

先列出仓库内精确缓存目录：

```bash
find . -type d \( -name __pycache__ -o -name .pytest_cache -o -name '*.egg-info' \) -prune -print
```

仅删除该命令实际列出的仓库内目录；没有输出时不执行删除。

- [ ] **Step 3: 本地重启服务**

使用 `lsof` 解析 `127.0.0.1:8000` 和 `127.0.0.1:5173` 的精确监听进程，向精确 PID 发送 `TERM`，然后分别运行：

```bash
cd backend
.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

```bash
cd frontend
npm run dev -- --host 127.0.0.1
```

再次使用 `lsof` 确认两个端口监听；不调用 Docker。

- [ ] **Step 4: 精确提交实现**

只暂存 `frontend/src/styles.css`，检查后提交：

```bash
git add frontend/src/styles.css
git diff --cached --check
git diff --cached --name-only
git commit -m "fix: align template action buttons"
```

预期：提交中只包含 `frontend/src/styles.css`。

- [ ] **Step 5: 交付手测清单**

1. 长文件名显示省略号，但文件大小仍在下一行可见。
2. 桌面端“替换模板”和“删除模板”同宽、同高、文字单行且基线一致。
3. “替换模板”为蓝色次级操作，“删除模板”为红色危险操作。
4. 缩窄窗口后按钮区域占满卡片宽度，两个按钮保持等宽分栏。
5. 点击“替换模板”仍打开文件选择，点击“删除模板”仍执行原删除流程。

## Plan Self-Review

- Spec coverage: 文件名省略、按钮等宽同高、语义颜色和窄屏布局均有明确步骤。
- Scope: 只调整一个 CSS 文件，不改变 DOM、事件或后端。
- Consistency: 选择器名称与现有代码一致，窄屏沿用现有 `760px` 断点。
- Verification: 遵循仓库规则，不运行测试、构建或浏览器；由用户完成视觉与交互手测。
