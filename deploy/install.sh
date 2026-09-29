#!/usr/bin/env bash
set -euo pipefail

UV_VERSION="0.11.25"
PYTHON_VERSION="3.11.15"
NODE_VERSION="24.18.0"
NPM_VERSION="11.16.0"
PYTHON_INDEX="https://mirrors.aliyun.com/pypi/simple"
NPM_REGISTRY="https://registry.npmmirror.com"

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
export PATH="$PWD/.local/node/bin:$PWD/.local/bin:$PATH"
export UV_PYTHON_INSTALL_DIR="$PWD/.local/python"
export UV_PYTHON_BIN_DIR="$PWD/.local/bin"
export UV_CACHE_DIR="$PWD/.local/uv-cache"

if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  echo "仅支持 Linux x86_64。" >&2
  exit 1
fi

PRIVILEGED=()
if [[ "$EUID" -ne 0 ]]; then
  PRIVILEGED=(sudo)
fi
"${PRIVILEGED[@]}" apt-get update
"${PRIVILEGED[@]}" apt-get install -y curl ca-certificates xz-utils libreoffice-writer fonts-noto-cjk

mkdir -p .local/bin .local/node .local/python .local/uv-cache

UV_EXECUTABLE="$PWD/.local/bin/uv"
if [[ ! -x "$UV_EXECUTABLE" ]] || [[ "$($UV_EXECUTABLE --version 2>/dev/null || true)" != "uv $UV_VERSION"* ]]; then
  curl -LsSf "https://astral.sh/uv/$UV_VERSION/install.sh" \
    | env UV_UNMANAGED_INSTALL="$PWD/.local/bin" sh
fi

[[ "$($UV_EXECUTABLE --version)" == "uv $UV_VERSION"* ]]

if [[ "$(.local/node/bin/node --version 2>/dev/null || true)" != "v$NODE_VERSION" ]] \
  || [[ "$(.local/node/bin/npm --version 2>/dev/null || true)" != "$NPM_VERSION" ]]; then
  INSTALL_TMP="$(mktemp -d .local/install.XXXXXX)"
  ARCHIVE="node-v$NODE_VERSION-linux-x64.tar.xz"
  curl --fail --location --output "$INSTALL_TMP/$ARCHIVE" \
    "https://nodejs.org/dist/v$NODE_VERSION/$ARCHIVE"
  curl --fail --location --output "$INSTALL_TMP/SHASUMS256.txt" \
    "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
  (
    cd "$INSTALL_TMP"
    grep " $ARCHIVE\$" SHASUMS256.txt | sha256sum --check
  )
  mkdir -p "$INSTALL_TMP/node"
  tar --extract --file="$INSTALL_TMP/$ARCHIVE" --strip-components=1 \
    --directory="$INSTALL_TMP/node"
  rm -rf .local/node
  mv "$INSTALL_TMP/node" .local/node
  rm -rf "$INSTALL_TMP"
fi

[[ "$(node --version)" == "v$NODE_VERSION" ]]
[[ "$(npm --version)" == "$NPM_VERSION" ]]

"$UV_EXECUTABLE" python install "$PYTHON_VERSION" --managed-python

VENV_PYTHON="$PWD/backend/.venv/bin/python"
if [[ "$($VENV_PYTHON --version 2>/dev/null || true)" != "Python $PYTHON_VERSION" ]] \
  || ! grep -Fq "home = $UV_PYTHON_INSTALL_DIR/" backend/.venv/pyvenv.cfg; then
  "$UV_EXECUTABLE" venv --clear --python "$PYTHON_VERSION" --managed-python backend/.venv
fi
[[ "$($VENV_PYTHON --version)" == "Python $PYTHON_VERSION" ]]

"$UV_EXECUTABLE" pip install \
  --python "$VENV_PYTHON" \
  --index-url "$PYTHON_INDEX" \
  --editable "backend[dev]"

npm --prefix frontend ci --registry="$NPM_REGISTRY"
npm --prefix backend/runtime/javascript ci --registry="$NPM_REGISTRY"

[[ -f backend/.env ]] || cp backend/.env.example backend/.env

"$UV_EXECUTABLE" pip check --python "$VENV_PYTHON"
npm --prefix frontend ls --depth=0
npm --prefix backend/runtime/javascript ls --depth=0

echo "依赖安装完成。首次启动前请替换 backend/.env 中的示例管理员，并配置 OSS 和模型加密主密钥，见 INSTALL.md。"
echo "本地开发：bash deploy/run_dev.sh"
echo "正式部署：bash deploy/run_server.sh，完整步骤见 deploy/README.md"
