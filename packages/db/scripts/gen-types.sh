#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
ENV_FILE="$ROOT_DIR/infra/dev/supabase/.env"
URLENCODE_STDIN="$ROOT_DIR/scripts/urlencode-stdin.py"
SUPABASE_CMD="${SUPABASE_CMD:-}"

if [[ -z "$SUPABASE_CMD" ]]; then
  if command -v supabase >/dev/null 2>&1; then
    SUPABASE_CMD="supabase"
  elif command -v bunx >/dev/null 2>&1; then
    SUPABASE_CMD="bunx supabase"
  else
    echo "Supabase CLI not found (neither binary nor bunx fallback)." >&2
    exit 1
  fi
fi

if [[ -n "${SELF_HOSTED_DB_URL:-}" ]]; then
  DBURL="$SELF_HOSTED_DB_URL"
else
  [[ -f "$ENV_FILE" ]] || {
    echo "Missing $ENV_FILE (copy from .env.example)" >&2
    exit 1
  }

  POSTGRES_PASSWORD=$(grep -E '^POSTGRES_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2-)
  POSTGRES_PORT=$(grep -E '^POSTGRES_PORT=' "$ENV_FILE" | head -1 | cut -d= -f2-)
  POSTGRES_DB=$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | head -1 | cut -d= -f2-)
  POOLER_TENANT_ID=$(grep -E '^POOLER_TENANT_ID=' "$ENV_FILE" | head -1 | cut -d= -f2-)
  POSTGRES_DIRECT_PORT=$(grep -E '^POSTGRES_DIRECT_PORT=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '[:space:]')
  POSTGRES_PORT=${POSTGRES_PORT:-5432}
  POSTGRES_DB=${POSTGRES_DB:-postgres}
  : "${POSTGRES_PASSWORD:?Missing POSTGRES_PASSWORD in $ENV_FILE}"

  command -v python3 >/dev/null 2>&1 || {
    echo "python3 is required (scripts/urlencode-stdin.py) for supabase --db-url" >&2
    exit 1
  }

  ENC_PASS=$(printf '%s' "$POSTGRES_PASSWORD" | python3 "$URLENCODE_STDIN")
  if [[ -n "$POSTGRES_DIRECT_PORT" ]]; then
    PG_USER="postgres"
    CLI_PORT="$POSTGRES_DIRECT_PORT"
  else
    if [[ -n "$POOLER_TENANT_ID" ]]; then
      PG_USER="postgres.$POOLER_TENANT_ID"
    else
      PG_USER="postgres"
    fi
    CLI_PORT="$POSTGRES_PORT"
  fi
  ENC_USER=$(printf '%s' "$PG_USER" | python3 "$URLENCODE_STDIN")
  HOST="${SELF_HOSTED_DB_HOST:-127.0.0.1}"
  SSLMODE="${SELF_HOSTED_DB_SSLMODE:-disable}"
  DBURL="postgresql://$ENC_USER:$ENC_PASS@$HOST:$CLI_PORT/$POSTGRES_DB?sslmode=$SSLMODE"
fi

cd "$ROOT_DIR/packages/db"
PGSSLMODE="${SELF_HOSTED_DB_SSLMODE:-disable}" $SUPABASE_CMD gen types typescript --db-url "$DBURL" > src/database.types.ts