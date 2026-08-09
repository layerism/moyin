# 审核脚本模板运行环境实现报告

日期：2026-07-17  
实现范围：`docs/superpowers/plans/2026-07-17-audit-script-template-runtime.md` Tasks 1–6  
Git：当前分支实施；本代理未创建/切换分支、worktree，未暂存或提交文件。

## 1. 实现结果

- Python、JavaScript 模板下载接口改为内存生成 ZIP；固定包含入口脚本、输入示例、输出示例和 README。
- 两种模板使用相同的 `schemaVersion = "1.0"` 多文件 stdin/stdout JSON 协议，并覆盖 `.docx .xlsx .pdf .pptx .jpeg .jpg .png`。
- 模板解析异常按 `fileId` 返回通用结构化问题，不向结果泄漏本地绝对路径或解析器错误详情。
- 前端保存名称和文件选择器 MIME 统一为 `application/zip` / `.zip`，保留原有系统保存与普通下载回退。
- 后端增加 5 类 Python 文档依赖；新增固定 Node Runtime `package.json`、`package-lock.json` 与本地 `node_modules`。
- Dockerfile 增加 Node 24 构建阶段，使用 `npm ci --omit=dev`，最终镜像携带 Node 可执行文件和固定 `NODE_PATH`。
- 新增材料落盘和真实性校验：规范化扩展名、文件 ID/重复 ID、目标路径、实际大小、SHA-256、PDF/PNG/JPEG 文件头、OOXML `[Content_Types].xml` 与 `word/`、`xl/`、`ppt/` 结构。
- 新增 Python/JavaScript 统一 Runner：环境变量白名单、stdin JSON、并行 stdout/stderr 读取、60 秒超时、1 MiB stdout、256 KiB stderr、退出码和输出协议校验。
- Runner 使用每次独立 `TemporaryDirectory`；成功、格式错误、超时、崩溃、输出超限等路径均由测试确认清理。
- 既有 `script_id + version + sha256` 解析器和 super_admin 模板权限边界保持不变。

## 2. 改动文件

### 后端与 Runtime

- `backend/app/services/audit_script_templates.py`
- `backend/app/api/routes/workflow_admin.py`
- `backend/app/core/config.py`
- `backend/app/services/object_storage.py`
- `backend/app/services/audit_script_executor.py`（新增）
- `backend/pyproject.toml`
- `backend/runtime/javascript/package.json`（新增）
- `backend/runtime/javascript/package-lock.json`（新增）
- `backend/Dockerfile`

### 前端

- `frontend/src/features/academic-flow/AuditScriptManagerDialog.tsx`
- `frontend/src/features/academic-flow/auditScriptManager.ts`

### 测试

- `backend/tests/test_audit_scripts_api.py`
- `backend/tests/test_audit_script_runtime.py`
- `backend/tests/test_object_storage.py`
- `frontend/tests/auditScriptManager.test.ts`

## 3. TDD RED/GREEN 记录

| Task | RED 命令与结果 | GREEN 命令与结果 |
|---|---|---|
| 1 ZIP 模板 | `cd backend && .venv/bin/python -m pytest -q tests/test_audit_scripts_api.py -k template`：收集阶段 `ImportError: get_template_archive` | 同命令：`4 passed` |
| 2 前端 ZIP 保存 | `cd frontend && node --experimental-strip-types --test tests/auditScriptManager.test.ts`：期望 `application/zip`，实际 `text/javascript`，`1 failed, 12 passed` | 同命令：`13 passed` |
| 3 Runtime 配置 | `cd backend && .venv/bin/python -m pytest -q tests/test_audit_script_runtime.py tests/test_audit_scripts_api.py -k 'configuration or imports'`：Settings 缺少 `audit_node_executable`，`1 failed` | 同命令：`1 passed, 20 deselected`；另以 Node require 验证六类依赖成功 |
| 4 落盘与真实性 | `cd backend && .venv/bin/python -m pytest -q tests/test_object_storage.py tests/test_audit_script_runtime.py -k 'download_to_file or stage_audit'`：`ModuleNotFoundError: audit_script_executor` | 同命令：`8 passed, 11 deselected` |
| 5 JSON Runner | `cd backend && .venv/bin/python -m pytest -q tests/test_audit_script_runtime.py -k execute_audit_script`：`ImportError: execute_audit_script` | 同命令：`10 passed, 16 deselected` |
| 补充：重复文件 ID | `cd backend && .venv/bin/python -m pytest -q tests/test_audit_script_runtime.py -k duplicate_file_ids`：未抛出异常，`1 failed` | 同命令：`1 passed, 26 deselected` |
| 补充：JS Promise 文件读取 | 模板定向测试断言 `node:fs/promises`：JavaScript 用例失败 | 修正后模板定向测试：`2 passed` |
| 补充：解析错误脱敏 | 模板定向测试断言通用错误消息：Python/JavaScript 两项失败 | 修正后模板定向测试：`2 passed` |

