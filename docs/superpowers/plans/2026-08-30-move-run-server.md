# 启动脚本迁移计划

## 目标

将根目录 `start_server.sh` 移动并改名为 `deploy/run_server.sh`，统一所有面向用户的启动命令，同时保持前后端启动参数和协同退出行为不变。

## 变更范围

1. 新脚本从 `deploy/` 的上一级解析项目根目录，并将项目本地 Node.js 与 uv 路径加入 `PATH`。
2. 删除根目录旧脚本，不保留软链接或兼容包装器。
3. 更新 `README.md`、`INSTALL.md`、`deploy/INSTALL_DESIGN.md` 和 `deploy/INSTALL_PLAN.md` 中的脚本名称与路径。
4. 不修改 Docker Compose、Nginx、数据库结构或业务源码。

## 静态核对

- 使用 `bash -n deploy/run_server.sh` 检查 Shell 语法。
- 搜索并消除面向用户的 `start_server.sh` 旧引用。
- 使用 `git diff --check` 检查补丁格式。
- 按项目规范不运行测试；完成后使用新脚本重启本地服务并核对 5173、8000 端口监听。
