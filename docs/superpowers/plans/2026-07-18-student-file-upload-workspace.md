# Student File Upload Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为学生文件节点提供具备拖放、上传反馈和提交拦截的上传工作区。

**Architecture:** 保持 `workflowApi.uploadFile` 与现有 `draft.file` 元数据格式不变。将上传回调改为 `Promise<void>`，使 `RuntimeNodeDialog` 可精确维护上传中状态；在同一组件内渲染上传工作区，避免为单一节点类型引入新组件或依赖。

**Tech Stack:** React 18、TypeScript、CSS。

## Global Constraints

- 不修改后端 API、运行时类型、文件校验规则或审核流程。
- 保留暂存、提交、只读查看及顶层错误通知。
- 文件节点只能在已取得 `draft.file.fileId` 后提交。
- 不运行自动化测试、构建或浏览器测试；仅执行静态源码、CSS 与 Git 范围审计。
- 仅提交本次源码、样式和开发文档，不纳入已有未提交文件。

---

### Task 1: 上传状态与交互入口

**Files:**
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx:121-141,249-360,457-462`

**Interfaces:**
- Consumes: `workflowApi.uploadFile(runtime.id, file): Promise<UploadedFile>` 与 `draft.file.fileId`。
- Produces: `RuntimeNodeDialog` 的 `onUploadFile(file): Promise<void>` 和 `fileReady` 状态。

- [x] **Step 1:** 将传入 `RuntimeNodeDialog` 的上传回调改为返回 `uploadFile(activeRuntime, file)` 的 Promise。
- [x] **Step 2:** 在 `RuntimeNodeDialog` 中增加本地拖拽和上传中状态；选择或投放一个文件时 await 上传回调，并在 finally 中恢复交互。
- [x] **Step 3:** 用隐藏原生文件输入的可点击/可拖放上传工作区替换默认文件选择控件，支持空、拖拽、上传中和已就绪四个状态。
- [x] **Step 4:** 基于 `draft.file.fileId` 计算 `fileReady`，展示文件名和 `formatFileSize` 的大小；文件节点的提交按钮在上传中或未就绪时禁用。

### Task 2: 上传工作区视觉与静态审计

**Files:**
- Modify: `frontend/src/styles.css:3870-3920,4094-4097`
- Modify: `docs/superpowers/plans/2026-07-18-student-file-upload-workspace.md`

- [x] **Step 1:** 为上传工作区新增空、拖拽、上传中、已就绪和禁用样式，沿用蓝色操作态与绿色完成态。
- [x] **Step 2:** 让文件节点的提交按钮在禁用时展示明确样式与“请先上传文件”辅助说明。
- [x] **Step 3:** 搜索上传回调、`runtime-file-input` 和 `fileReady`，确认旧控件无残留且新回调类型一致。
- [x] **Step 4:** 执行 `git diff --check` 与任务文件范围审计；不运行测试、构建或浏览器验证。
- [x] **Step 5:** 清理本项目的 `.pytest_cache`、`__pycache__` 和 `*.egg-info` 中间目录（若存在），仅提交本次文件，并重启前后端服务。
