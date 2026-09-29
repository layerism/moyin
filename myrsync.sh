#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$script_dir/.local/bin:$PATH"
session_name="moyin-aliweb-v1"

# Ubuntu x86_64：已有 Mutagen 时复用，否则安装到项目目录。
if ! command -v mutagen >/dev/null 2>&1; then
  if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
    echo "自动安装仅支持 Linux x86_64；其他平台请先安装 Mutagen。" >&2
    exit 1
  fi
  privileged=()
  if [[ "$EUID" -ne 0 ]]; then
    privileged=(sudo)
  fi
  "${privileged[@]}" apt-get update
  "${privileged[@]}" apt-get install -y curl ca-certificates tar openssh-client
  mkdir -p "$script_dir/.local/bin"
  install_tmp="$(mktemp -d "$script_dir/.local/mutagen.XXXXXX")"
  trap 'rm -rf -- "$install_tmp"' EXIT
  curl -fL -o "$install_tmp/mutagen.tar.gz" \
    https://github.com/mutagen-io/mutagen/releases/download/v0.18.1/mutagen_linux_amd64_v0.18.1.tar.gz
  tar -xzf "$install_tmp/mutagen.tar.gz" -C "$install_tmp"
  install -m 644 "$install_tmp/mutagen-agents.tar.gz" "$script_dir/.local/bin/"
  install -m 755 "$install_tmp/mutagen" "$script_dir/.local/bin/"
fi

# 固定名称便于管理；列举失败时直接退出，不误建第二个会话。
session_id="$(mutagen sync list --template '{{range .}}{{if eq .Name "moyin-aliweb-v1"}}{{.Identifier}}{{"\n"}}{{end}}{{end}}')"
if [[ -n "$session_id" ]]; then
  endpoints="$(mutagen sync list "$session_id" --template '{{range .}}{{.Alpha.Path}}{{"\n"}}{{.Beta.Host}}:{{.Beta.Path}}{{end}}')"
  if [[ "$endpoints" != "$script_dir"$'\n'"aliweb:/root/webapp/moyin/v1" ]]; then
    echo "已有同名会话指向其他目录，请先用 mutagen sync list 检查。" >&2
    exit 1
  fi
  mutagen sync resume "$session_id"
else
  # 删除也会双向传播；冲突交由人工处理，不强制覆盖任一端。
  mutagen sync create "$script_dir" aliweb:/root/webapp/moyin/v1 \
    --name "$session_name" --mode two-way-safe --no-global-configuration \
    --ignore-vcs \
    --ignore '.local' --ignore '.venv' --ignore 'node_modules' \
    --ignore '.env' --ignore '.env.*' --ignore '!.env.example' \
    --ignore '/backend/storage' --ignore '/outputs' \
    --ignore 'dist' --ignore '__pycache__' --ignore '*.pyc' \
    --ignore '.pytest_cache' --ignore '.ruff_cache' --ignore '*.egg-info' \
    --ignore '.vite' --ignore '*.tsbuildinfo' --ignore '*.log' \
    --ignore '*.db' --ignore '*.db-wal' --ignore '*.db-shm'
fi

mutagen sync list "$session_name"
echo "后台双向同步会话：$session_name；请检查上方连接状态与冲突。"
echo "查看：mutagen sync monitor $session_name"
echo "暂停：mutagen sync pause $session_name"
# 会话配置在创建时固定；修改排除规则后须 terminate 此会话再运行本脚本。
