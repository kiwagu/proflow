#!/bin/sh
set -eu

PORT="${PROFLOW_DEV_APP_PORT:-3000}"
SUPABASE_HOST="${PROFLOW_SUPABASE_UPSTREAM_HOST:-host.docker.internal}"
SUPABASE_PORT="${PROFLOW_SUPABASE_UPSTREAM_PORT:-8000}"
sed \
  -e "s/@PROFLOW_DEV_APP_PORT@/${PORT}/g" \
  -e "s/@SUPABASE_UPSTREAM_HOST@/${SUPABASE_HOST}/g" \
  -e "s/@SUPABASE_UPSTREAM_PORT@/${SUPABASE_PORT}/g" \
  /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
