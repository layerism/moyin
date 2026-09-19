#!/usr/bin/env bash
set -e

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
  exec npm run dev
) &
frontend_pid=$!

trap cleanup EXIT INT TERM
wait -n "$backend_pid" "$frontend_pid"
