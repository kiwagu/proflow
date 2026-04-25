#!/usr/bin/env bash
set -euo pipefail

PORT="${TRACE_COLLECTOR_PORT:-7788}"
HEALTH_URL="http://127.0.0.1:${PORT}/health"
LOG_FILE="${TRACE_COLLECTOR_LOG_FILE:-/tmp/trace-collector.log}"

if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
  echo "[trace-collector] already running on :${PORT}"
  exit 0
fi

nohup bun .github/agents/debug-trace/trace-collector.server.ts >"$LOG_FILE" 2>&1 &

for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "[trace-collector] started on :${PORT}"
    exit 0
  fi
done

echo "[trace-collector] failed to start. See log: $LOG_FILE" >&2
exit 1
