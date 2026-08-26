# DOCX 审核 DeepSeek 环境配置实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 将通用 DOCX LLM 审核脚本使用的模型名称从脚本运行配置迁移到后端 `.env`，统一通过 `DEEPSEEK_MODEL`、`DEEPSEEK_API_URL` 和 `DEEPSEEK_API_KEY` 提供 DeepSeek 调用配置。

**架构：** DOCX 审核脚本继续保持独立进程执行，但模型名称不再暴露为教师可编辑的运行设置。后端审核脚本执行器通过既有环境变量白名单把 `DEEPSEEK_MODEL` 注入脚本；脚本严格校验模型配置存在后再构造请求。

**技术栈：** Python 3.11、后端 `.env`、现有 `urllib.request` OpenAI 兼容请求。

## 改动范围

- `backend/scripts/docx-markdown-completion-audit/config.json`
  - 删除 `modelName` 运行设置；保留现有思考、温度、超时和输入限制。
- `backend/scripts/docx-markdown-completion-audit/handler.py`
  - 从环境读取 `DEEPSEEK_MODEL`、`DEEPSEEK_API_URL` 和 `DEEPSEEK_API_KEY`。
  - `scriptSettings` 不再接受 `modelName`，请求体模型字段使用环境中的 `DEEPSEEK_MODEL`。
- `backend/app/core/config.py`、`backend/.env.example`
  - 增加 `deepseek_model` 设置。
  - 默认审核脚本环境变量白名单包含 `DEEPSEEK_MODEL`、`DEEPSEEK_API_URL` 和 `DEEPSEEK_API_KEY`。
- `backend/.env`
  - 增加 `DEEPSEEK_MODEL=deepseek-v4-flash`，并把它加入本地审核脚本环境变量白名单；该文件被 Git 忽略，不提交。
- `backend/tests/test_docx_markdown_completion_audit.py`
  - 测试设置中删除 `modelName`，请求测试通过环境变量提供模型名称。
  - 补充模型环境变量缺失时拒绝请求的行为覆盖。

## 实施步骤

- [x] 先调整测试输入和请求行为断言，使其描述 `DEEPSEEK_MODEL` 环境契约。
- [x] 从 DOCX 审核脚本配置及设置校验中删除 `modelName`。
- [x] 让请求函数校验并读取 `DEEPSEEK_MODEL`，不提供回退模型。
- [x] 更新后端设置、示例环境文件和本地环境文件的白名单。
- [x] 静态检查测试、脚本配置、环境变量传递和差异，不执行测试或浏览器检查。
- [x] 创建结果检查点，仅提交本任务跟踪文件；本地重启后端并核对 8000 端口。

## 约束与验证

- 不在源码、示例文件、提交或日志中保存真实密钥。
- 不改变现有单次 LLM 请求、结构化结果及 `audit_error` 逻辑。
- 不修改视觉审核的 `VISION_API_*` 模型配置。
- 不实现或接入答题卡填空答案判断模块。
- 不运行测试或浏览器；只做静态语法、配置、差异和环境变量存在性检查。
- 结果提交后只重启后端，并核对 8000 端口和工作目录；前端无改动，不重启。
