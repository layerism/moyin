#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
rsync -az --info=progress2 -e 'ssh -T' \
  --rsync-path='mkdir -p /root/webapp/moyin/v1 && rsync' \
  ./ aliweb:/root/webapp/moyin/v1/
