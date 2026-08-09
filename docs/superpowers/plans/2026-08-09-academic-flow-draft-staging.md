# 教务流程暂存与离开确认实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development with one persistent implementation subagent. Track every step with the checkbox syntax below; the root agent performs the final review.

**Goal:** 为未发布草稿和已发布流程修订增加服务器暂存、恢复及离开前“暂存并离开”能力，同时保持学生运行时只读取当前发布版本。

**Architecture:** 教师流程响应同时携带不可变发布配置 `config` 和可编辑服务器草稿 `draftConfig`。前端将服务器未发布差异 `hasUnpublishedChanges` 与浏览器本地未暂存状态 `revisionDirty` 分离，并让主动暂存、模板资产同步及暂存后导航复用同一保存函数。

**Tech Stack:** FastAPI、SQLite、Python、React、TypeScript、Vite、Node test runner。

## Global Constraints

- 当前分支实施，不创建工作树。
- 只允许一个持久化 subagent 顺序完成全部业务修改，根代理负责审计。
- 开发过程中不运行自动化测试、构建或浏览器自动化，只更新测试并做静态业务逻辑审计。
- 不新增数据库表、后端路由、第三方依赖或自动保存任务。
- 学生实例、分享链接、教师进度及已发布版本继续只读取 `flow_versions`。
- 已有用户改动 `AGENTS.md`、`INSTALL.md`、`MEMORY.md` 不暂存、不覆盖。
- 开始实施前已有设计检查点；全部实现和静态审计结束后只创建一个最终检查点提交。
- 结束前清理 `.pytest_cache`、`__pycache__`、`*.egg-info` 等中间缓存，并以本地方式重启 FastAPI 与 Vite。

---

### Task 1: 教师流程 API 暴露独立服务器草稿

**Files:**
- Modify: `backend/app/repositories/workflows.py:557-598`
- Test: `backend/tests/test_workflows.py:313-397`

**Interfaces:**
- Consumes: `canonical_json(value: object) -> str` 与 `_version_config_with_runtime_deadlines(connection, published)`。
- Produces: 教师流程响应字段 `draftConfig: {nodes: list, edges: list}`；`hasUnpublishedChanges: bool` 表示规范化草稿是否不同于当前发布配置。

- [ ] **Step 1: 更新发布快照隔离测试断言**

  在 `test_published_snapshot_does_not_change_with_draft` 中保留发布配置和学生实例断言，并增加：

  ```python
  assert reloaded["config"]["nodes"][0]["title"] == "基本信息"
  assert reloaded["draftConfig"]["nodes"][0]["title"] == "修改后的标题"
  assert reloaded["hasUnpublishedChanges"] is True
  ```

  在首次发布后的响应断言中确认：

  ```python
  assert current["draftConfig"] == current["config"]
  assert current["hasUnpublishedChanges"] is False
  ```

- [ ] **Step 2: 更新修订保存测试断言**

  在 `test_revision_metadata_and_impact_protect_published_nodes` 的 `saved` 响应中断言：

  ```python
  assert saved.json()["config"]["nodes"][0]["title"] == "基本信息"
  assert saved.json()["draftConfig"]["nodes"][0]["title"] == "修改后的基本信息"
  assert saved.json()["hasUnpublishedChanges"] is True
  ```

- [ ] **Step 3: 修改 `get_flow()` 的教师响应**

  继续让 `config` 返回发布快照或未发布草稿，同时新增服务器草稿并计算差异：

  ```python
  visible_config = published_config if published_config is not None else draft_config
  has_unpublished_changes = (
      published_config is not None
      and canonical_json(draft_config) != canonical_json(published_config)
  )
  ```

  返回对象使用：

  ```python
  "config": visible_config,
  "draftConfig": draft_config,
  "hasUnpublishedChanges": has_unpublished_changes,
  ```

- [ ] **Step 4: 静态检查后端数据边界**

  确认 `save_draft()` 仍通过 `get_flow()` 返回新字段，`publish_flow()` 仍将发布快照回写为草稿基线；确认学生相关 repository 未改动。

