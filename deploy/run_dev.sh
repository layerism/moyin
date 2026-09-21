#!/usr/bin/env bash
set -e

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "$script_dir/.." && pwd)"
export PATH="$project_dir/.local/node/bin:$PATH"

cleanup() {
  trap - EXIT INT TERM
  kill "$backend_pid" "$frontend_pid" 2>/dev/null || true
  wait "$backend_pid" "$frontend_pid" 2>/dev/null || true
}

(
  cd "$project_dir/backend"
  exec ./.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 9000
) &
backend_pid=$!

(
  cd "$project_dir/frontend"
  export VITE_API_PROXY_TARGET=http://127.0.0.1:9000
  exec npm run dev -- --port 6173 --strictPort
) &
frontend_pid=$!

trap cleanup EXIT INT TERM
wait -n "$backend_pid" "$frontend_pid"
