# 审核脚本管理：Task 1 + Task 2 合并实现报告

## 实现内容

- `audit_scripts` 新建表增加 `description` 和 `updated_at`；初始化时执行幂等迁移
  `20260717_add_audit_script_metadata`，兼容历史库并将旧记录的 `updated_at` 回填为
  `created_at`。
- 仓储创建与新增版本接口均接收描述；描述会去除首尾空白、拒绝空值并限制为 500 字符。
  创建和版本更新会写入 `description`、`updated_at`，版本目录仍仅新增，历史目录不覆盖。
- 列表与仓储摘要返回 `description`、`updatedAt`，但不返回脚本源代码、`directory_path`
  或服务器绝对路径；版本 `manifest.json` 也记录描述。
- 管理 API 的 POST/PUT 表单均要求 `description`（1--500 字符），并继续由超级管理员
  鉴权；GET 继续使用教师级路由鉴权。
- 新增/扩展测试覆盖仓储元数据、旧库迁移、描述必填、版本描述更新、普通教师 PUT 拒绝、
  列表脱敏和跨语言版本拒绝。

## RED / GREEN 记录

1. RED（首次按简报命令）：`cd backend && pytest -q tests/test_audit_scripts_api.py`
   - 当前 shell 未提供 `pytest`：`zsh:1: command not found: pytest`。
2. RED（使用项目既有虚拟环境）：`cd backend && .venv/bin/pytest -q tests/test_audit_scripts_api.py`
   - `2 failed, 5 passed`；失败原因为 `create_audit_script()` 缺少 `description`
     参数，以及旧表没有 `description` 列。
3. RED（补齐 API 契约测试后）：`cd backend && .venv/bin/pytest -q tests/test_audit_scripts_api.py`
   - `5 failed, 3 passed`；失败原因为仓储签名、旧库迁移、API 表单描述与响应摘要尚未实现。
4. GREEN：`cd backend && .venv/bin/pytest -q tests/test_audit_scripts_api.py`
   - `8 passed, 1 warning`。

## 验证结果

- 定向：`.venv/bin/pytest -q tests/test_audit_scripts_api.py`：`8 passed, 1 warning`。
- 完整后端：`.venv/bin/pytest -q`：`86 passed, 1 warning`。
- 静态检查：`.venv/bin/ruff check app/core/database.py app/repositories/audit_scripts.py app/api/routes/workflow_admin.py tests/test_audit_scripts_api.py`：`All checks passed!`。
- 补充检查：`git diff --check` 通过。

## 变更文件

- `backend/app/core/database.py`
- `backend/app/repositories/audit_scripts.py`
- `backend/app/api/routes/workflow_admin.py`
- `backend/tests/test_audit_scripts_api.py`

## 自审结果

- 迁移通过 `PRAGMA table_info(audit_scripts)` 判断列存在性，重复初始化不会重复加列；迁移 ID
  仅记录一次。
- 版本更新仅写入新版本目录；无覆盖或删除历史版本的路径。
- API 返回的数据来自白名单摘要字段，未暴露 `directoryPath`、`entryFilename`、源代码或绝对路径。
- POST、PUT、DELETE 和模板下载仍受 `get_current_super_admin` 保护；GET 保持教师可读。
- 未读取或加载项目 `.env`，未执行任何审核脚本。
- 未暂存 `docs/05_oa_graph.md`、`AGENTS.md`、既有 `.superpowers/brainstorm/` 或其他无关
  `.superpowers/sdd/` 文件。

## 顾虑

- 测试环境缺少 PATH 中的 `pytest`，已使用仓库 `backend/.venv/bin/pytest` 完成同等验证。
- 全量测试与定向测试各有 1 条来自第三方 `python_multipart` 的既有弃用警告，不影响通过结果。
