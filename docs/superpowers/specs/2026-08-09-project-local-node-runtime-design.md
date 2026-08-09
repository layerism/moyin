# 项目本地 Node.js 运行时设计

## 目标

为当前 Linux x86_64 工作区提供不依赖系统权限的固定 Node.js 与 npm 运行时，并确保后续自动化操作统一使用该运行时。

## 版本依据

- 前端使用 Vite 5 与 TypeScript 5.6。
- JavaScript 审核运行时依赖 `sharp 0.35.3`，其平台包要求 Node.js `>=20.9.0`。
- 固定采用当前 Node.js 24 LTS 的 `24.18.0`，并使用官方发行包自带的 npm `11.16.0`。

## 安装设计

- 使用 Node.js 官方 Linux x64 预编译发行包，直接解压到项目根目录 `.local/node`。
- 不安装 nvm，不修改系统 Node.js，不要求 root 权限。
- `.local` 仅保存当前工作区的平台相关二进制文件，不提交到 Git。
- 后续命令先执行：

  ```bash
  export PATH="$PWD/.local/node/bin:$PATH"
  ```

## 仓库约定

在根目录 `AGENTS.md` 中明确固定版本、安装位置与 PATH 规则。所有 Node.js、npm 和 npx 命令必须使用 `.local/node/bin` 中的工具，不得隐式依赖系统安装。

## 边界与失败处理

- 仅支持当前工作区的 Linux x86_64 环境；其他平台需要重新选择对应官方发行包。
- 下载、解压或版本检查失败时立即停止，不回退到系统 Node.js。
- 不安装项目依赖，不修改两个现有 `package-lock.json`。
- 不改动或提交当前工作区中与本任务无关的 `memory.md`、`.gitignore` 和 `outputs/pets/shuibao` 变更。

## 验收

- `.local/node/bin/node --version` 输出 `v24.18.0`。
- `PATH` 指向本地目录后，`npm --version` 输出 `11.16.0`。
- `command -v node` 与 `command -v npm` 均解析到项目 `.local/node/bin`。
- 按项目约定不运行测试或浏览器，仅进行安装结果检查和业务逻辑审计。
