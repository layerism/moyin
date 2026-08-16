# Scan File Picker Upload Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让确认承诺节点通过文件选择器选中的一个或多个扫描件能够进入现有上传流程。

**Architecture:** 保留 `ScanUploadWorkspace`、`workflowApi.uploadScan()` 和后端扫描件接口不变。只在文件输入事件边界把浏览器实时 `FileList` 转换为独立 `File[]`，再清空输入框并调用现有上传函数。

**Tech Stack:** React 18、TypeScript、Vite 5

## Global Constraints

- 只修改扫描件文件选择事件，不改变拖拽、替换、删除、排序、鉴权、API 或 OSS 行为。
- 保留扫描件多选以及重复选择同名文件的能力。
- 按项目 `AGENTS.md`，修改过程中不运行测试、不使用浏览器插件；只执行源代码数据流审计和 `git diff --check`。
- 完成后创建一次结果提交，并以本地方式重启前后端服务。

---

### Task 1: 快照文件选择结果后再清空输入框

**Files:**
- Modify: `frontend/src/features/academic-flow/ScanUploadWorkspace.tsx:114-118`
- Create: `docs/superpowers/plans/2026-08-16-scan-file-picker-upload-fix.md`

**Interfaces:**
- Consumes: 浏览器文件输入事件中的 `event.currentTarget.files: FileList | null`
- Produces: 传给既有 `upload(files: FileList | File[])` 的独立 `File[]`

- [ ] **Step 1: 修改文件选择事件**

将实时 `FileList` 在清空输入框前复制为数组：

```tsx
onChange={(event) => {
  const files = Array.from(event.currentTarget.files ?? []);
  event.currentTarget.value = "";
  if (files.length) void upload(files);
}}
```

- [ ] **Step 2: 审计数据流和变更范围**

确认 `files` 是独立数组，清空输入框不会改变其长度；确认 `upload()` 仍按数组顺序调用 `workflowApi.uploadScan()`，且取消选择时不调用上传。

- [ ] **Step 3: 执行允许的静态检查**

运行：

```bash
git diff --check -- frontend/src/features/academic-flow/ScanUploadWorkspace.tsx docs/superpowers/plans/2026-08-16-scan-file-picker-upload-fix.md
```

预期：无输出，退出码为 0。根据项目约束，不运行自动化测试或浏览器回归。

- [ ] **Step 4: 创建结果提交**

仅暂存本任务文件：

```bash
git add frontend/src/features/academic-flow/ScanUploadWorkspace.tsx docs/superpowers/plans/2026-08-16-scan-file-picker-upload-fix.md
git commit -m "fix: preserve selected scan files before reset"
```

- [ ] **Step 5: 重启并核对本地服务**

终止已确认属于本项目的 Uvicorn 与 Vite 会话，然后分别从 `backend/` 和 `frontend/` 启动服务。确认 Uvicorn 完成应用初始化，Vite 在 5173 端口就绪；不发送额外 HTTP 请求。
