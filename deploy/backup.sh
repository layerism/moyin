#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/config.sh"
# Stop the application before invoking this script for a consistent full backup.
backup_dir="${1:?用法: bash deploy/backup.sh /absolute/backup-directory}"
mkdir -p "$backup_dir"
backup_dir="$(cd "$backup_dir" && pwd)"
data_path="$(cd "$DATA_DIR" && pwd)"
case "$backup_dir/" in "$data_path/"*) echo '备份目录不能位于数据目录内' >&2; exit 1;; esac
[[ -f "$DATA_DIR/app.db" ]]
umask 077
archive="$backup_dir/moyin-$(date -u +%Y%m%dT%H%M%S)-$$.tar.gz"
tar -czf "$archive" -C "$DATA_DIR" .
printf '%s\n' "$archive"
