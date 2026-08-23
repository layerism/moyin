# DOCX 审核切换 DeepSeek 实施计划

**目标：** 将通用 DOCX LLM 审核脚本切换为 DeepSeek，并通过后端 `.env` 安全提供 API 地址和密钥。

## 改动范围

- `backend/scripts/docx-markdown-completion-audit/config.json`
  - 默认模型改为 `deepseek-chat`。
- `backend/scripts/docx-markdown-completion-audit/handler.py`
  - 只从环境读取 `DEEPSEEK_API_URL` 和 `DEEPSEEK_API_KEY`。
- `backend/app/core/config.py`、`backend/.env.example`
  - 默认审核脚本环境变量白名单包含 `DEEPSEEK_API_URL` 和 `DEEPSEEK_API_KEY`。
- `backend/.env`
  - 写入本地 DeepSeek API 地址、密钥和对应白名单；该文件被 Git 忽略，不提交。

## 约束与验证

- 不在源码、示例文件、提交或日志中保存真实密钥。
- 不改变现有单次 LLM 请求、结构化结果及 `audit_error` 逻辑。
- 不运行测试或浏览器；只做静态语法、配置、差异和环境变量存在性检查。
- 结果提交后只重启后端，并核对 8000 端口和工作目录；前端无改动，不重启。