### Task 2: 前端领域模型保存双配置语义

**Files:**
- Modify: `frontend/src/types.ts:136-151`
- Modify: `frontend/src/features/academic-flow/api.ts:14-27`
- Modify: `frontend/src/features/academic-flow/academicFlowData.ts:32-48`
- Modify: `frontend/src/App.tsx:114-130,284-316,612-630`

**Interfaces:**
- Consumes: Task 1 的 `ServerFlow.config`、`ServerFlow.draftConfig` 与 `ServerFlow.hasUnpublishedChanges`。
- Produces: `AcademicProcess.draftConfig`；`onSaveProcess(process: AcademicProcess): Promise<AcademicProcess>`。

- [ ] **Step 1: 增加共享配置类型**

  在 `types.ts` 中定义并使用：

  ```ts
  export type AcademicFlowConfig = {
    edges: AcademicFlowEdge[];
    nodes: AcademicFlowNode[];
  };
  ```

  在既有 `AcademicProcess` 字段列表中加入 `draftConfig: AcademicFlowConfig`，不改变其他字段。

  在 `api.ts` 中把 `ServerFlow.config` 与 `ServerFlow.draftConfig` 都声明为 `AcademicFlowConfig`。

- [ ] **Step 2: 初始化本地新流程的草稿配置**

  `createAcademicProcess()` 使用同一空内容初始化列表展示和服务器草稿模型：

  ```ts
  edges: [],
  nodes: [],
  draftConfig: { edges: [], nodes: [] },
  ```

- [ ] **Step 3: 映射服务器的发布配置与草稿配置**

  `mapServerFlow()` 保持 `nodes/edges` 来自 `flow.config`，并增加深层可编辑草稿映射：

  ```ts
  draftConfig: {
    edges: flow.draftConfig.edges ?? [],
    nodes: flow.draftConfig.nodes ?? [],
  },
  ```

- [ ] **Step 4: 增加 App 层统一暂存回调**

  在 `App` 中新增：

  ```ts
  const saveAcademicProcess = async (process: AcademicProcess) => {
    const serverId = process.serverId ?? process.id;
    return mapServerFlow(await workflowApi.saveDraft(serverId, process));
  };
  ```

  两处 `AcademicFlowDesigner` 均传入 `onSaveProcess={saveAcademicProcess}`。发布成功返回值同时设置：

  ```ts
  draftConfig: { nodes: saved.nodes, edges: saved.edges },
  hasUnpublishedChanges: false,
  ```

- [ ] **Step 5: 审计所有 `AcademicProcess` 构造点**

  使用 `rg -n "AcademicProcess|hasUnpublishedChanges:" frontend/src` 检查每个对象构造点都提供 `draftConfig`，并确认列表页仍展示发布版本的 `nodes/edges`。

### Task 3: 分离“修订中”与“本地未暂存”状态

