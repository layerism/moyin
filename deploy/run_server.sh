#!/usr/bin/env bash
set -e

if [[ "$#" -ne 0 ]]; then
  echo "用法: bash deploy/run_server.sh" >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "$script_dir/.." && pwd)"
export PATH="$project_dir/.local/node/bin:$project_dir/.local/bin:$PATH"

privileged=()
if [[ "$EUID" -ne 0 ]]; then
  privileged=(sudo)
fi

frontend_dist="$project_dir/frontend/dist"
publish_root=/var/www/moyin
publish_link="$publish_root/prod"
expected_target="$(realpath -m -- "$frontend_dist")"

# Build this checkout before changing links or starting services.
echo "正在构建正式前端……"
npm --prefix "$project_dir/frontend" run build
if [[ ! -f "$frontend_dist/index.html" ]]; then
  echo "前端构建未生成 $frontend_dist/index.html。" >&2
  exit 1
fi

# Let Nginx traverse the frontend directory and read the fresh build.
chmod o+x "$project_dir/frontend"
chmod -R a+rX "$frontend_dist"

"${privileged[@]}" mkdir -p "$publish_root"
if [[ -e "$publish_link" && ! -L "$publish_link" ]]; then
  echo "$publish_link 已存在且不是符号链接，请先人工确认现有发布目录。" >&2
  exit 1
fi
"${privileged[@]}" ln -sfnT -- "$expected_target" "$publish_link"

if ! command -v nginx >/dev/null 2>&1 && [[ ! -x /usr/sbin/nginx ]]; then
  "${privileged[@]}" apt-get update
  "${privileged[@]}" apt-get install -y nginx
  "${privileged[@]}" systemctl start nginx
fi

site_config=/etc/nginx/sites-available/moyin
site_link=/etc/nginx/sites-enabled/moyin
# The repository config is the source of truth, including any HTTPS settings.
"${privileged[@]}" install -m 644 "$script_dir/nginx.conf" "$site_config"
if [[ ! -e "$site_link" && ! -L "$site_link" ]]; then
  "${privileged[@]}" ln -s "$site_config" "$site_link"
fi
"${privileged[@]}" /usr/sbin/nginx -t
"${privileged[@]}" systemctl reload nginx

cd "$project_dir/backend"
exec ./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
