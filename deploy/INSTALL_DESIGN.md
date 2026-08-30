# 项目本地安装器设计

## 目标

提供面向 Linux x86_64 的单入口安装脚本 `deploy/install.sh`。用户在任意工作目录执行：

```bash
bash /path/to/moyin/deploy/install.sh
```

即可将项目所需的 uv、Python、Node.js、npm 和应用依赖安装到仓库内部。安装完成后不自动启动服务，由用户显式运行：

```bash
./deploy/run_server.sh
```

## 固定版本与安装位置

| 组件 | 固定版本 | 安装位置 |
| --- | --- | --- |
| uv | 0.11.25 | `.local/bin/uv` |
| Python | 3.11.15 | `.local/python/` |
| Node.js | 24.18.0 | `.local/node/` |
| npm | 11.16.0 | `.local/node/` 随 Node.js 安装 |
| Python 虚拟环境 | Python 3.11.15 | `backend/.venv/` |
| 前端依赖 | `package-lock.json` | `frontend/node_modules/` |
| JavaScript 审核依赖 | `package-lock.json` | `backend/runtime/javascript/node_modules/` |

项目不依赖系统 Python、Node.js、npm 或全局 Python 包，也不修改用户 Shell 配置。

## 安装流程

1. 根据 `deploy/install.sh` 自身路径定位项目根目录，不依赖调用者当前目录。
2. 检查操作系统为 Linux、CPU 架构为 x86_64，并检查 `bash`、`curl`、`tar`、`grep`、`sha256sum` 等基础命令。
3. 创建 `.local/bin`、`.local/node`、`.local/python` 和 `.local/uv-cache`。
4. 检查项目本地 uv 是否为 0.11.25；缺失或版本不符时，通过固定官方安装链接安装到 `.local/bin`。
5. 检查项目本地 Node.js 和 npm 是否分别为 24.18.0、11.16.0；版本不符时下载 Linux x64 官方发行包和校验清单，SHA-256 校验成功后再替换 `.local/node`。
6. 将 `.local/node/bin` 和 `.local/bin` 放到当前脚本的 `PATH` 首位，并把 uv 的 Python 安装目录、命令目录和缓存目录固定到 `.local/`。
7. 使用 uv 安装 Python 3.11.15。只有当 `backend/.venv` 的版本或解释器来源不符合项目本地 Python 时，才清理并重建虚拟环境。
8. 使用阿里云 PyPI 镜像执行线性的 `uv pip install`，从 `backend/pyproject.toml` 安装后端及开发依赖。
9. 使用 npmmirror 和现有锁文件分别对 `frontend/`、`backend/runtime/javascript/` 执行 `npm ci`。
10. 当 `backend/.env` 不存在时，从 `.env.example` 复制；已存在时不覆盖。密钥为空不阻断安装，只在结尾提示配置。
11. 检查固定运行时版本、Python 包依赖一致性和两个 npm 依赖树。全部成功后打印手动启动命令，不启动进程。

## 幂等与替换规则

- 固定版本正确的 uv、Python、Node.js 和 npm 直接复用。
- Node.js 先下载到项目 `.local/` 下的临时目录并完成校验，再替换不匹配的运行时，避免将未校验文件作为正式运行时。
- `backend/.venv` 只有在 Python 版本不符、解释器失效或不指向项目 `.local/python` 时才重建。
- `npm ci` 以锁文件为准同步依赖；不进行全局 npm 安装。
- 安装器不删除数据库、备份、环境变量文件或业务数据。

## 启动脚本迁移

根目录 `start_server.sh` 移至 `deploy/run_server.sh`。新脚本从自身目录的上一级解析项目根目录，并在启动前统一设置：

```bash
PATH="$project_dir/.local/node/bin:$project_dir/.local/bin:$PATH"
```

该设置同时供前端 npm 和后端 JavaScript 审核子进程使用。服务边界保持不变：

- 后端从 `backend/` 启动，监听 `127.0.0.1:8000`，数据库解析为 `backend/storage/app.db`。
- 前端从 `frontend/` 启动，监听 `0.0.0.0:5173`，通过 Vite 代理访问 `/api`。
- 保留开发模式的 `--reload` 和现有前后端协同退出逻辑。

## 文件范围

- 新增 `deploy/install.sh`。
- 新增 `deploy/run_server.sh`，删除根目录 `start_server.sh`。
- 更新 `README.md` 和 `INSTALL.md` 中的安装、启动路径与行为说明。
- 不修改 Docker Compose、Nginx、数据库结构或业务源码。

## 错误处理

- 使用严格 Bash 模式，任一步失败立即退出。
- 平台不支持、基础命令缺失、下载失败、SHA-256 校验失败、依赖安装失败和版本校验失败均给出明确阶段信息。
- 不捕获并掩盖安装命令的原始错误码。
- 安装失败时不自动启动服务。

## 验证边界

依照项目规范，实施过程中不运行测试、前端构建或浏览器自动化，也不实际重装当前项目运行时。通过 Shell 语法检查、固定版本与路径审计、安装命令参数审计、Git 差异检查和现有服务进程级核验确认改动范围；交付时明确说明未执行真实全新机器安装。
