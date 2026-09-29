#!/usr/bin/env bash
set -euo pipefail

uv_version="0.11.25"
python_version="3.11.15"
node_version="24.18.0"
npm_version="11.16.0"
python_index="https://mirrors.aliyun.com/pypi/simple"
npm_registry="https://registry.npmmirror.com"

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
export PATH="$PWD/.local/node/bin:$PWD/.local/bin:$PATH"
export UV_PYTHON_INSTALL_DIR="$PWD/.local/python"
export UV_PYTHON_BIN_DIR="$PWD/.local/bin"
export UV_CACHE_DIR="$PWD/.local/uv-cache"

if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  echo "仅支持 Linux x86_64。" >&2
  exit 1
fi

privileged=()
if [[ "$EUID" -ne 0 ]]; then
  privileged=(sudo)
fi
"${privileged[@]}" apt-get update
"${privileged[@]}" apt-get install -y curl ca-certificates xz-utils libreoffice-writer fonts-noto-cjk

mkdir -p .local/bin .local/node .local/python .local/uv-cache

uv_executable="$PWD/.local/bin/uv"
if [[ ! -x "$uv_executable" ]] || [[ "$($uv_executable --version 2>/dev/null || true)" != "uv $uv_version"* ]]; then
  curl -LsSf "https://astral.sh/uv/$uv_version/install.sh" \
    | env UV_UNMANAGED_INSTALL="$PWD/.local/bin" sh
fi

[[ "$($uv_executable --version)" == "uv $uv_version"* ]]

if [[ "$(.local/node/bin/node --version 2>/dev/null || true)" != "v$node_version" ]] \
  || [[ "$(.local/node/bin/npm --version 2>/dev/null || true)" != "$npm_version" ]]; then
  install_tmp="$(mktemp -d .local/install.XXXXXX)"
  archive="node-v$node_version-linux-x64.tar.xz"
  curl --fail --location --output "$install_tmp/$archive" \
    "https://nodejs.org/dist/v$node_version/$archive"
  curl --fail --location --output "$install_tmp/SHASUMS256.txt" \
    "https://nodejs.org/dist/v$node_version/SHASUMS256.txt"
  (
    cd "$install_tmp"
    grep " $archive\$" SHASUMS256.txt | sha256sum --check
  )
  mkdir -p "$install_tmp/node"
  tar --extract --file="$install_tmp/$archive" --strip-components=1 \
    --directory="$install_tmp/node"
  rm -rf .local/node
  mv "$install_tmp/node" .local/node
  rm -rf "$install_tmp"
fi

[[ "$(node --version)" == "v$node_version" ]]
[[ "$(npm --version)" == "$npm_version" ]]

"$uv_executable" python install "$python_version" --managed-python

venv_python="$PWD/backend/.venv/bin/python"
if [[ "$($venv_python --version 2>/dev/null || true)" != "Python $python_version" ]] \
  || ! grep -Fq "home = $UV_PYTHON_INSTALL_DIR/" backend/.venv/pyvenv.cfg; then
  "$uv_executable" venv --clear --python "$python_version" --managed-python backend/.venv
fi
[[ "$($venv_python --version)" == "Python $python_version" ]]

"$uv_executable" pip install \
  --python "$venv_python" \
  --index-url "$python_index" \
  --editable "backend[dev]"

npm --prefix frontend ci --registry="$npm_registry"
npm --prefix backend/runtime/javascript ci --registry="$npm_registry"

[[ -f backend/.env ]] || cp backend/.env.example backend/.env

"$uv_executable" pip check --python "$venv_python"
npm --prefix frontend ls --depth=0
npm --prefix backend/runtime/javascript ls --depth=0

echo "依赖安装完成。首次启动前请替换 backend/.env 中的示例管理员，并配置 OSS 和模型加密主密钥，见 INSTALL.md。"
echo "本地开发：bash deploy/run_dev.sh"
echo "正式部署：bash deploy/run_server.sh，完整步骤见 deploy/README.md"
