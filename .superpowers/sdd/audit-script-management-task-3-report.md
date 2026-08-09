# Task 3 报告：固定版本运行时解析入口

## 实现

- 新增 `backend/app/services/audit_script_runtime.py`：
  - 定义不可变 `AuditScriptRuntimeDescriptor`，包含脚本 ID、版本、语言、入口路径和 SHA-256。
  - 新增 `resolve_audit_script_version(script_id, version, expected_sha256)`，从 `audit_script_versions` 联结 `audit_scripts` 查询固定版本。
  - 先比对节点保存的预期哈希与数据库版本哈希；随后使用 `Path.resolve()` 和 `is_relative_to()` 约束版本目录及入口文件都位于 `settings.audit_scripts_root` 下。
  - 验证入口文件存在并以流式 SHA-256 复算其磁盘内容；所有解析失败统一抛出不含文件路径的 `AuditScriptResolutionError`。
  - 服务只查询元数据和读取目标脚本计算哈希，不执行脚本，未读取 `.env`。
- 新增 `backend/tests/test_audit_script_runtime.py`：覆盖固定版本解析、节点哈希不符、数据库版本缺失、入口路径逃逸根目录、入口文件缺失及磁盘内容被篡改。

## TDD 记录

### RED

```bash
cd backend && PYTHONPATH=. ./.venv/bin/pytest -q tests/test_audit_script_runtime.py
```

关键输出：

```text
ModuleNotFoundError: No module named 'app.services.audit_script_runtime'
1 error in 0.27s
```

初次按 brief 直接运行 `pytest` 时，shell 返回 `command not found: pytest`；项目虚拟环境中的标准运行方式为 `PYTHONPATH=. ./.venv/bin/pytest`，因此切换为该命令取得上述预期 RED。

### GREEN

```bash
cd backend && PYTHONPATH=. ./.venv/bin/pytest -q tests/test_audit_script_runtime.py
cd backend && ./.venv/bin/ruff check app/services/audit_script_runtime.py tests/test_audit_script_runtime.py
```

关键输出：

```text
6 passed, 1 warning in 0.26s
All checks passed!
```

## 回归与完整验证

```bash
cd backend && PYTHONPATH=. ./.venv/bin/pytest -q tests/test_audit_scripts_api.py tests/test_audit_script_runtime.py
cd backend && PYTHONPATH=. ./.venv/bin/pytest -q
cd backend && ./.venv/bin/ruff check app tests
git diff --check
```

关键输出：

```text
14 passed, 1 warning in 0.75s
92 passed, 1 warning in 5.88s
All checks passed!
```

唯一警告来自既有依赖 `starlette.formparsers` 对 `python_multipart` 的 PendingDeprecationWarning，与本任务无关。

## 文件

- 已提交：`backend/app/services/audit_script_runtime.py`
- 已提交：`backend/tests/test_audit_script_runtime.py`
- 未提交交付报告：`.superpowers/sdd/audit-script-management-task-3-report.md`

## 自审

- 固定版本查询不依赖 `current_version`，因此不会意外解析后续上传版本。
- 数据库记录中的目录与入口名均在解析后进行根目录约束，能够防止 `..` 与符号链接逃逸。
- 输出描述符仅包含未来执行器所需的固定版本定位信息；未新增 API、目录字段或执行功能。
- 错误消息恒为通用文本，不包含配置根目录、数据库目录或入口绝对路径。

## 顾虑

无功能性顾虑。工作区存在用户既有未提交改动；本任务提交仅包含上述两个后端任务文件，未触碰这些改动。

## 审查修复（数据库与文件系统异常边界）

审查发现解析入口可能让 `sqlite3.Error` 或文件系统 `OSError` 原样逸出，并在异常文本中泄漏绝对路径。已在 `resolve_audit_script_version` 的入口边界中：

- 显式保留已判定的 `AuditScriptResolutionError`；
- 将 `sqlite3.Error`、`OSError` 和路径解析相关 `ValueError` 统一改写为固定通用文本的 `AuditScriptResolutionError`，并使用 `from None` 抑制原始异常链；
- 新增读取阶段失败回归测试，模拟先通过 `is_file()`、后在 `Path.open()` 发生携带绝对路径的 `OSError`；
- 新增 SQLite `OperationalError` 回归测试，模拟查询入口失败；两项均验证异常文本不包含路径。

### 修复 TDD 与验证

```bash
cd backend && PYTHONPATH=. ./.venv/bin/pytest -q tests/test_audit_script_runtime.py
```

修复前关键输出：

```text
OSError: cannot read /private/var/.../scripts/global/.../handler.py
1 failed, 6 passed, 1 warning in 0.28s
```

修复后执行：

```bash
cd backend && PYTHONPATH=. ./.venv/bin/pytest -q tests/test_audit_script_runtime.py
cd backend && ./.venv/bin/ruff check app/services/audit_script_runtime.py tests/test_audit_script_runtime.py
```

关键输出：

```text
8 passed, 1 warning in 0.23s
All checks passed!
```
