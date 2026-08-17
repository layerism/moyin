# Template Download Prerequisite Attention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在确认承诺节点中，模板未下载时点击、键盘激活或拖拽上传区，只让第 1 步下载模板卡片振动，并显示“请先下载模板”的就地引导，不打开文件选择器或自动下载。

**Architecture:** `ScanUploadWorkspace` 负责识别并拦截锁定上传区的鼠标、键盘和拖拽入口，同时管理就地提示；`RuntimeNodeDialog` 负责振动并高亮第 1 步模板卡片，再把焦点移动到下载按钮。服务端的 `runtime.templateDownloaded` 仍是唯一下载事实来源，现有上传 API 与后端校验不变。

**Tech Stack:** React 18、TypeScript、现有 CSS 动画与无障碍属性、Node.js 24.18.0。

## Global Constraints

- 未下载模板时只提醒用户，不自动下载模板。
- 不打开文件选择器，不读取拖入文件，不调用扫描件上传 API。
- 提示文案固定为：`请先下载并填写模板，再上传签署后的扫描件。`
- 复用现有蓝色主操作和红色错误语义，不新增弹窗或颜色体系。
- `runtime.templateDownloaded` 继续作为模板下载状态的事实来源。
- 下载失败、节点忙碌及模板已下载状态不得误触发本提醒。
- `prefers-reduced-motion: reduce` 下取消振动，但保留文字、高亮和焦点反馈。
- 注意状态使用红色边框 `#ef4444` 和浅红色外发光 `0 0 0 3px rgb(239 68 68 / 18%)`，约 600ms 后恢复原有蓝色边框。
- 振动持续约 320ms；注意状态的清除使用独立定时器，不依赖 CSS `animationend`。
- 依据项目 `AGENTS.md`，实施期间只更新测试源并进行业务逻辑审计，不运行测试、构建、Playwright 或浏览器插件。
- 当前任务只允许实施前和完成后各一个任务范围提交，不创建中间提交。

---

### Task 1: 为锁定上传区增加可感知的操作拦截

**Files:**
- Modify: `frontend/tests/scanUploadState.test.ts`
- Modify: `frontend/src/features/academic-flow/ScanUploadWorkspace.tsx:58-175`

**Interfaces:**
- Produces: `shouldPromptTemplateDownload(input: { disabled: boolean; templateLocked: boolean }): boolean`。
- Extends: `ScanUploadWorkspace` props with `templateLocked: boolean` and `onTemplateRequired: () => void`。
- Preserves: `disabled` 仅表示节点忙碌等不可交互状态，`templateLocked` 单独表示模板未下载。

- [ ] **Step 1: 先更新纯函数测试源**

在 `frontend/tests/scanUploadState.test.ts` 中导入并覆盖新的状态判断：

```typescript
import {
  getScanFilenameError,
  getScanSubmitBlocker,
  shouldPromptTemplateDownload,
} from "../src/features/academic-flow/ScanUploadWorkspace.tsx";

test("template download reminder only handles an otherwise interactive locked upload zone", () => {
  assert.equal(shouldPromptTemplateDownload({ disabled: false, templateLocked: true }), true);
  assert.equal(shouldPromptTemplateDownload({ disabled: true, templateLocked: true }), false);
  assert.equal(shouldPromptTemplateDownload({ disabled: false, templateLocked: false }), false);
});
```

- [ ] **Step 2: 记录未来 RED 命令，本环境不执行**

```bash
cd frontend
export PATH="$PWD/../.local/node/bin:$PATH"
npm test -- scanUploadState.test.ts
```

预期实现前因 `shouldPromptTemplateDownload` 尚未导出而失败。

- [ ] **Step 3: 添加最小状态判断与组件属性**

在 `ScanUploadWorkspace.tsx` 增加：

```typescript
export function shouldPromptTemplateDownload(input: {
  disabled: boolean;
  templateLocked: boolean;
}) {
  return !input.disabled && input.templateLocked;
}
```

组件属性增加：

```typescript
templateLocked: boolean;
onTemplateRequired: () => void;
```

组件内部增加：

```typescript
const [templateReminderVisible, setTemplateReminderVisible] = useState(false);
const fileInputRef = useRef<HTMLInputElement>(null);
```

当 `templateLocked` 变为 `false` 时清理 `templateReminderVisible`。

- [ ] **Step 4: 统一锁定入口反馈**

