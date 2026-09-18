#!/usr/bin/env bash
set -e

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "$script_dir/.." && pwd)"
export SITE_DOMAIN="${1:-ainami.tech}"
export FRONTEND_DIST="$project_dir/frontend/dist"

# Substitute only deployment values, preserving Nginx variables such as $uri.
# Print to stdout so an existing Certbot-managed configuration is not overwritten.
envsubst '${SITE_DOMAIN} ${FRONTEND_DIST}' < "$script_dir/nginx.conf"
