# 项目开发规范

## 任务分级

- 每次任务开始时，必须先查阅根目录 `MEMORY.md`，并在分析与执行中引用其中与当前任务相关的项目事实和约束。
- 用户明确要求记住的长期偏好，必须写入根目录 `MEMORY.md`。
- 只有涉及源代码、业务逻辑、接口、数据结构或运行行为的变更，才按代码功能改动流程处理。
- 纯文档编写、排版或措辞调整直接完成；默认不使用 Superpowers、build-web-app、Ponytail 等插件，不编写 `docs/superpowers` 文档，不启动 subagent，不创建检查点提交，也不重启服务。
- 文档任务如果同时要求改变代码功能或运行行为，按代码功能改动流程处理。

## 代码功能改动流程

- 按任务需要使用 Superpowers、build-web-app 和 Ponytail 插件，不为无关能力增加流程。
- 实现前先检查并补全业务逻辑，避免因需求逻辑不完整产生开发冲突。
- 小改动先列出实施计划，用户确认后再修改。
- 通过 Superpowers 明确用户需求和业务逻辑，并将开发文档整理到 `docs/superpowers`。
- 用户未特别指定时，在当前分支完成修改。
- 实施前提交一次检查点，完成后再提交一次检查点，中间不提交。
- 每项任务最多启动一个 subagent。
- 修改过程中不运行测试、不使用浏览器插件，仅进行业务逻辑审计。
- 完成后以本地方式重启服务，不使用 Docker。
- 结束后清理 `.pytest_cache`、`__pycache__` 和 `*.egg-info` 等中间缓存。

## Node.js 运行环境

- 项目固定使用 `.local/node` 中的 Node.js `24.18.0` 与 npm `11.16.0`，不得依赖系统安装。
- 执行 Node.js、npm 或 npx 命令前，必须先在项目根目录运行 `export PATH="$PWD/.local/node/bin:$PATH"`。

## 开发环境启动

- 开发阶段统一在项目根目录执行 `bash deploy/run_dev.sh` 启动前后端，不使用 `deploy/run_server.sh`，也不手工分别启动 Uvicorn 和 Vite。
- `deploy/run_dev.sh` 负责使用项目内 Node.js，在 `backend/` 启动后端 `127.0.0.1:9000`，并在 `frontend/` 启动前端 `6173`；通过 `VITE_API_PROXY_TARGET` 将前端 `/api` 请求代理到开发后端。
