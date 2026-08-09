# 学生名单单人录入与关闭核对实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development with one persistent implementation subagent. Track every step with checkbox (`- [ ]`) syntax; the root agent performs the final review.

**Goal:** 在学生名单弹窗中增加单人录入，并要求教师在本次会话发生名单变更后明确完成关闭核对。

**Architecture:** 单人录入复用现有 `workflowApi.importRoster()`，服务器继续即时保存。`FlowRosterDialog` 用本地 `hasRosterChanges` 和 `confirmingClose` 区分“名单已经保存”和“教师是否完成核对”，所有关闭入口统一经过 `requestClose()`。

**Tech Stack:** React、TypeScript、CSS、FastAPI 既有名单接口、pytest 测试代码。

## Global Constraints

- 当前 `main` 分支实施，不创建工作树。
- 只允许一个持久化 subagent 顺序完成全部业务修改，根代理负责静态审计。
- 开发过程中不运行 pytest、前端测试、构建或浏览器自动化，只更新测试代码并做静态业务逻辑审计。
- 不新增数据库表、后端路由、前端 API 方法、第三方依赖或浏览器暂存层。
- Excel 导入、单人录入和移除成功后立即保存，不提供撤销语义。
- 名单未发生变更时保持直接关闭；请求进行中禁止关闭。
- 用户已有 `AGENTS.md`、`INSTALL.md`、`MEMORY.md` 不暂存、不覆盖。
- 已有设计提交作为开发前检查点；实现与静态审计结束后只创建一个最终检查点提交。
- 结束前清理仓库源码目录中的 `.pytest_cache`、`__pycache__`、`*.egg-info`，并以本地方式重启 FastAPI 与 Vite。

---

### Task 1: 补充单条名单导入语义测试

**Files:**
- Test: `backend/tests/test_flow_roster.py:27-80`

**Interfaces:**
- Consumes: 既有测试 helper `import_roster(client, flow_id, entries)` 及 `DELETE /api/workflows/{flow_id}/roster/{entry_id}`。
- Produces: `test_single_roster_entry_reuses_import_semantics`，覆盖单条新增、更新和恢复。

- [ ] **Step 1: 增加单条导入测试**

  在现有导入测试后增加：

  ```python
  def test_single_roster_entry_reuses_import_semantics(client: TestClient) -> None:
      flow_id = create_flow(client)

      added = import_roster(
          client,
          flow_id,
          [{"studentNo": "001", "name": "学生甲"}],
      )
      assert added.status_code == 200
      assert added.json()["summary"] == {"added": 1, "restored": 0, "updated": 0}

      updated = import_roster(
          client,
          flow_id,
          [{"studentNo": "001", "name": "学生甲（更名）"}],
      )
      assert updated.json()["summary"] == {"added": 0, "restored": 0, "updated": 1}

      entry_id = updated.json()["entries"][0]["id"]
      assert client.delete(f"/api/workflows/{flow_id}/roster/{entry_id}").status_code == 200

      restored = import_roster(
          client,
          flow_id,
          [{"studentNo": "001", "name": "学生甲（更名）"}],
      )
      assert restored.json()["summary"] == {"added": 0, "restored": 1, "updated": 0}
      assert restored.json()["activeCount"] == 1
  ```

- [ ] **Step 2: 静态核对测试不要求后端变更**

  确认测试只使用既有批量导入和移除接口，且未引入“手动录入”专用后端语义。

### Task 2: 实现单人录入与统一关闭核对

**Files:**
- Modify: `frontend/src/features/academic-flow/FlowRosterDialog.tsx:10-199`

**Interfaces:**
- Consumes: `workflowApi.importRoster(flowId, { entries, sourceFileName })`、`FlowRoster.summary` 和父级 `onRosterChange(roster)`。
- Produces: `requestClose(): void`、`addManualEntry(): Promise<void>`；本地状态 `manualStudentNo`、`manualName`、`hasRosterChanges`、`confirmingClose`。

- [ ] **Step 1: 增加单人录入与关闭状态**

  在既有 state 区域增加：

  ```tsx
  const [manualStudentNo, setManualStudentNo] = useState("");
  const [manualName, setManualName] = useState("");
  const [hasRosterChanges, setHasRosterChanges] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const canAddManualEntry = Boolean(manualStudentNo.trim() && manualName.trim());
  ```

- [ ] **Step 2: 统一关闭入口**

  在异步操作函数前增加：

  ```tsx
  const requestClose = () => {
    if (busy) return;
    if (!hasRosterChanges) {
      onClose();
      return;
    }
    setConfirmingClose(true);
  };
  ```

  外部遮罩改为 `onMouseDown={requestClose}`，右上角关闭按钮改为 `onClick={requestClose}` 并设置 `disabled={busy}`。弹窗 section 继续阻止事件冒泡。

- [ ] **Step 3: 标记三类成功名单变更**

  在批量 `importEntries()`、`revokeEntry()` 的服务器成功分支中，在更新 `roster` 和父级人数后执行：

  ```tsx
  setHasRosterChanges(true);
  ```

  失败分支不修改该状态。

- [ ] **Step 4: 实现单人录入请求**

  增加：

  ```tsx
  const addManualEntry = async () => {
    const studentNo = manualStudentNo.trim();
    const name = manualName.trim();
    if (!studentNo || !name) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await workflowApi.importRoster(flowId, {
        entries: [{ studentNo, name }],
        sourceFileName: "手动录入",
      });
      setRoster(next);
      onRosterChange(next);
      setHasRosterChanges(true);
      setManualStudentNo("");
      setManualName("");
      setNotice(
        next.summary.added
          ? `已添加 ${name}（${studentNo}）`
          : next.summary.restored
            ? `已恢复 ${name}（${studentNo}）的流程访问权限`
            : next.summary.updated
              ? `已更新 ${studentNo} 的姓名为 ${name}`
              : `${name}（${studentNo}）已在有效名单中`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "添加学生失败");
    } finally {
      setBusy(false);
    }
  };
  ```

