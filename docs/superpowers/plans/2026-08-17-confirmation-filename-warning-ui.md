# Confirmation Filename Warning UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将确认承诺扫描件文件名错误从底部按钮区域移入现有文件校验弹窗，同时保证错误时不调用提交 API。

**Architecture:** 把扫描流程前置阻断与文件名错误拆成两个纯函数。`RuntimeNodeDialog` 仅用前置阻断控制按钮可用性，点击提交时拦截文件名错误，并通过统一文件警告状态复用 `RuntimeWarningDialog`。

**Tech Stack:** React 18、TypeScript、现有 CSS 视觉组件、Node.js 24.18.0。

## Global Constraints

- 仅修改确认承诺节点的前端错误反馈，不改变后端文件名校验。
- 底部操作区不得显示扫描件文件名长错误文案。
- 文件名错误时提交按钮可点击，但不得调用提交 API。
- 复用现有 `RuntimeWarningDialog`，不创建新弹窗或新视觉体系。
- 模板未下载、确认未勾选、上传中、没有扫描件等既有流程约束保持不变。
- 关闭警告不得关闭底层节点弹窗或清空扫描件。
- 依据项目 `AGENTS.md`，只编写测试源并做业务逻辑审计，不运行测试、构建、Playwright 或浏览器插件。
- 当前任务只允许实施前和完成后各一个任务范围提交，不创建中间提交。

---

### Task 1: 拆分扫描文件名错误

**Files:**
- Modify: `frontend/tests/scanUploadState.test.ts`
- Modify: `frontend/src/features/academic-flow/ScanUploadWorkspace.tsx:7-50`

**Interfaces:**
- Keeps: `getScanSubmitBlocker(input) -> string | null`，只返回模板下载、确认、上传中和空扫描件等前置阻断。
- Produces: `getScanFilenameError(input: { scans: RuntimeScanFile[]; templateFilename: string | null }) -> string | null`。

- [ ] **Step 1: 先更新纯函数测试源**

将文件名匹配断言改为调用独立函数：

```typescript
assert.equal(getScanFilenameError({
  scans: [scan("1", "安全责任书第1页.png")],
  templateFilename: "安全责任书.docx",
}), null);

assert.match(getScanFilenameError({
  scans: [scan("1", "企业微信截图.png")],
  templateFilename: "安全责任书.docx",
}) ?? "", /文件“企业微信截图\.png”.*安全责任书/);
```

增加断言：存在文件名错误时 `getScanSubmitBlocker()` 仍返回 `null`，证明错误不会禁用提交按钮。

- [ ] **Step 2: 记录未来 RED 命令，本环境不执行**

```bash
cd frontend
export PATH="$PWD/../.local/node/bin:$PATH"
npm test -- scanUploadState.test.ts
```

预期实现前因 `getScanFilenameError` 尚未导出而失败。

- [ ] **Step 3: 实现独立文件名错误函数**

从 `getScanSubmitBlocker()` 移出模板名称解析和扫描件逐一匹配代码：

```typescript
export function getScanFilenameError(input: {
  scans: RuntimeScanFile[];
  templateFilename: string | null;
}): string | null {
  const template = getFilenameIdentity(input.templateFilename ?? "");
  if (!template.stem || template.suffix !== ".docx") {
    return "当前节点模板配置异常，请联系教师";
  }
  const invalidScan = input.scans.find(({ originalName }) => {
    const scan = getFilenameIdentity(originalName);
    return ![".jpg", ".jpeg", ".png"].includes(scan.suffix)
      || !scan.stem.startsWith(template.stem);
  });
  return invalidScan
    ? `文件“${normalizeFilename(invalidScan.originalName)}”名称不符合要求，请改为以“${template.stem}”开头后重新上传。`
    : null;
}
```

`getScanSubmitBlocker()` 删除 `templateFilename` 参数和文件名匹配分支，其他返回顺序保持不变。

- [ ] **Step 4: 静态核对接口调用**

搜索所有 `getScanSubmitBlocker()` 调用，确保不再传入 `templateFilename`；文件名规则的 NFC、扩展名和严格前缀逻辑只移动、不改变。

