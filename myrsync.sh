#!/usr/bin/env bash
set -e

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
version="${1:-v1}"
session_name="moyin-aliweb-$version"
export PATH="$script_dir/.local/bin:$PATH"

# 用法：bash myrsync.sh [版本目录]，默认 v1。
# 首次创建后，使用 mutagen sync resume moyin-aliweb-版本目录 恢复会话。
if ! command -v mutagen >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y curl ca-certificates tar openssh-client
  install_tmp="$(mktemp -d /tmp/moyin-mutagen.XXXXXX)"
  mkdir -p "$script_dir/.local/bin"
  curl -fL -o "$install_tmp/release.tar.gz" \
    https://github.com/mutagen-io/mutagen/releases/download/v0.18.1/mutagen_linux_amd64_v0.18.1.tar.gz
  tar -xzf "$install_tmp/release.tar.gz" -C "$install_tmp"
  install -m 755 "$install_tmp/mutagen" "$script_dir/.local/bin/"
  install -m 644 "$install_tmp/mutagen-agents.tar.gz" "$script_dir/.local/bin/"
  rm -rf "$install_tmp"
fi

# 数据库同步前停止两端后端；不要让两端同时写入数据库。
mutagen sync create "$script_dir" "aliweb:/root/webapp/moyin/$version" \
  --name "$session_name" --mode two-way-safe --no-global-configuration \
  --ignore-vcs \
  --ignore '/outputs' \
  --ignore 'dist,__pycache__,*.pyc,.pytest_cache,.ruff_cache,*.egg-info' \
  --ignore '.vite,*.tsbuildinfo,*.log'

mutagen sync list "$session_name"
