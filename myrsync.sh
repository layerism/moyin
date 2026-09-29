#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
rsync -az --info=progress2 -e 'ssh -T' \
  --rsync-path='mkdir -p /root/webapp/moyin/v1 && rsync' \
  "$script_dir/" aliweb:/root/webapp/moyin/v1/