增加单一入口函数，确保鼠标、键盘和拖拽行为一致：

```typescript
const promptTemplateDownload = () => {
  if (!shouldPromptTemplateDownload({ disabled, templateLocked })) return false;
  setTemplateReminderVisible(true);
  onTemplateRequired();
  return true;
};
```

上传区标签应设置：

```tsx
<label
  aria-disabled={disabled || templateLocked || undefined}
  className={`runtime-scan-dropzone${templateLocked ? " is-locked" : ""}`}
  role="button"
  tabIndex={disabled ? -1 : 0}
  onClick={(event) => {
    if (promptTemplateDownload()) event.preventDefault();
  }}
  onKeyDown={(event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (!promptTemplateDownload() && !disabled) fileInputRef.current?.click();
  }}
  onDragOver={(event) => event.preventDefault()}
  onDrop={drop}
>
```

`drop()` 必须先调用 `promptTemplateDownload()`；返回 `true` 时立即返回，不读取 `event.dataTransfer.files`。隐藏文件输入设置 `ref={fileInputRef}`，并使用 `disabled={disabled || templateLocked || uploading}`。

- [ ] **Step 5: 渲染持久的就地提示**

在上传区标签之后增加：

```tsx
{templateReminderVisible ? (
  <p className="runtime-scan-prerequisite-error" role="alert">
    请先下载并填写模板，再上传签署后的扫描件。
  </p>
) : null}
```

模板下载成功使 `templateLocked` 变为 `false` 后，该提示自动清除。

- [ ] **Step 6: 静态核对 API 阻断**

沿 `onClick`、`onKeyDown` 和 `onDrop` 三条入口确认：模板锁定时均在调用 `upload()` 前返回；节点忙碌时不显示模板提醒；模板解锁后仍沿用现有文件选择与逐个上传逻辑。

---

### Task 2: 高亮下载步骤并提供焦点引导

**Files:**
- Modify: `frontend/src/features/academic-flow/StudentRuntimePage.tsx:443-745`
- Modify: `frontend/src/styles.css:3338-3354,5546-5570`

**Interfaces:**
- Consumes: `ScanUploadWorkspace` props `templateLocked` and `onTemplateRequired` from Task 1.
- Produces local interaction: `handleTemplateRequired(): void`，重播下载卡片红框和注意动画、重置 600ms 清除计时并聚焦下载按钮。

- [ ] **Step 1: 添加下载按钮引用和注意状态**

在 `RuntimeNodeDialog` 增加：

```typescript
const [templateDownloadAttention, setTemplateDownloadAttention] = useState(false);
const templateDownloadButtonRef = useRef<HTMLButtonElement>(null);
const templateDownloadAttentionFrameRef = useRef<number | null>(null);
const templateDownloadAttentionTimerRef = useRef<number | null>(null);
```

增加统一处理函数：

```typescript
const handleTemplateRequired = () => {
  if (templateDownloadAttentionFrameRef.current !== null) {
    window.cancelAnimationFrame(templateDownloadAttentionFrameRef.current);
  }
  if (templateDownloadAttentionTimerRef.current !== null) {
    window.clearTimeout(templateDownloadAttentionTimerRef.current);
  }
  setTemplateDownloadAttention(false);
  templateDownloadAttentionFrameRef.current = window.requestAnimationFrame(() => {
    templateDownloadAttentionFrameRef.current = null;
    setTemplateDownloadAttention(true);
    templateDownloadButtonRef.current?.focus();
    templateDownloadAttentionTimerRef.current = window.setTimeout(() => {
      setTemplateDownloadAttention(false);
      templateDownloadAttentionTimerRef.current = null;
    }, 600);
  });
};
```

增加卸载清理：

```typescript
useEffect(() => () => {
  if (templateDownloadAttentionFrameRef.current !== null) {
    window.cancelAnimationFrame(templateDownloadAttentionFrameRef.current);
  }
  if (templateDownloadAttentionTimerRef.current !== null) {
    window.clearTimeout(templateDownloadAttentionTimerRef.current);
  }
}, []);
```

当 `runtime.templateDownloaded` 变为 `true` 时取消待执行帧和定时器，并清除 `templateDownloadAttention`：

