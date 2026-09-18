#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/config.sh"
export SITE_DOMAIN="${1:-$SITE_DOMAIN}"
# Print only: never overwrite a Certbot-managed site on update.
envsubst '${SITE_DOMAIN} ${FRONTEND_DIST} ${APP_PORT}' < "$deploy_dir/nginx.conf.template"
