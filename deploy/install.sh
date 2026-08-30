#!/usr/bin/env bash
set -euo pipefail

uv_version="0.11.25"
python_version="3.11.15"
node_version="24.18.0"
npm_version="11.16.0"
python_index="https://mirrors.aliyun.com/pypi/simple"
npm_registry="https://registry.npmmirror.com"

deploy_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "$deploy_dir/.." && pwd)"
local_dir="$project_dir/.local"
local_bin="$local_dir/bin"
node_dir="$local_dir/node"
python_dir="$local_dir/python"
uv_cache_dir="$local_dir/uv-cache"
backend_dir="$project_dir/backend"
frontend_dir="$project_dir/frontend"
audit_runtime_dir="$backend_dir/runtime/javascript"

if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  echo "仅支持 Linux x86_64。" >&2
  exit 1
fi

for command in curl tar grep sha256sum mktemp; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "缺少基础命令：$command" >&2
    exit 1
  fi
done

mkdir -p "$local_bin" "$node_dir" "$python_dir" "$uv_cache_dir"

uv_executable="$local_bin/uv"
if [[ ! -x "$uv_executable" ]] || [[ "$($uv_executable --version 2>/dev/null || true)" != "uv $uv_version" ]]; then
  curl -LsSf "https://astral.sh/uv/$uv_version/install.sh" \
    | env UV_UNMANAGED_INSTALL="$local_bin" sh
fi

if [[ "$($uv_executable --version)" != "uv $uv_version" ]]; then
  echo "uv 版本校验失败。" >&2
  exit 1
fi

export PATH="$node_dir/bin:$local_bin:$PATH"
node_ok=false
if [[ -x "$node_dir/bin/node" ]] \
  && [[ "$($node_dir/bin/node --version 2>/dev/null || true)" == "v$node_version" ]] \
  && [[ "$(npm --version 2>/dev/null || true)" == "$npm_version" ]]; then
  node_ok=true
fi

if [[ "$node_ok" != true ]]; then
  install_tmp="$(mktemp -d "$local_dir/install.XXXXXX")"
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
  rm -rf "$node_dir"
  mv "$install_tmp/node" "$node_dir"
  rm -rf "$install_tmp"
fi

export PATH="$node_dir/bin:$local_bin:$PATH"
[[ "$(node --version)" == "v$node_version" ]]
[[ "$(npm --version)" == "$npm_version" ]]

export UV_PYTHON_INSTALL_DIR="$python_dir"
export UV_PYTHON_BIN_DIR="$local_bin"
export UV_CACHE_DIR="$uv_cache_dir"

"$uv_executable" python install "$python_version" \
  --install-dir "$python_dir" --managed-python

venv_python="$backend_dir/.venv/bin/python"
venv_ok=false
if [[ -x "$venv_python" ]] \
  && [[ "$($venv_python --version 2>&1)" == "Python $python_version" ]] \
  && grep -Fq "home = $python_dir/" "$backend_dir/.venv/pyvenv.cfg"; then
  venv_ok=true
fi

if [[ "$venv_ok" != true ]]; then
  "$uv_executable" venv --clear --python "$python_version" \
    --managed-python "$backend_dir/.venv"
fi

"$uv_executable" pip install \
  --python "$venv_python" \
  --index-url "$python_index" \
  --editable "$backend_dir[dev]"

npm --prefix "$frontend_dir" ci --registry="$npm_registry"
npm --prefix "$audit_runtime_dir" ci --registry="$npm_registry"

if [[ ! -f "$backend_dir/.env" ]]; then
  cp "$backend_dir/.env.example" "$backend_dir/.env"
fi

[[ "$($uv_executable --version)" == "uv $uv_version" ]]
[[ "$($venv_python --version 2>&1)" == "Python $python_version" ]]
[[ "$(node --version)" == "v$node_version" ]]
[[ "$(npm --version)" == "$npm_version" ]]
"$uv_executable" pip check --python "$venv_python"
npm --prefix "$frontend_dir" ls --depth=0
npm --prefix "$audit_runtime_dir" ls --depth=0

echo "安装完成。请检查 backend/.env，然后手动运行："
echo "  $project_dir/deploy/run_server.sh"