**Files:**
- Modify: `frontend/src/features/academic-flow/publishButtonState.ts:1-52`
- Test: `frontend/tests/publishButtonState.test.ts:1-95`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:92-250`

**Interfaces:**
- Consumes: `AcademicProcess.draftConfig` 与 `AcademicProcess.hasUnpublishedChanges`。
- Produces: `getRevisionEditing(published, revisionEditingRequested, hasUnpublishedChanges): boolean`；初始化工作副本 helper。

- [ ] **Step 1: 扩展状态函数测试用例**

  将测试覆盖手动解锁和服务器已有修订两条路径：

  ```ts
  assert.equal(getRevisionEditing(true, false, true), true);
  assert.equal(getRevisionEditing(true, false, false), false);
  assert.equal(getRevisionEditing(true, true, false), true);
  assert.equal(getRevisionEditing(false, true, true), false);
  ```

  保留 `getPublishButtonState()` 的发布名单和操作锁断言，并增加“已暂存修订可重新发布”的断言。

- [ ] **Step 2: 修改修订编辑判定**

  ```ts
  export function getRevisionEditing(
    published: boolean,
    revisionEditingRequested: boolean,
    hasUnpublishedChanges: boolean,
  ) {
    return published && (revisionEditingRequested || hasUnpublishedChanges);
  }
  ```

- [ ] **Step 3: 从服务器草稿创建设计器工作副本**

  在 `AcademicFlowDesigner.tsx` 增加局部 helper：

  ```ts
  function createDraftWorkingProcess(process: AcademicProcess): AcademicProcess {
    return structuredClone({
      ...process,
      edges: process.draftConfig.edges,
      nodes: process.draftConfig.nodes,
    });
  }
  ```

  初始 state 和流程切换 effect 均调用该 helper；`activeNodeId` 也从 `draftConfig.nodes` 选择。

- [ ] **Step 4: 正确传递服务器未发布状态**

  `revisionEditing` 调用加入 `workingProcess.hasUnpublishedChanges`，`getPublishButtonState()` 的 `hasUnpublishedChanges` 改为：

  ```ts
  hasUnpublishedChanges: workingProcess.hasUnpublishedChanges || revisionDirty,
  ```

  `revisionDirty` 只在 `commitDesignChange()` 发生本地修改时设为真；重新进入已暂存修订时保持假。

- [ ] **Step 5: 保持已发布保护基线不变**

  确认 `protectedNodeIds`、`protectedEdgeIds` 和 `publishedRuntimeNodes` 继续取父级 `process` 的发布配置，而设计画布取 `workingProcess` 的草稿配置。

### Task 4: 统一主动暂存、模板同步和离开导航

**Files:**
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:92-610`
- Modify: `frontend/src/features/academic-flow/UnsavedChangesDialog.tsx:1-56`
- Modify: `frontend/src/styles.css:1333-1360,3635-3748`

**Interfaces:**
- Consumes: `onSaveProcess(process) -> Promise<AcademicProcess>` 与 `onProcessChange(process)`。
- Produces: `saveWorkingDraft(candidate, successMessage) -> Promise<AcademicProcess | null>`；`draftSaving: boolean`；三动作离开对话框。

- [ ] **Step 1: 增加统一暂存函数**

  在设计器 props 增加 `onSaveProcess`，并实现：

  ```ts
  const [draftSaving, setDraftSaving] = useState(false);

  const saveWorkingDraft = async (
    candidate: AcademicProcess,
    successMessage = "流程已暂存",
  ) => {
    setSaving(true);
    setDraftSaving(true);
    setActionNotice("");
    try {
      const saved = await onSaveProcess(candidate);
      const nextWorking = createDraftWorkingProcess(saved);
      onProcessChange(saved);
      setWorkingProcess(nextWorking);
      setRevisionDirty(false);
      setActionNotice(successMessage);
      return nextWorking;
    } catch (reason) {
      setRevisionDirty(true);
      setActionNotice(reason instanceof Error ? reason.message : "暂存失败");
      return null;
    } finally {
      setDraftSaving(false);
      setSaving(false);
    }
  };
  ```

- [ ] **Step 2: 增加顶部暂存按钮**

  在学生名单与发布按钮之间加入：

  ```tsx
  <button
    disabled={editorLocked || !revisionDirty}
    onClick={() => void saveWorkingDraft(workingProcess)}
    type="button"
  >
    {draftSaving ? "暂存中" : "暂存"}
  </button>
  ```

  保持发布按钮为唯一 `primary-action`；暂存按钮使用现有次要按钮样式。

- [ ] **Step 3: 让模板操作回到统一草稿基线**

  上传前若 `revisionDirty`，先调用 `saveWorkingDraft(workingProcess, "")`，失败则终止上传。上传 API 成功后，将返回的 `templateAsset` 合入当前工作副本，再调用 `saveWorkingDraft(nextProcess, "模板已上传，重新发布后供学生下载")`；删除 API 成功后合入 `templateAsset: null`，再调用 `saveWorkingDraft(nextProcess, "模板已删除")`。最终状态使用保存响应，不手工猜测 `hasUnpublishedChanges`。

