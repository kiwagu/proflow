# Trace Collector

Small Bun HTTP collector for debug traces.

## Run

```bash
bun .github/agents/debug-trace/trace-collector.server.ts
```

## Lifecycle

- This collector is for local debugging only and should not be wired into production flows.
- Start it at the beginning of a debug session.
- Remove temporary trace clients, helpers, and debug-only emitters before ending the session.
- Keep trace regions isolated so cleanup is fast and reliable.

## One-file temporary toolkit

- During a debug session, it is acceptable to use one temporary file to export all trace helpers.
- Example for Next.js: `apps/author/src/lib/debug-trace/index.ts` can export emitters and small helper utilities.
- This is intentionally optimized for quick diagnostics, not long-term decomposition.
- For other stacks, use the same pattern with stack-appropriate transport and runtime adapters.

Optional env:

- `TRACE_COLLECTOR_PORT` (default: `7788`)
- `TRACE_COLLECTOR_FILE` (default: `debug/traces/trace.ndjson`)

## Endpoints

- `GET /health`
- `POST /trace`

## Storage

Accepted traces are appended to:

- `debug/traces/trace.ndjson`

The `debug/traces/` folder is gitignored.

## Trace envelope (required fields)

```json
{
  "traceVersion": "1",
  "hypothesisCode": "HYP-AUTHOR-MEDIA-LOOP-001",
  "ts": "2026-04-24T19:00:00.000Z",
  "event": "media-create-post",
  "source": {
    "runtime": "browser",
    "app": "author",
    "file": "src/admin/active-space.sync.client.tsx",
    "fn": "persistActiveSpace"
  },
  "level": "debug",
  "context": {
    "status": 200
  }
}
```

## Browser send example

```ts
await fetch('http://127.0.0.1:7788/trace', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    traceVersion: '1',
    hypothesisCode: 'HYP-AUTHOR-MEDIA-LOOP-001',
    ts: new Date().toISOString(),
    event: 'submit-loop-detected',
    source: { runtime: 'browser', app: 'author' },
    context: { route: '/admin/collections/media/create' },
  }),
});
```

## Server/Bun send example

```ts
await fetch('http://127.0.0.1:7788/trace', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    traceVersion: '1',
    hypothesisCode: 'HYP-AUTHOR-MEDIA-LOOP-001',
    ts: new Date().toISOString(),
    event: 'beforeChange-enter',
    source: { runtime: 'server', app: 'author' },
    context: { collection: 'media' },
  }),
});
```
