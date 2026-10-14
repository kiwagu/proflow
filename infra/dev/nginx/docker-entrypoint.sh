#!/bin/sh
set -eu

PORT="${PROFLOW_DEV_APP_PORT:-3000}"
SUPABASE_HOST="${PROFLOW_SUPABASE_UPSTREAM_HOST:-host.docker.internal}"
SUPABASE_PORT="${PROFLOW_SUPABASE_UPSTREAM_PORT:-8000}"
# Same-origin backend mount; must match NEXT_PUBLIC_GATEWAY_BACKEND_PATH.
BACKEND_PATH="${PROFLOW_BACKEND_PATH:-/backend}"
sed \
  -e "s/@PROFLOW_DEV_APP_PORT@/${PORT}/g" \
  -e "s/@SUPABASE_UPSTREAM_HOST@/${SUPABASE_HOST}/g" \
  -e "s/@SUPABASE_UPSTREAM_PORT@/${SUPABASE_PORT}/g" \
  -e "s|@BACKEND_PATH@|${BACKEND_PATH}|g" \
  /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
