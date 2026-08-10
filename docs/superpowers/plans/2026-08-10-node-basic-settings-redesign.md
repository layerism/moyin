# Node Basic Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为所有使用共享节点设置弹窗的节点提供统一的轻量标题、描述和可折叠定时设置界面。

**Architecture:** 在现有 `NodeInspector` 内重组共享基础设置 JSX，并增加仅属于弹窗的定时展开状态；所有节点继续通过同一组件获得改造。复用现有 `NodeDateTimePicker`、`startAt`、`deadlineAt` 和更新回调，只调整 `styles.css` 中的弹窗及时间区域样式。

**Tech Stack:** React 18、TypeScript、现有 CSS、原生按钮与表单控件。

## Global Constraints

- 所有使用节点设置弹窗的节点统一改造。
- 不增加“填写名单”“结束页”、周期重复或图片链接编辑功能。
- 不增加依赖，不修改数据库、后端接口或节点类型。
- 各节点专属配置、发布后修订规则和时间校验保持不变。
- 按项目要求，开发过程不运行测试、构建或浏览器验证，只进行静态业务审计。

---

### Task 1: 重组共享节点基础设置

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`

**Interfaces:**
- Consumes: `AcademicFlowNode.title`、`requirement`、`startAt`、`deadlineAt`、`onUpdateNode()`、`NodeDateTimePicker`。
- Produces: 所有节点共用的轻量基础设置布局，数据更新协议不变。

- [ ] **Step 1: 增加定时区域展开状态**

在 `NodeInspector` 中增加布尔状态；节点 ID 变化时，根据 `Boolean(node?.startAt || node?.deadlineAt)` 初始化，已有时间的节点默认展开。

- [ ] **Step 2: 精简弹窗顶部**

将现有标题、类型徽标和“节点设置”说明替换为只含关闭按钮的轻量工具栏，保留 `aria-label="关闭节点设置"` 与 Escape 关闭逻辑。

- [ ] **Step 3: 重组标题和描述输入**

标题输入直接绑定 `node.title`，占位为“请添加标题”；描述文本域直接绑定 `node.requirement`，占位为“添加描述”。继续通过 `onUpdateNode(node.id, patch)` 保存。

- [ ] **Step 4: 增加定时折叠入口**

渲染“＋ 定时设置”按钮并设置 `aria-expanded`；只在展开状态渲染现有起止时间、清除按钮和 `getTimeWindowSummary(node)`，不新增重复规则。

### Task 2: 统一参考图视觉样式并交付

**Files:**
- Modify: `frontend/src/styles.css`
- Review: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`

**Interfaces:**
- Consumes: Task 1 新增的基础设置、工具栏、操作行和时间区域类名。
- Produces: 白色、轻边框、低阴影的共享节点基础设置界面。

- [ ] **Step 1: 调整基础设置排版**

为大号无边框标题、轻量描述、右上角关闭按钮和圆角“定时设置”按钮定义共享样式，沿用项目现有蓝灰色系和字体。

- [ ] **Step 2: 轻量化时间区域**

移除深色标题栏、粗边框和厚重阴影，保留双列起止时间、连接线、清除操作及摘要；在窄屏断点下继续纵向排列。

- [ ] **Step 3: 静态审计**

确认所有标题、说明和时间更新仍调用原有字段；确认没有“填写名单”“结束页”“重复”或新增后端字段；执行 `git diff --check`。

- [ ] **Step 4: 清理、提交和重启**

清理项目缓存，仅提交本计划涉及文件；本地重启 Vite 与 Uvicorn，并检查 5173、8000 端口及 HTTP 可达性。
