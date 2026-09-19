#!/usr/bin/env bash
set -e

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "$script_dir/.." && pwd)"
export PATH="$project_dir/.local/node/bin:$project_dir/.local/bin:$PATH"

# Existing Nginx installations are left untouched, even when stopped.
if ! command -v nginx >/dev/null 2>&1 && [[ ! -x /usr/sbin/nginx ]]; then
  if [[ "$EUID" -eq 0 ]]; then
    apt-get update
    apt-get install -y nginx
    systemctl start nginx
  else
    sudo apt-get update
    sudo apt-get install -y nginx
    sudo systemctl start nginx
  fi
fi

cleanup() {
  trap - EXIT INT TERM
  kill "$backend_pid" "$frontend_pid" 2>/dev/null || true
  wait "$backend_pid" "$frontend_pid" 2>/dev/null || true
}

(
  cd "$project_dir/backend"
  exec ./.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
) &
backend_pid=$!

(
  cd "$project_dir/frontend"
  exec npm run dev
) &
frontend_pid=$!

trap cleanup EXIT INT TERM
wait -n "$backend_pid" "$frontend_pid"
