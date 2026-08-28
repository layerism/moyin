# Answer Sheet Question Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将答题卡题目从行内展开编辑改为具有确认/退出语义的二级草稿弹窗。

**Architecture:** `AnswerSheetEditor` 保留答题卡级配置、排序和题目菜单，并新增单一题目草稿状态。题型字段继续交给现有选择题、旧版填空和单 Markdown 填空编辑组件；确认时一次性更新公开配置与私有答案，退出时丢弃草稿。

**Tech Stack:** React 19、TypeScript、现有 AnswerSheet 类型与 Markdown 编辑组件、CSS。

**Spec:** `docs/superpowers/specs/2026-08-29-answer-sheet-question-dialog-design.md`

## Global Constraints

- 不修改答题卡协议、题型校验、自动判分、DAG 或发布逻辑。
- 题目输入过程不得调用外层 `onChange`；确认时只调用一次。
- 遮罩和 `Escape` 不关闭题目弹窗。
- 拖拽与题目菜单不得触发题目弹窗。
- 保留工作区既有无关修改。
- 遵守项目规则：修改过程中不运行测试、TypeScript 构建或浏览器验证；完成后只做静态业务审计、本地重启和缓存清理。
- 本次代码实现只产生一个结果提交；不得在任务中间提交。

---

### Task 1: 建立题目草稿与原子确认边界

**Files:**
- Modify: `frontend/src/features/academic-flow/AnswerSheetEditor.tsx`

**Interfaces:**
- Produces: `AnswerSheetQuestionDraft`，包含 `question`、`answer`、`isNew`。
- Produces: 已有题目打开、新题打开、确认写回、退出丢弃四个状态操作。
- Consumes: 现有 `createAnswerSheetQuestion()`、`createPrivateAnswer()` 与外层 `onChange()`。

- [ ] **Step 1: 用单一草稿状态替换 `expandedQuestionId`**

  已有题目打开时读取同题号的公开题目与私有答案；新增题目只创建临时对象，不立即写回。题目被外部删除时关闭对应草稿。

- [ ] **Step 2: 实现确认和退出**

  确认已有题目时按 ID 替换公开题目和私有答案；确认新题时追加两者；两种路径都只调用一次 `onChange()`。退出只清空草稿和题目内部菜单。

### Task 2: 将现有题型编辑器装入二级弹窗

**Files:**
- Modify: `frontend/src/features/academic-flow/AnswerSheetEditor.tsx`

**Interfaces:**
- Produces: `AnswerSheetQuestionDialog`。
- Consumes: `SelectionEditor`、`FillBlankEditor`、`SingleMarkdownFillBlankEditor`、`validateAnswerSheetAuthoring()`。

- [ ] **Step 1: 外层题目摘要改为打开弹窗**

  移除行内内容和展开箭头状态；摘要按钮使用 `aria-haspopup="dialog"`。排序手柄和菜单保持独立兄弟节点。

- [ ] **Step 2: 渲染草稿弹窗**

  弹窗内容继续呈现分值、必答、题干 Markdown 及对应题型细节。使用包含草稿的临时 config/key 计算当前题目的校验信息；不完整题目不禁用确认。

- [ ] **Step 3: 固定关闭规则**

  右上角“×”和“退出”调用丢弃；“确认”调用原子写回；遮罩无关闭回调，也不注册 `Escape` 关闭处理。锁定模式隐藏确认按钮。

### Task 3: 增加二级弹窗样式并清理旧展开辅助

**Files:**
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/features/academic-flow/answerSheetEditorState.ts`

**Interfaces:**
- Produces: 固定定位、独立滚动、固定头尾的题目弹窗样式。
- Removes: `toggleExpandedQuestion()`。

- [ ] **Step 1: 新增题目弹窗视觉层级**

  遮罩层级高于节点设置弹窗；弹窗宽度适配桌面与窄屏，主体可滚动，头尾保持可见。

- [ ] **Step 2: 清理行内展开遗留**

  删除展开状态函数、展开样式和无效 `aria-controls`，保留题目卡片错误态、拖拽态和紧凑摘要。

- [ ] **Step 3: 静态审计、重启与提交**

  使用 `rg` 审计不再存在行内展开调用，人工检查新建/已有题目的确认与退出写回路径。按项目规则不运行测试或构建；清理限定缓存，本地重启前后端，再创建一个结果提交。