```typescript
useEffect(() => {
  if (!runtime.templateDownloaded) return;
  if (templateDownloadAttentionFrameRef.current !== null) {
    window.cancelAnimationFrame(templateDownloadAttentionFrameRef.current);
    templateDownloadAttentionFrameRef.current = null;
  }
  if (templateDownloadAttentionTimerRef.current !== null) {
    window.clearTimeout(templateDownloadAttentionTimerRef.current);
    templateDownloadAttentionTimerRef.current = null;
  }
  setTemplateDownloadAttention(false);
}, [runtime.templateDownloaded]);
```

- [ ] **Step 2: 连接模板卡片和上传区**

确认承诺节点的模板区域改为：

```tsx
<section
  className={`runtime-template-download${templateDownloadAttention ? " needs-attention" : ""}`}
>
  <span>1</span>
  <div>
    <strong>{runtime.templateDownloaded ? "模板已下载" : "下载签署文件模板"}</strong>
    <small>{runtime.template.originalName} · {formatFileSize(runtime.template.sizeBytes)}</small>
  </div>
  <button
    disabled={busy}
    onClick={onDownloadTemplate}
    ref={templateDownloadButtonRef}
    type="button"
  >
    {runtime.templateDownloaded ? "重新下载" : "下载模板"}
  </button>
</section>
<strong className="runtime-upload-step-title">2 上传签署后的扫描件</strong>
<ScanUploadWorkspace
  disabled={busy}
  templateLocked={!runtime.templateDownloaded}
  nodeInstanceId={runtime.id}
  onDownload={onDownloadFile}
  onStateChange={updateScanState}
  onTemplateRequired={handleTemplateRequired}
/>
```

不得继续把 `!runtime.templateDownloaded` 合并进 `disabled`，否则上传区仍会静默吞掉点击。

- [ ] **Step 3: 添加注意动画和错误样式**

在 `frontend/src/styles.css` 增加：

```css
.runtime-scan-dropzone.is-locked {
  cursor: pointer;
}

.runtime-template-download.needs-attention {
  border-color: #ef4444;
  box-shadow: 0 0 0 3px rgb(239 68 68 / 18%);
  animation: runtime-template-download-attention 320ms ease-in-out;
}

.runtime-scan-prerequisite-error {
  margin: 0;
  color: #d92d20;
  font-size: 13px;
  font-weight: 700;
}

@keyframes runtime-template-download-attention {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-5px); }
  75% { transform: translateX(5px); }
}

@media (prefers-reduced-motion: reduce) {
  .runtime-template-download.needs-attention {
    animation: none;
  }
}
```

注意类持续约 600ms，因此振动结束后红框仍短暂可见；减少动态效果模式仍显示同样时长的红框与外发光，并保留红色就地提示和焦点移动。

- [ ] **Step 4: 记录未来 GREEN 命令，本环境不执行**

```bash
cd frontend
export PATH="$PWD/../.local/node/bin:$PATH"
npm test -- scanUploadState.test.ts
```

预期：新增纯函数测试与既有扫描件状态测试全部通过。当前实施环境依据 `AGENTS.md` 不执行该命令。

- [ ] **Step 5: 完成业务逻辑审计**

静态确认以下条件：

- 模板未下载且节点非忙碌时，鼠标、Enter、Space 和拖拽均触发相同提醒。
- 锁定状态下隐藏文件输入保持禁用，三条入口均不会调用 `workflowApi.uploadScan()`。
- 点击上传区不会调用 `onDownloadTemplate()`；只有下载按钮会触发下载。
- 下载成功后的服务端状态更新会清除提示并恢复上传。
- 下载失败或节点忙碌时不会把状态误判为已下载。
- 红框与外发光约 600ms 后恢复蓝色边框，连续点击会重新计时并重播。
- `prefers-reduced-motion` 只移除振动，不移除红框、提示和焦点；红框仍会按时恢复。

- [ ] **Step 6: 完成任务范围收尾**

在项目约束允许的范围内执行：

```bash
git diff --check
rg -n "templateLocked|onTemplateRequired|runtime-scan-prerequisite-error|runtime-template-download-attention" frontend/src frontend/tests
```

清理项目源码产生的 `.pytest_cache`、`__pycache__`、`*.egg-info`，随后从 `backend/` 与 `frontend/` 以本地方式重启服务，并确认端口 `8000`、`5173` 和对应工作目录。最后仅提交本任务涉及的设计、计划、前端和测试源文件；若 `.git` 仍只读，记录限制且不尝试绕过。