说明：系统 PATH 无全局 `pytest`，因此使用仓库既有 `backend/.venv/bin/python -m pytest`，测试语义不变。

## 4. 依赖安装与验证

### Node

- `cd backend/runtime/javascript && npm install --package-lock-only --cache /private/tmp/codex-npm-cache-doc-autofill`：成功生成 lockfile。
- `cd backend/runtime/javascript && npm ci --omit=dev --cache /private/tmp/codex-npm-cache-doc-autofill`：成功，安装 56 packages。
- `NODE_PATH=... node -e 'require(...)'`：`mammoth/xlsx/pdf-parse/jszip/fast-xml-parser/sharp` 全部 require 成功。
- 保留 `backend/runtime/javascript/node_modules/`，未作为缓存删除。

### Python

- 首次 `cd backend && .venv/bin/python -m pip install -e .` 因 PyMuPDF/lxml 下载速度过慢，超过 5 分钟后按主代理指示中止。
- 后续 `uv --cache-dir /private/tmp/codex-uv-cache-doc-autofill pip install --python .venv/bin/python -e .` 成功；安装 `python-docx 1.2.0`、`openpyxl 3.1.5`、`PyMuPDF 1.28.0`、`python-pptx 1.0.2`、`Pillow 12.3.0` 及传递依赖。
- `.venv/bin/python -c 'import fitz, openpyxl, docx, PIL, pptx'`：`python-runtime-ok`。
- Python 模板 `ast.parse` 成功；JavaScript 模板 `node --check -` 成功。

## 5. 全量验证

- 后端：`cd backend && .venv/bin/python -m pytest -q` → `118 passed, 1 warning in 7.07s`。
- 前端：`cd frontend && node --experimental-strip-types --test tests/*.test.ts` → `63 passed`。
- 前端构建：`cd frontend && npm run build` → Vite 成功，108 modules transformed。
- Python 静态检查：`ruff check` → `All checks passed`。
- 格式检查：相关 Python 文件已使用 `ruff format`；`git diff --check` 无错误。
- 缓存：已删除 `backend/.pytest_cache/`、全部 `backend/**/__pycache__/`、全部 `backend/**/*.egg-info/`；保留 Node Runtime `node_modules/`。

## 6. 未完成项与风险

1. **服务重启与浏览器交互验证未执行**：检查时 `127.0.0.1:8000` 与 `127.0.0.1:5173` 均未监听（curl HTTP code `000`）。根据主代理安排，本代理不启动或抢占服务；需由主代理重启后完成 `/academic-flow` 两个 ZIP 按钮交互检查。
2. **Docker 镜像未实际构建**：Dockerfile 已更新，但本代理未执行 `docker build`；需由主代理或 CI 验证最终镜像内 Node 动态库兼容性与两类 Runtime imports。
3. **`xlsx@0.18.5` 上游安全风险**：`npm audit --omit=dev --json` 报 1 个 high，涉及 prototype pollution 与 ReDoS，`fixAvailable=false`。这是计划指定 npm 包在官方 npm registry 当前无修复版本的风险；运行时已有超时和进程边界，但建议后续评估 SheetJS 官方 tarball/商业版或替代解析器。
4. **既有 warning**：后端测试有 1 条 Starlette `python_multipart` PendingDeprecationWarning，与本次实现无关，不影响通过状态。
5. 本期仍是受信超级管理员脚本的进程级限制，不提供容器级强隔离或操作系统级断网；与设计非目标一致。

## 7. 范围与清理确认

- 未修改或暂存现有无关改动：`AGENTS.md`、`docs/05_oa_graph.md`、`.superpowers/brainstorm/` 与既有 `.superpowers/sdd/` 文件。
- 本报告是任务明确要求的新文件。
- 未执行 Git commit；最终唯一实现提交留给主代理。
