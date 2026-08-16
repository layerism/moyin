# 扫描件上传列表紧凑化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变上传业务逻辑的前提下，降低多扫描件列表和拖拽区的垂直占用，并保持教师预览与学生实际填写界面一致。

**Architecture:** 保留 `ScanUploadWorkspace.tsx` 的结构、状态和接口调用，仅在全局样式文件中调整该组件的布局。文件项采用“可收缩信息列 + 固定操作列”的 CSS Grid；长文件名继续省略，窄屏操作按钮允许换行。

**Tech Stack:** React 18、TypeScript、CSS、Vite 5

## Global Constraints

- 只修改扫描件上传工作区的展示样式，不修改组件数据结构、API 或后端逻辑。
- 教师学生预览与学生实际填写页必须同步生效。
- 保留上传、排序、下载、替换、删除、暂存、提交和审核行为。
- 保留现有白色面板、灰色边框、蓝色交互和红色删除语义。
- 长文件名不得引起运行节点弹窗横向溢出。
- 按项目约定不运行测试或浏览器自动化，只进行静态业务逻辑审计。
- 计划提交作为实施前检查点；实现过程中不提交，完成后只创建一次结果提交。

---

### Task 1: 压缩扫描件上传区和文件列表

**Files:**
- Modify: `frontend/src/styles.css:3303-3418`
- Reference only: `frontend/src/features/academic-flow/ScanUploadWorkspace.tsx:112-138`

**Interfaces:**
- Consumes: `ScanUploadWorkspace` 现有类名 `runtime-scan-workspace`、`runtime-scan-dropzone`、`runtime-scan-list`、`runtime-scan-actions` 和 `runtime-scan-replace`。
- Produces: 不产生新的 TypeScript 接口或类名；教师预览与学生实际填写通过共用类名获得相同布局。

- [ ] **Step 1: 将拖拽区与列表间距压缩到紧凑尺寸**

在 `frontend/src/styles.css` 中调整现有声明：

```css
.confirmation-scan-settings,
.runtime-scan-workspace {
  display: grid;
  gap: 8px;
}

.runtime-scan-dropzone {
  display: grid;
  gap: 2px;
  justify-items: center;
  padding: 14px 16px;
  border: 1px dashed #8fb3e8;
  border-radius: 8px;
  background: #f7faff;
  cursor: pointer;
}

.runtime-scan-list,
.runtime-submitted-scan-list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
```

- [ ] **Step 2: 把可编辑扫描件文件项改为两列紧凑网格**

保留已提交扫描件列表的现有布局，并为可编辑列表增加专用覆盖：

```css
.runtime-scan-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
}

.runtime-scan-list li > div:first-child {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.runtime-scan-list li small {
  color: #667085;
  font-size: 12px;
}
```

删除当前强制运行弹窗文件项纵向排列的规则：

```css
.runtime-node-dialog .runtime-scan-list li {
  align-items: stretch;
  flex-direction: column;
}
```

- [ ] **Step 3: 压缩操作按钮并保持窄屏可换行**

更新操作区，并为其中的按钮和替换标签统一紧凑尺寸：

```css
.runtime-scan-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
}

.runtime-scan-actions button,
.runtime-scan-replace {
  min-height: 32px;
  padding: 0 9px;
  border-radius: 6px;
  font-size: 13px;
}

.runtime-node-dialog .runtime-scan-actions {
  max-width: 100%;
}
```

将 `.runtime-scan-replace` 原有 `padding: 0 10px` 删除，避免覆盖统一尺寸。保留其边框、背景、隐藏文件输入框和点击行为。

- [ ] **Step 4: 静态审计作用范围和横向收缩条件**

运行只读检查：

```bash
git diff -- frontend/src/styles.css
git diff --check -- frontend/src/styles.css
rg -n "runtime-scan-(dropzone|list|actions|replace)" frontend/src/styles.css frontend/src/features/academic-flow/ScanUploadWorkspace.tsx
```

预期：差异只涉及扫描件上传样式；`ScanUploadWorkspace.tsx` 无差异；信息列仍有 `min-width: 0`，文件名仍有 `overflow: hidden`、`text-overflow: ellipsis` 和 `white-space: nowrap`；不新增横向滚动。

- [ ] **Step 5: 清理限定缓存并创建结果提交**

先列出并清理项目源码范围内允许删除的缓存目录，同时显式跳过 `.venv` 和 `node_modules`。随后只提交目标样式文件：

```bash
find backend frontend \( -path backend/.venv -o -path frontend/node_modules \) -prune -o -type d \( -name .pytest_cache -o -name __pycache__ -o -name '*.egg-info' \) -prune -print
find backend frontend \( -path backend/.venv -o -path frontend/node_modules \) -prune -o -type d \( -name .pytest_cache -o -name __pycache__ -o -name '*.egg-info' \) -prune -exec rm -r -- {} +
git status --short
git add frontend/src/styles.css
git commit -m "style: compact scan upload list"
```

预期：结果提交只包含 `frontend/src/styles.css`；工作树中的其他已有改动保持原状。

- [ ] **Step 6: 以本地方式重启并核对服务进程**

先使用 `lsof -nP -iTCP:8000 -sTCP:LISTEN` 和 `lsof -nP -iTCP:5173 -sTCP:LISTEN` 识别本项目现有进程，仅终止已确认属于当前项目的进程。然后分别启动：

```bash
cd backend
./.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

```bash
cd frontend
export PATH="$PWD/../.local/node/bin:$PATH"
npm run dev
```

预期：后端日志出现 `Application startup complete`，前端日志出现 `VITE ... ready`；不发送 HTTP 业务请求。
