#!/usr/bin/env bash
# Shared deployment values; source from deployment scripts.
deploy_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "$deploy_dir/.." && pwd)"
if [[ -f "$deploy_dir/.env" ]]; then
  source "$deploy_dir/.env"
fi
export SITE_DOMAIN="${SITE_DOMAIN:-ainami.tech}"
export APP_PORT="${APP_PORT:-8000}"
export SERVICE_USER="${SERVICE_USER:-$(id -un)}"
export DATA_DIR="${DATA_DIR:-$project_dir/backend/storage}"
export WEB_ROOT="${WEB_ROOT:-/var/www/moyin}"
export BACKEND_ENV="${BACKEND_ENV:-$project_dir/backend/.env}"
export PROJECT_DIR="$project_dir"
export FRONTEND_DIST="$WEB_ROOT"
