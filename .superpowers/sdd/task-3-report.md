# Task 3 最终全分支审查修复报告

## 状态

`COMPLETED`

## 本轮修复

### 1. 历史节点永久删除保护

- 草稿保存和发布均在 `BEGIN IMMEDIATE` 事务内聚合该流程全部历史 `config_snapshot` 的节点 ID。
- 任一历史节点缺失均返回 409，不再仅比对 latest published。
- 兼容性测试覆盖“latest 已经遗失更早节点”的历史数据库。

### 2. 统一迁移计划与重复学生归一化

- `revision-impact`、实际迁移和 `workflow_republish` 审计共用同一 migration plan。
- 每个学生按最高 `version_no` 实例作为最终保留实例；低版本重复实例仅产生 `flow_instance_normalized` 删除前审计。
- 低版本有 impact、高版本无 impact 时，聚合 affected 为 0，不产生 invalidation audit。
- 分版本 impact、聚合 impact、affected students 和 migrated students 均写入总审计。

### 3. 预览/发布 TOCTOU 保护

- `revision-impact` 返回规范 JSON 的 SHA-256 `draftConfigHash`。
- 重新发布必须携带 `expectedDraftConfigHash`；发布在 `BEGIN IMMEDIATE` 内重读草稿并校验，缺失或不匹配均返回 409。
- 首次发布保持兼容，可不传 hash。

### 4. 截止时间继承与状态重算

- 历史节点按最高版本的最终保留实例/当前基准版本继承 `flow_node_runtime_configs.deadline_at`。
- 新增节点使用草稿 deadline 或 `null`。
- 测试覆盖 2035 年截止时间保留，以及继承过期截止时间后节点重算为 `expired`。

### 5. DAG 校验、令牌审计与删除清理

- `revision-impact` 在同一只读快照内执行完整 DAG/config validation；悬空边和循环由 route 映射为 422。
- 每个未过期 active token 均原子重定向，并独立审计 token ID、sourceVersionId 和 targetVersionId，不记录令牌明文。
- 无可返回的有效明文 token 时创建新 token，使用独立 `share_token_created` 审计。
- 流程永久删除时同步清理 token 实体审计，避免孤立记录。

## TDD 证据

### RED

```bash
cd backend && PYTHONPATH=. .venv/bin/pytest \
  tests/test_workflow_republish.py tests/test_workflows.py -q
```

首次结果：`9 failed, 22 passed in 3.33s`。失败覆盖重复学生 impact、截止时间继承、token 分项审计/创建审计、非法 DAG 映射、draft hash 以及历史节点删除保护。

实现后首次定向结果：`2 failed, 29 passed in 3.92s`，暴露分版本 affected count 仍未完全按最终保留实例计算。

### GREEN

```bash
cd backend && PYTHONPATH=. .venv/bin/pytest \
  tests/test_workflow_republish.py tests/test_workflows.py -q
# 31 passed in 3.08s

cd backend && PYTHONPATH=. .venv/bin/pytest -q
# 65 passed in 5.60s

cd backend && .venv/bin/ruff check .
# All checks passed!

cd backend && .venv/bin/ruff format --check \
  app/repositories/workflows.py \
  app/domain/workflow_revision.py \
  app/api/routes/workflows.py \
  tests/test_workflow_republish.py \
  tests/test_workflows.py
# 5 files already formatted
```

`git diff --check` 通过。

## 变更文件

- `backend/app/domain/workflow_revision.py`
- `backend/app/repositories/workflows.py`
- `backend/app/api/routes/workflows.py`
- `backend/tests/test_workflow_republish.py`
- `backend/tests/test_workflows.py`
- `.superpowers/sdd/task-3-report.md`

本轮未修改前端，也无需修改 `backend/app/core/database.py`。`flow_instances.py` 中的事务内重读和单快照协议沿用已审核基线。

## 自审

- 预览与执行共用 migration plan，不会因重复学生在两阶段采用不同规则。
- 历史节点检查、hash 校验、迁移、deadline 继承、token 重定向和审计均位于同一 `BEGIN IMMEDIATE` 事务。
- 重复实例和失效节点均先写完整 before-data 审计，再按外键顺序删除。
- 强制 token 更新异常测试验证新版本、runtime config、实例、节点、token 和审计整体回滚。
- 真实双连接快照测试验证发布在 `get_instance` 两次 SELECT 之间提交时，旧 config 和旧 nodes 仍保持一致。

## 关注事项

无已知后端阻断问题。重新发布 API 现在要求调用方先获取 `revision-impact` 并回传 `draftConfigHash`，这是预期的并发安全合同。

## 提交

- 本轮基线：`762140f Harden workflow revision editing`
- 本轮修复：本报告所在提交，提交信息为 `Fix final workflow republish review blockers`。

---

## Important 复审追加修复

### 修复内容

1. `publish_flow` 在 `BEGIN IMMEDIATE` 内重读草稿后立即计算 canonical hash。已携带的 expected hash 不匹配时立即返回 409；重新发布缺失 hash 也在 DAG validation 前返回 409。因此“有效预览 -> 草稿改为循环图 -> 使用旧 hash 发布”稳定返回 `DraftRevisionConflictError`，不泄漏新草稿的验证结果。
2. deadline 继承改为扫描该 flow 全部历史版本，按 `version_no DESC` 对每个节点选取最新 runtime row。采用“最新 row 覆盖，包括 `NULL`”语义：`NULL` 表示该最新版本明确无截止时间。回归测试覆盖 v1 的 2035 deadline、v2 缺失该节点、v1 无实例/无活动 token，新版恢复节点后仍继承 2035 deadline。
3. 新增 `_assert_no_published_node_deletions` 作为草稿保存、impact preview 和 publish execute 的共享全历史节点保护。`revision-impact` 在同一只读事务内先执行该保护，route 将 `PublishedNodeDeletionError` 映射为 409；preview 与 execute 现在返回相同的删除冲突。

### TDD 证据

RED：

```bash
cd backend && PYTHONPATH=. .venv/bin/pytest \
  tests/test_workflows.py tests/test_workflow_republish.py -q
# 3 failed, 30 passed in 3.36s
```

GREEN 与最终验证：

```bash
cd backend && PYTHONPATH=. .venv/bin/pytest \
  tests/test_workflows.py tests/test_workflow_republish.py -q
# 33 passed in 3.36s

cd backend && PYTHONPATH=. .venv/bin/pytest -q
# 67 passed in 6.99s

cd backend && .venv/bin/ruff check .
# All checks passed!

cd backend && .venv/bin/ruff format --check \
  app/repositories/workflows.py \
  app/api/routes/workflows.py \
  tests/test_workflow_republish.py \
  tests/test_workflows.py
# 4 files already formatted
```

`git diff --check` 通过。本次仅修改上述 4 个后端文件及本报告，未修改前端。

### 自审与关注事项

- hash 冲突检查优先于历史节点保护和 DAG validation；仅 hash 匹配后才检查当前草稿。
- deadline 查询不再依赖 published/baseline/instance/token 范围，深层 disabled 历史版本也可作为节点最近 runtime 来源。
- 无已知后端阻断问题。

追加修复基线：`afc2b94 Bind workflow publish to revision preview`。追加提交信息：`Resolve remaining workflow republish review issues`。
