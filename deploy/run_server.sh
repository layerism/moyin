#!/usr/bin/env bash
set -e

frontend_port="${1:-5173}"
if [[ "$#" -gt 1 || ! "$frontend_port" =~ ^[1-9][0-9]{0,4}$ ]] || (( frontend_port > 65535 )); then
  echo "用法: bash deploy/run_server.sh [前端端口: 1-65535，默认 5173]" >&2
  exit 1
fi
if [[ "$frontend_port" -eq 8000 ]]; then
  echo "8000 已用于后端，请选择其他前端端口。" >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "$script_dir/.." && pwd)"
export PATH="$project_dir/.local/node/bin:$project_dir/.local/bin:$PATH"

privileged=()
if [[ "$EUID" -ne 0 ]]; then
  privileged=(sudo)
fi

if ! command -v nginx >/dev/null 2>&1 && [[ ! -x /usr/sbin/nginx ]]; then
  "${privileged[@]}" apt-get update
  "${privileged[@]}" apt-get install -y nginx
  "${privileged[@]}" systemctl start nginx
fi

site_config=/etc/nginx/sites-available/moyin
site_link=/etc/nginx/sites-enabled/moyin
# Preserve existing site configuration, including Certbot-managed HTTPS.
if [[ ! -e "$site_config" && ! -L "$site_config" ]]; then
  "${privileged[@]}" install -m 644 "$script_dir/nginx.conf" "$site_config"
fi
if [[ ! -e "$site_link" && ! -L "$site_link" ]]; then
  "${privileged[@]}" ln -s "$site_config" "$site_link"
fi
"${privileged[@]}" /usr/sbin/nginx -t
"${privileged[@]}" systemctl reload nginx

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
  exec npm run dev -- --port "$frontend_port" --strictPort
) &
frontend_pid=$!

trap cleanup EXIT INT TERM
wait -n "$backend_pid" "$frontend_pid"
