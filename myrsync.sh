#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VERSION="${1:-v1}"
SESSION_NAME="moyin-aliweb-$VERSION"
export PATH="$SCRIPT_DIR/.local/bin:$PATH"

# 用法：bash myrsync.sh [版本目录]，默认 v1。
# 首次创建后，使用 mutagen sync resume moyin-aliweb-版本目录 恢复会话。
if ! command -v mutagen >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y curl ca-certificates tar openssh-client
  INSTALL_TMP="$(mktemp -d /tmp/moyin-mutagen.XXXXXX)"
  mkdir -p "$SCRIPT_DIR/.local/bin"
  curl -fL -o "$INSTALL_TMP/release.tar.gz" \
    https://github.com/mutagen-io/mutagen/releases/download/v0.18.1/mutagen_linux_amd64_v0.18.1.tar.gz
  tar -xzf "$INSTALL_TMP/release.tar.gz" -C "$INSTALL_TMP"
  install -m 755 "$INSTALL_TMP/mutagen" "$SCRIPT_DIR/.local/bin/"
  install -m 644 "$INSTALL_TMP/mutagen-agents.tar.gz" "$SCRIPT_DIR/.local/bin/"
  rm -rf "$INSTALL_TMP"
fi

# 数据库同步前停止两端后端；不要让两端同时写入数据库。
mutagen sync create "$SCRIPT_DIR" "aliweb:/root/webapp/moyin/$VERSION" \
  --name "$SESSION_NAME" --mode two-way-safe --no-global-configuration \
  --ignore-vcs \
  --ignore '/backend/.venv' \
  --ignore '/frontend/node_modules' \
  --ignore '/backend/runtime/javascript/node_modules' \
  --ignore '/.local' \
  --ignore '/outputs' \
  --ignore '/frontend/dist,__pycache__,*.pyc,.pytest_cache,.ruff_cache,*.egg-info' \
  --ignore '.vite,*.tsbuildinfo,*.log'

mutagen sync list "$SESSION_NAME"