- [ ] **Step 5: 渲染单人录入表单**

  在批量导入区之后、解析预览之前增加：

  ```tsx
  <form
    className="flow-roster-manual-entry"
    onSubmit={(event) => {
      event.preventDefault();
      void addManualEntry();
    }}
  >
    <strong>单个录入</strong>
    <input
      aria-label="学生学号"
      disabled={busy}
      onChange={(event) => setManualStudentNo(event.target.value)}
      placeholder="学号"
      value={manualStudentNo}
    />
    <input
      aria-label="学生姓名"
      disabled={busy}
      onChange={(event) => setManualName(event.target.value)}
      placeholder="姓名"
      value={manualName}
    />
    <button disabled={busy || !canAddManualEntry} type="submit">添加学生</button>
  </form>
  ```

- [ ] **Step 6: 渲染关闭核对提示**

  在消息区之后增加：

  ```tsx
  {confirmingClose ? (
    <section
      aria-label="关闭名单核对"
      className="flow-roster-close-review"
      role="alertdialog"
    >
      <p><strong>名单变更已保存</strong><span>请确认是否完成核对。</span></p>
      <div>
        <button onClick={() => setConfirmingClose(false)} type="button">继续核对</button>
        <button className="primary-action" onClick={onClose} type="button">确认关闭</button>
      </div>
    </section>
  ) : null}
  ```

  核对提示存在时，遮罩再次触发 `requestClose()` 只维持 `confirmingClose=true`，不能绕过确认。

- [ ] **Step 7: 静态审计错误和竞态路径**

  确认 `busy` 同时禁用文件选择、批量导入、单人输入、单人提交、移除和关闭按钮；单人请求失败不会清空 `manualStudentNo`、`manualName`，也不会把 `hasRosterChanges` 从假变为真。

### Task 3: 补充现有界面的最小样式

**Files:**
- Modify: `frontend/src/styles.css:1520-1750`

**Interfaces:**
- Consumes: `.flow-roster-manual-entry` 与 `.flow-roster-close-review` DOM 结构。
- Produces: 与既有名单弹窗一致的桌面和窄屏布局，不新增动画或设计系统组件。

- [ ] **Step 1: 增加单人录入横向布局**

  在 `.flow-roster-import` 样式后增加：

  ```css
  .flow-roster-manual-entry {
    display: grid;
    grid-template-columns: auto minmax(150px, 1fr) minmax(120px, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 12px 20px;
    border-bottom: 1px solid #e2e8f0;
    background: #ffffff;
  }

  .flow-roster-manual-entry input,
  .flow-roster-manual-entry button {
    min-height: 36px;
  }
  ```

  输入框沿用名单搜索框的边框、圆角、字号；提交按钮沿用现有普通操作按钮，并为禁用状态设置 `cursor: not-allowed` 和透明度。

- [ ] **Step 2: 增加关闭核对提示布局**

  ```css
  .flow-roster-close-review {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin: 12px 20px 0;
    padding: 12px 14px;
    border: 1px solid #f3c969;
    border-radius: 6px;
    background: #fffbeb;
  }

  .flow-roster-close-review p,
  .flow-roster-close-review div {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
  }
  ```

  补充内部按钮样式，并让 `.primary-action` 保持现有蓝色主操作视觉。

- [ ] **Step 3: 增加窄屏布局**

  在现有名单弹窗媒体查询中把单人表单改为单列，关闭核对提示改为纵向排列并让按钮区域占满可用宽度。

### Task 4: 静态验收、清理、提交和本地重启

**Files:**
- Review: `frontend/src/features/academic-flow/FlowRosterDialog.tsx`
- Review: `frontend/src/styles.css`
- Review: `backend/tests/test_flow_roster.py`
- Include: `docs/superpowers/plans/2026-08-09-flow-roster-manual-entry-and-close-review.md`

**Interfaces:**
- Consumes: Tasks 1-3 的完整变更。
- Produces: 静态审计通过的最终检查点，以及各一个存活的 FastAPI、Vite 本地服务进程。

- [ ] **Step 1: 审计需求闭环**

  逐项核对：无变更直接关闭、批量导入后关闭、单人新增后关闭、已有学号更新/恢复后关闭、移除后关闭、继续核对、确认关闭、请求中关闭、单人失败保留输入。

- [ ] **Step 2: 执行非运行型检查**

  仅执行：

  ```bash
  git diff --check
  rg -n "hasRosterChanges|confirmingClose|requestClose|addManualEntry|手动录入" frontend backend/tests
  git status --short
  ```

  不执行 pytest、Node test、TypeScript 编译、Vite build 或浏览器自动化。

- [ ] **Step 3: 清理源码缓存**

  先解析仓库源码目录中的 `.pytest_cache`、`__pycache__`、`*.egg-info` 精确路径，再删除这些中间缓存；排除 `.git`、`node_modules` 和 `backend/.venv`。

- [ ] **Step 4: 创建最终检查点**

  只暂存本计划列出的三个实现/测试文件及实施计划，不纳入用户已有文件。提交信息：

  ```bash
  git commit -m "feat: add roster manual entry and close review"
  ```

- [ ] **Step 5: 本地重启服务**

  精确确认并停止本项目占用 `8000`、`5173` 的旧进程，分别启动一个 FastAPI 与 Vite 实例。仅检查端口监听和进程存活，不执行浏览器验收。
