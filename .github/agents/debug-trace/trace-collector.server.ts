import { appendFile, mkdir } from 'fs/promises';
import path from 'path';

type TraceEnvelope = {
  traceVersion: '1';
  hypothesisCode: string;
  ts: string;
  event: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  source: {
    runtime: 'browser' | 'server';
    app: string;
    file?: string;
    fn?: string;
  };
  context?: Record<string, unknown>;
};

type TracePayload = TraceEnvelope | TraceEnvelope[];

const PORT = Number(process.env.TRACE_COLLECTOR_PORT ?? '7788');
const TRACE_DIR = path.resolve(process.cwd(), 'debug/traces');
const TRACE_FILE =
  process.env.TRACE_COLLECTOR_FILE?.trim() ||
  path.join(TRACE_DIR, 'trace.ndjson');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTraceEnvelope(value: unknown): value is TraceEnvelope {
  if (!isRecord(value)) {
    return false;
  }

  if (value.traceVersion !== '1') {
    return false;
  }

  if (typeof value.hypothesisCode !== 'string' || value.hypothesisCode.trim().length === 0) {
    return false;
  }

  if (typeof value.ts !== 'string' || Number.isNaN(Date.parse(value.ts))) {
    return false;
  }

  if (typeof value.event !== 'string' || value.event.trim().length === 0) {
    return false;
  }

  if (!isRecord(value.source)) {
    return false;
  }

  const runtime = value.source.runtime;
  if (runtime !== 'browser' && runtime !== 'server') {
    return false;
  }

  return typeof value.source.app === 'string' && value.source.app.trim().length > 0;
}

function normalizePayload(payload: unknown): TraceEnvelope[] {
  if (Array.isArray(payload)) {
    return payload.filter(isTraceEnvelope);
  }

  if (isTraceEnvelope(payload)) {
    return [payload];
  }

  return [];
}

async function persistTraces(traces: TraceEnvelope[]): Promise<void> {
  await mkdir(TRACE_DIR, { recursive: true });

  const lines = traces.map((item) => JSON.stringify(item)).join('\n') + '\n';
  await appendFile(TRACE_FILE, lines, 'utf8');
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

Bun.serve({
  port: PORT,
  async fetch(req: Request) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return json(200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      return json(200, { ok: true, traceDir: TRACE_DIR, traceFile: TRACE_FILE });
    }

    if (req.method !== 'POST' || url.pathname !== '/trace') {
      return json(404, { error: 'Not found' });
    }

    const raw = (await req.json().catch(() => null)) as TracePayload | null;
    const traces = normalizePayload(raw);

    if (traces.length === 0) {
      return json(400, {
        error:
          'Invalid trace payload. Expected object or array with mandatory fields: traceVersion="1", hypothesisCode, ts, event, source.runtime, source.app',
      });
    }

    await persistTraces(traces);

    return json(202, {
      accepted: traces.length,
      hypothesisCodes: [...new Set(traces.map((trace) => trace.hypothesisCode))],
      ok: true,
      traceDir: TRACE_DIR,
      traceFile: TRACE_FILE,
    });
  },
});

console.log('[trace-collector] listening', {
  endpoint: `http://127.0.0.1:${PORT}/trace`,
  health: `http://127.0.0.1:${PORT}/health`,
  traceDir: TRACE_DIR,
  traceFile: TRACE_FILE,
});
