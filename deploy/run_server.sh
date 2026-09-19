#!/usr/bin/env bash
set -e

environment="${1:-prod}"
if [[ "$#" -gt 1 ]]; then
  echo "用法: bash deploy/run_server.sh [prod|gray|test]" >&2
  exit 1
fi

case "$environment" in
  prod)
    backend_port=8000
    frontend_port=5173
    ;;
  gray)
    backend_port=8001
    frontend_port=5174
    ;;
  test)
    backend_port=8002
    frontend_port=5175
    ;;
  *)
    echo "用法: bash deploy/run_server.sh [prod|gray|test]" >&2
    exit 1
    ;;
esac

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
site_changed=false
# Preserve existing site configuration, including Certbot-managed HTTPS.
if [[ ! -e "$site_config" && ! -L "$site_config" ]]; then
  "${privileged[@]}" install -m 644 "$script_dir/nginx.conf" "$site_config"
  site_changed=true
fi
if [[ ! -e "$site_link" && ! -L "$site_link" ]]; then
  "${privileged[@]}" ln -s "$site_config" "$site_link"
  site_changed=true
fi
# Reload Nginx only when this script changes the site configuration.
if [[ "$site_changed" == true ]]; then
  "${privileged[@]}" /usr/sbin/nginx -t
  "${privileged[@]}" systemctl reload nginx
fi


cleanup() {
  trap - EXIT INT TERM
  kill "$backend_pid" "$frontend_pid" 2>/dev/null || true
  wait "$backend_pid" "$frontend_pid" 2>/dev/null || true
}

(
  cd "$project_dir/backend"
  exec ./.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port "$backend_port"
) &
backend_pid=$!

(
  cd "$project_dir/frontend"
  export VITE_API_PROXY_TARGET="http://127.0.0.1:$backend_port"
  exec npm run dev -- --port "$frontend_port" --strictPort
) &
frontend_pid=$!

trap cleanup EXIT INT TERM
wait -n "$backend_pid" "$frontend_pid"