- [ ] **Step 4: 扩展离开确认组件接口**

  `UnsavedChangesDialog` props 改为：

  ```ts
  {
    destination: string;
    onCancel: () => void;
    onDiscard: () => void;
    onSave: () => void;
    saving: boolean;
  }
  ```

  调用方传入 `saving={draftSaving}`。文案改为“当前修改尚未暂存”，footer 依次提供“继续编辑”“不暂存并离开”“暂存并离开”。保存期间全部按钮和关闭按钮禁用，主按钮显示“暂存中”。Escape 仅在 `saving === false` 时关闭。

- [ ] **Step 5: 实现保存成功后导航**

  对话框 `onSave` 调用统一暂存函数：

  ```ts
  const saved = await saveWorkingDraft(workingProcess);
  if (!saved || !pendingNavigation) return;
  const navigate = pendingNavigation.run;
  setPendingNavigation(null);
  navigate();
  ```

  `onDiscard` 直接执行已保存的导航回调；保存失败时保留 `pendingNavigation` 和画布内容。

- [ ] **Step 6: 调整对话框移动端按钮布局**

  为三按钮 footer 保持 `flex-wrap: wrap`；窄屏继续纵向排列，并给“暂存并离开”使用 `primary-action` 视觉，危险按钮仅用于“不暂存并离开”。

### Task 5: 完成静态审计、清理和本地服务重启

**Files:**
- Review: `backend/app/repositories/workflows.py`
- Review: `backend/tests/test_workflows.py`
- Review: `frontend/src/types.ts`
- Review: `frontend/src/App.tsx`
- Review: `frontend/src/features/academic-flow/api.ts`
- Review: `frontend/src/features/academic-flow/academicFlowData.ts`
- Review: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
- Review: `frontend/src/features/academic-flow/UnsavedChangesDialog.tsx`
- Review: `frontend/src/features/academic-flow/publishButtonState.ts`
- Review: `frontend/tests/publishButtonState.test.ts`
- Review: `frontend/src/styles.css`

**Interfaces:**
- Consumes: Tasks 1-4 的完整变更。
- Produces: 静态审计通过的最终检查点和重启后的本地服务。

- [ ] **Step 1: 审计状态转换闭环**

  逐条核对：进入已暂存修订、产生本地修改、主动暂存、暂存并离开、不暂存离开、首次发布、重新发布、模板上传、模板删除、保存失败。每条路径都必须明确更新 `workingProcess`、`revisionDirty`、`hasUnpublishedChanges` 和父级缓存。

- [ ] **Step 2: 审计运行时隔离**

  使用 `rg` 确认学生实例、共享流程和教师进度查询未读取 `flows.draft_config`；前端进度面板仍使用 `process.nodes` 与 `publishedNodeIds`。

- [ ] **Step 3: 执行非运行型检查**

  仅执行：

  ```bash
  git diff --check
  rg -n "draftConfig|hasUnpublishedChanges|revisionDirty|saveWorkingDraft" backend frontend
  git status --short
  ```

  不执行 pytest、Node test、TypeScript build、Vite build 或浏览器自动化。

- [ ] **Step 4: 清理开发缓存**

  只删除仓库内 `.pytest_cache`、`__pycache__`、`*.egg-info` 中间缓存；先解析精确路径，不触碰源码、依赖目录或用户文件。

- [ ] **Step 5: 创建最终检查点提交**

  只暂存本计划列出的功能文件和本实施计划，不纳入用户已有改动。提交信息：

  ```bash
  git commit -m "feat: add academic flow draft staging"
  ```

- [ ] **Step 6: 本地重启并确认进程存活**

  停止当前 FastAPI 与 Vite 进程后，按仓库既有本地命令各启动一个实例。只检查进程与端口存活，不执行浏览器验收；将手动验收入口交给用户。
