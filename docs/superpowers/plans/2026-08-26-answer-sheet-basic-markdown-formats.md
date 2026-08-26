# 答题卡基础 Markdown 格式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在答题卡共享 Markdown 渲染器中增加粗体、斜体、列表、引用和 GFM 表格，同时继续限制链接、图片、HTML、删除线、任务列表、脚注和三级以下标题。

**Architecture:** 教师失焦预览、教师真实学生预览和正式学生端继续复用 `AnswerSheetMarkdown`。`remark-gfm` 只负责产生表格等 GFM AST，项目内 `restrictBasicMarkdownTree` 仍是最终能力白名单；响应式表格滚动和紧凑排版由答题卡作用域 CSS 控制。

**Tech Stack:** React 18、TypeScript、react-markdown 10、remark-gfm 4.0.1、remark-math、rehype-katex、rehype-highlight。

**Spec:** `docs/07_answer_sheet_node_design.md` 第 5 节。

## Global Constraints

- 编辑时始终显示 Markdown 源码，不增加格式工具栏。
- 失焦后使用教师和学生共享的 `AnswerSheetMarkdown` 渲染。
- 只增加粗体、斜体、有序列表、无序列表、引用和 GFM 表格。
- 不启用 Markdown 原始 HTML、图片、外部链接、删除线、任务列表、脚注、水平分隔线或三级以下标题。
- 不修改答题卡数据结构、后端接口或自动判分。
- 修改过程中不运行测试或浏览器，只同步测试代码并执行静态检查。

---

### Task 1: 扩展 Markdown AST 白名单

**Files:**
- Modify: `frontend/tests/answerSheet.test.ts`
- Modify: `frontend/src/features/academic-flow/basicAnswerSheetMarkdown.ts`

**Interfaces:**
- Consumes: `BasicMarkdownNode` 与 `restrictBasicMarkdownTree(tree)`。
- Produces: 只保留已批准块级和行内节点的规范化 MDAST。

- [ ] 调整纯逻辑测试，覆盖粗体、斜体、列表、引用、表格保留，以及链接、图片、删除线、任务列表和三级标题降级。
- [ ] 扩展 `normalizeBlocks`，显式处理 `blockquote`、`list`、`listItem`、`table`、`tableRow` 和 `tableCell`。
- [ ] 扩展 `normalizeInline`，保留 `strong` 与 `emphasis`，继续剥离未批准包装节点。
- [ ] 通过重建 `listItem` 删除 `checked` 属性，使 GFM 任务列表降级为普通列表。

### Task 2: 接入 GFM 表格并增加紧凑样式

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `frontend/src/features/academic-flow/AnswerSheetMarkdown.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: `remark-gfm` 产生的表格 AST。
- Produces: 带横向滚动容器的语义化 HTML 表格，并保持教师与学生一致。

- [ ] 使用项目内 Node.js 安装并锁定 `remark-gfm@4.0.1`。
- [ ] 在 `remarkMath` 之后、白名单插件之前注册 `remarkGfm`。
- [ ] 使用共享表格组件添加 `.answer-sheet-table-scroll` 容器。
- [ ] 在 `.answer-sheet-markdown` 作用域内设置列表、引用、表格、单元格边框和窄屏横向滚动样式。

### Task 3: 静态审计、提交与重启

**Files:**
- Modify: `docs/07_answer_sheet_node_design.md`
- Modify: `docs/superpowers/plans/2026-08-26-answer-sheet-basic-markdown-formats.md`

**Interfaces:**
- Consumes: Tasks 1-2 的渲染器、白名单、样式与依赖。
- Produces: 可审计的提交和本地服务进程状态。

- [ ] 使用 TypeScript 编译器执行静态类型检查，不运行测试或浏览器。
- [ ] 检查任务文件差异、依赖锁文件和未批准 Markdown 节点的降级逻辑。
- [ ] 创建结果检查点，仅提交本任务文件。
- [ ] 清理项目生成的缓存并重启前后端本地服务，核对 5173、8000 与工作目录。

## Self-review

- 需求覆盖：支持项、禁止项、共享渲染器、无工具栏和响应式表格均有对应任务。
- 占位扫描：计划不包含待定实现项。
- 类型一致性：白名单接口继续使用现有 `BasicMarkdownNode` 和 `restrictBasicMarkdownTree`，不新增跨层数据结构。