---

### Task 2: 复用文件校验弹窗

**Files:**
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx:440-765`

**Interfaces:**
- Consumes: `getScanFilenameError()` from Task 1.
- Produces local state: `{ message: string; title: string } | null`，统一承载上传和提交文件警告。

- [ ] **Step 1: 统一文件警告状态**

将 `uploadWarning: string` 改为：

```typescript
const [fileWarning, setFileWarning] = useState<{
  message: string;
  title: string;
} | null>(null);
```

普通文件上传失败时写入：

```typescript
setFileWarning({
  message: reason instanceof Error ? reason.message : "文件上传失败",
  title: "文件上传未通过",
});
```

- [ ] **Step 2: 分离按钮禁用与文件名错误**

分别计算：

```typescript
const scanBlocker = getScanSubmitBlocker({
  confirmed: draft.confirmed === true,
  scanRequired: Boolean(runtime.template),
  scans: scanState.scans,
  templateDownloaded: !runtime.template || runtime.templateDownloaded,
  uploading: scanState.uploading,
});
const scanFilenameError = runtime.template
  ? getScanFilenameError({
      scans: scanState.scans,
      templateFilename: runtime.template.originalName,
    })
  : null;
```

`submitDisabled` 只消费 `scanBlocker`，不消费 `scanFilenameError`。

- [ ] **Step 3: 点击提交时打开警告弹窗**

在确认勾选检查之后、`onSubmit()` 之前增加：

```typescript
if (scanFilenameError) {
  setFileWarning({ message: scanFilenameError, title: "文件提交未通过" });
  return;
}
```

该分支必须提前返回，确保文件名错误时不调用提交 API。

- [ ] **Step 4: 清理底部长错误文案**

删除：

```tsx
{scanBlocker ? <small>{scanBlocker}</small> : null}
```

保留普通文件节点现有“请先上传文件”短提示。确认承诺的模板下载、上传中和空扫描件状态仍通过按钮禁用表达，不新增底部文本。

- [ ] **Step 5: 用动态标题渲染现有弹窗**

```tsx
{fileWarning ? (
  <RuntimeWarningDialog
    category="文件校验"
    idPrefix="runtime-file-warning"
    message={fileWarning.message}
    onClose={() => setFileWarning(null)}
    title={fileWarning.title}
  />
) : null}
```

不修改 `RuntimeWarningDialog` 结构和 CSS。

- [ ] **Step 6: 审计交互顺序**

人工核对：表单字段错误优先、确认未勾选其次、文件名错误再次、最后才调用 `onSubmit()`；关闭弹窗只清除 `fileWarning`。

---

### Task 3: 静态收尾与服务重启

**Files:**
- Review: `frontend/src/features/academic-flow/ScanUploadWorkspace.tsx`
- Review: `frontend/src/features/academic-flow/StudentRuntimePage.tsx`
- Review: `frontend/tests/scanUploadState.test.ts`

- [ ] **Step 1: 静态检查**

执行 `git diff --check`；搜索 `uploadWarning`、旧 `templateFilename` 调用和底部 `{scanBlocker ? <small>...`，确认无残留。不得把静态检查表述为浏览器验证或测试通过。

- [ ] **Step 2: 清理限定缓存**

仅清理项目源码范围内 `.pytest_cache`、`__pycache__`、`*.egg-info`，不清理 `.venv` 或 `node_modules`。

- [ ] **Step 3: 创建结果检查点**

只暂存本任务设计、计划和三个前端文件；若 `.git` 只读，则记录环境限制并保留工作树。

- [ ] **Step 4: 本地重启服务**

只终止已确认属于本项目且监听 8000/5173 的 Uvicorn/Vite 进程。后端从 `backend/` 启动，前端使用 `.local/node/bin`，重启后复核监听端口和工作目录。

- [ ] **Step 5: 明确验证边界**

交付时说明 Browser plugin 未使用，并依据项目规范未运行测试、构建、Playwright 或浏览器自动化。
