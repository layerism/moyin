# 开发须知

## Node.js 与 npm
- 项目固定使用 `.local/node` 中的 Node.js `24.18.0` 与 npm `11.16.0`，不得依赖系统安装。
- 执行 Node.js、npm 或 npx 命令前，必须先在项目根目录运行 `export PATH="$PWD/.local/node/bin:$PATH"`。

- 自动使用 superpowers，build-web-app，Ponytail 插件
- 实现用户需求前，先做逻辑检查，补全缺失的逻辑，避免用户思维不健壮导致的开发冲突
- 用户没有特殊指定，请在当前分支完成开发或修改，执行前 commit 一版检查点，完成后 commit 新的检查点，中间不要 commit
- 只能启动一个 subagent 执行开发或修改任务
- 完成需求开发或修改后，自动重启服务，不要使用 docker 启动，本地运行方式启动
- 小的改动不要写文档，直接列出计划，用户确认后直接修改

# 开发清理
- 开发结束后，自动清理 pytest_cache ，pycache，*.egg-info 等中间缓存

# 开发文档
- 每次开发前，都要通过 superpowers 能力询问并掌握用户的确切需求和逻辑，然后整理一份开发文档到 docs/superpowers 当中

# 开发时测试
- 开发或者修改过程不要测试，不要使用 browser 插件，只需要做业务逻辑层面的审计
