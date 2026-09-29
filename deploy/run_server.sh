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

nginx_config="$script_dir/nginx.conf"
# Read literal settings from the single-site repository configuration.
deployment_settings="$(awk '
  $1 == "root" || $1 == "proxy_pass" {
    directive = $1
    value = $0
    sub(/^[ \t]*[^ \t]+[ \t]+/, "", value)
    if (!sub(/;[ \t]*(#.*)?$/, "", value)) invalid = 1
    if (value ~ /^".*"$/) value = substr(value, 2, length(value) - 2)
    if (directive == "root") { roots++; root = value }
    else { proxies++; proxy = value }
  }
  END {
    port = proxy
    sub(/^http:\/\/127[.]0[.]0[.]1:/, "", port)
    if (invalid || roots != 1 || proxies != 1 || root !~ /^\// || index(root, "$") ||
        proxy !~ /^http:\/\/127[.]0[.]0[.]1:[0-9]+$/ || port + 0 < 1 || port + 0 > 65535) {
      print "nginx.conf 必须包含唯一的绝对路径 root 和 http://127.0.0.1:端口 格式的 proxy_pass。" > "/dev/stderr"
      exit 1
    }
    print root
    print port
  }
' "$nginx_config")"
publish_root="${deployment_settings%$'\n'*}"
backend_port="${deployment_settings##*$'\n'}"

# Convert the old publication symlink into a real output directory.
if [[ -L "$publish_root" ]]; then
  "${privileged[@]}" unlink "$publish_root"
fi
"${privileged[@]}" mkdir -p "$publish_root"
"${privileged[@]}" chown "$(id -u):$(id -g)" "$publish_root"

# Keep existing assets so browsers with an older page can still load them.
echo "正在构建正式前端……"
npm --prefix "$project_dir/frontend" run build -- --outDir "$publish_root" --emptyOutDir false
if [[ ! -f "$publish_root/index.html" ]]; then
  echo "前端构建未生成 $publish_root/index.html。" >&2
  exit 1
fi
chmod -R a+rX "$publish_root"

if ! command -v nginx >/dev/null 2>&1 && [[ ! -x /usr/sbin/nginx ]]; then
  "${privileged[@]}" apt-get update
  "${privileged[@]}" apt-get install -y nginx
  "${privileged[@]}" systemctl start nginx
fi

site_config=/etc/nginx/sites-available/moyin
site_link=/etc/nginx/sites-enabled/moyin
# The repository config is the source of truth, including any HTTPS settings.
"${privileged[@]}" install -m 644 "$nginx_config" "$site_config"
if [[ ! -e "$site_link" && ! -L "$site_link" ]]; then
  "${privileged[@]}" ln -s "$site_config" "$site_link"
fi
"${privileged[@]}" /usr/sbin/nginx -t
"${privileged[@]}" systemctl reload nginx

cd "$project_dir/backend"
exec ./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$backend_port"
