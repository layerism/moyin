#!/usr/bin/env bash
set -e

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$script_dir/.local/bin:$PATH"

# 首次安装并创建同步；以后恢复会话用 mutagen sync resume moyin-aliweb-v1。
sudo apt-get update
sudo apt-get install -y curl ca-certificates tar openssh-client
mkdir -p "$script_dir/.local/bin" "$script_dir/.local/mutagen"
curl -fL -o "$script_dir/.local/mutagen/release.tar.gz" \
  https://github.com/mutagen-io/mutagen/releases/download/v0.18.1/mutagen_linux_amd64_v0.18.1.tar.gz
tar -xzf "$script_dir/.local/mutagen/release.tar.gz" -C "$script_dir/.local/mutagen"
install -m 755 "$script_dir/.local/mutagen/mutagen" "$script_dir/.local/bin/"
install -m 644 "$script_dir/.local/mutagen/mutagen-agents.tar.gz" "$script_dir/.local/bin/"
rm -rf "$script_dir/.local/mutagen"

# 数据库同步前停止两端后端；不要让两端同时写入数据库。
mutagen sync create "$script_dir" aliweb:/root/webapp/moyin/v1 \
  --name moyin-aliweb-v1 --mode two-way-safe --no-global-configuration \
  --ignore-vcs \
  --ignore '.local,.venv,node_modules' \
  --ignore '.env,.env.*,!.env.example' \
  --ignore '/outputs' \
  --ignore 'dist,__pycache__,*.pyc,.pytest_cache,.ruff_cache,*.egg-info' \
  --ignore '.vite,*.tsbuildinfo,*.log'

mutagen sync list moyin-aliweb-v1
