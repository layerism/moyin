# 删除“信息填写”组件入口实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从教务流程设计器组件库中删除“信息填写”创建入口，同时保持其他入口和既有流程兼容。

**Architecture:** 组件库由 `nodeTemplates` 统一驱动。直接删除其中标题为“信息填写”的模板项，不修改 `AcademicFlowNodeKind`、`form` 节点运行逻辑或渲染组件。

**Tech Stack:** React 18、TypeScript、Vite

## Global Constraints

- 保留“表单填写”“文件上传”“确认承诺”“通知公告”及流程控制入口。
- 保留 `form` 节点类型和现有流程数据兼容性。
- 不增加渲染层过滤、迁移逻辑或新依赖。
- 不运行自动化测试或浏览器测试，只做业务逻辑源码审计并由用户手动确认。

---

### Task 1: 删除组件库模板入口

**Files:**
- Modify: `frontend/src/features/academic-flow/academicFlowData.ts:10`

**Interfaces:**
- Consumes: `ComponentPalette` 对 `nodeTemplates` 的顺序渲染。
- Produces: 不再包含“信息填写”的 `nodeTemplates` 数组；类型和函数签名不变。

- [ ] **Step 1: 删除模板项**

从 `nodeTemplates` 中删除以下对象：

```ts
{ kind: "form", title: "信息填写", description: "填写基础文本信息" },
```

- [ ] **Step 2: 审计修改范围**

运行：

```bash
git diff --check -- frontend/src/features/academic-flow/academicFlowData.ts
git diff -- frontend/src/features/academic-flow/academicFlowData.ts
```

预期：业务代码仅删除上述模板项；`AcademicFlowNodeKind`、`createNode`、学生端及历史节点渲染逻辑没有变化。

- [ ] **Step 3: 清理开发缓存**

只清理项目生成的缓存目录，不触碰 `node_modules`：

```bash
find backend frontend -type d \( -name '__pycache__' -o -name '.pytest_cache' -o -name '*.egg-info' \) -prune
```

如有匹配项，仅删除这些明确列出的目录。

- [ ] **Step 4: 提交完成检查点**

```bash
git add frontend/src/features/academic-flow/academicFlowData.ts docs/superpowers/plans/2026-08-08-remove-basic-information-template.md
git commit -m "feat: remove basic information template entry"
```

- [ ] **Step 5: 重启本地服务**

停止当前 FastAPI 和 Vite 开发进程，随后按本地方式启动：

```bash
cd backend
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

cd frontend
npm run dev -- --host 0.0.0.0 --port 5173
```

仅检查启动日志和健康端点；界面结果交由用户手动确认。
