#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/config.sh"
cd "$project_dir"
export PATH="$PWD/.local/node/bin:$PATH"
# Build and render only. Installing system configuration is an explicit operation.
npm --prefix frontend run build
mkdir -p "$deploy_dir/.generated"
bash "$deploy_dir/render_nginx.sh" > "$deploy_dir/.generated/nginx.conf"
envsubst '${SERVICE_USER} ${PROJECT_DIR} ${BACKEND_ENV} ${DATA_DIR} ${APP_PORT}' \
  < "$deploy_dir/moyin.service.template" > "$deploy_dir/.generated/moyin.service"
printf '构建与配置生成完成：%s/.generated\n请按 deploy/README.md 安装或更新服务。\n' "$deploy_dir"
