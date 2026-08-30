# 安装说明

本文适用于 Linux x86_64。Node.js、npm、uv 和 Python 解释器安装在项目根目录；Python 虚拟环境沿用后端现有目录 `backend/.venv`。项目不依赖系统 Node.js、npm 或 Python。

## 1. 安装目录

安装完成后的主要目录如下：

```text
moyin/
├── .local/
│   ├── bin/                 # uv 和 uv 管理的 Python 命令
│   ├── node/                # Node.js 24.18.0 与 npm 11.16.0
│   ├── python/              # Python 3.11.15 解释器
│   └── uv-cache/            # uv 下载缓存
├── frontend/node_modules/  # 前端依赖
└── backend/
    ├── .venv/               # 后端 Python 虚拟环境
    └── runtime/javascript/node_modules/  # JavaScript 审核依赖
```

`backend/.venv` 与后端源码位于同一目录，符合当前项目的实际布局。`node_modules` 必须位于对应 `package.json` 附近，以满足 Node.js 模块解析规则。

## 2. 系统前置条件

宿主机只需提供以下基础命令：

```bash
bash
curl
tar
sha256sum
```

以下命令均从项目根目录执行：

```bash
cd /path/to/moyin
mkdir -p .local/bin .local/node .local/python .local/uv-cache
```

## 3. 安装项目本地 uv

固定安装 uv `0.11.25`，不修改用户 Shell 配置：

```bash
curl -LsSf https://astral.sh/uv/0.11.25/install.sh | env UV_UNMANAGED_INSTALL="$PWD/.local/bin" sh
.local/bin/uv --version
```

期望输出：

```text
uv 0.11.25
```

## 4. 安装项目本地 Node.js 与 npm

下载 Node.js `24.18.0` 官方 Linux x64 发行包和校验清单：

```bash
curl --fail --location --output .local/node-v24.18.0-linux-x64.tar.xz https://nodejs.org/dist/v24.18.0/node-v24.18.0-linux-x64.tar.xz
curl --fail --location --output .local/node-v24.18.0-SHASUMS256.txt https://nodejs.org/dist/v24.18.0/SHASUMS256.txt
```

校验下载文件：

```bash
cd .local
grep ' node-v24.18.0-linux-x64.tar.xz$' node-v24.18.0-SHASUMS256.txt | sha256sum --check
cd ..
```

期望输出：

```text
node-v24.18.0-linux-x64.tar.xz: OK
```

解压到项目根目录 `.local/node`：

```bash
tar --extract --file=.local/node-v24.18.0-linux-x64.tar.xz --strip-components=1 --directory=.local/node
export PATH="$PWD/.local/node/bin:$PWD/.local/bin:$PATH"
node --version
npm --version
```

期望输出：

```text
v24.18.0
11.16.0
```

## 5. 安装项目本地 Python

固定安装 Python `3.11.15`，并将解释器、命令入口和缓存限制在项目根目录：

```bash
export PATH="$PWD/.local/bin:$PWD/.local/node/bin:$PATH"
export UV_PYTHON_INSTALL_DIR="$PWD/.local/python"
export UV_PYTHON_BIN_DIR="$PWD/.local/bin"
export UV_CACHE_DIR="$PWD/.local/uv-cache"
.local/bin/uv python install 3.11.15 --install-dir "$PWD/.local/python" --managed-python
.local/bin/uv venv --python 3.11.15 --managed-python backend/.venv
```

检查解释器位置和版本：

```bash
.local/bin/uv python dir
.local/bin/python3.11 --version
backend/.venv/bin/python --version
```

期望 Python 安装目录为项目根目录下的 `.local/python`，版本输出为：

```text
Python 3.11.15
```

## 6. 安装 Python 依赖

使用 `backend/.venv`，并通过阿里云 PyPI 镜像安装后端及开发依赖：

```bash
.local/bin/uv pip install --python "$PWD/backend/.venv/bin/python" --index-url https://mirrors.aliyun.com/pypi/simple --editable "backend[dev]"
```

该命令以 `backend/pyproject.toml` 为唯一依赖清单，不向系统 Python 写入任何包。

## 7. 安装 npm 依赖

使用项目本地 npm 和锁文件安装前端依赖：

```bash
export PATH="$PWD/.local/node/bin:$PWD/.local/bin:$PATH"
npm --prefix frontend ci --registry=https://registry.npmmirror.com
```

安装 JavaScript 审核运行时依赖：

```bash
npm --prefix backend/runtime/javascript ci --registry=https://registry.npmmirror.com
```

两条命令均使用现有 `package-lock.json`，不会全局安装 npm 包。

## 8. 配置后端环境变量

首次安装时创建本地配置：

```bash
cp backend/.env.example backend/.env
```

按实际环境填写 `backend/.env` 中的 OSS 配置：

```text
OSS_ENDPOINT=
OSS_BUCKET=
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
```

`backend/.env` 包含本地密钥，不得提交到 Git。

## 9. 启动服务

后端从 `backend/` 目录启动，并使用同目录下的 `.venv`：

```bash
cd backend
./.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

另开终端，从 `frontend/` 启动前端，并将项目本地 Node.js 放在 PATH 首位：

```bash
cd frontend
export PATH="$PWD/../.local/node/bin:$PATH"
npm run dev
```

默认端口：

- 前端：`5173`
- 后端：`8000`

## 10. 每次打开新终端

在项目根目录执行：

```bash
export PATH="$PWD/.local/bin:$PWD/.local/node/bin:$PATH"
export UV_PYTHON_INSTALL_DIR="$PWD/.local/python"
export UV_PYTHON_BIN_DIR="$PWD/.local/bin"
export UV_CACHE_DIR="$PWD/.local/uv-cache"
```

随后可直接使用项目本地的 `uv`、`python3.11`、`node` 和 `npm`；后端 Python 命令位于 `backend/.venv/bin/`。
