import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { IEmbeddingService } from '@workspace/domain';

import { clampLimit, searchServerDocuments } from './search.js';

/**
 * The service's read surface: one search endpoint for consumers that have no
 * local replica.
 *
 * Deliberately thin. It parses, forwards the CALLER's bearer token, and lets
 * Postgres RLS decide what the caller may see — the service holds no opinion
 * about access and its own service-role credentials never touch this path.
 */

const DEFAULT_PORT = 3020;

export interface SearchServerOptions {
  embedder: IEmbeddingService;
  supabaseUrl: string;
  supabaseAnonKey: string;
  port?: number;
  hostname?: string;
}

export function startSearchServer(options: SearchServerOptions): {
  close: () => Promise<void>;
  port: number;
} {
  const port = options.port ?? DEFAULT_PORT;

  const server = createServer((req, res) => {
    void handle(req, res, options).catch((e) => {
      json(res, 500, { error: String(e) });
    });
  });

  server.listen(port, options.hostname ?? '0.0.0.0');

  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  options: SearchServerOptions
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') {
    json(res, 200, { status: 'ok', model: options.embedder.modelId });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/search') {
    const accessToken = bearerToken(req);
    if (!accessToken) {
      json(res, 401, { error: 'Missing bearer token' });
      return;
    }

    const body = await readJson(req);
    const query = typeof body?.query === 'string' ? body.query : '';
    if (!query.trim()) {
      json(res, 400, { error: 'query must be a non-empty string' });
      return;
    }
    const limit =
      typeof body?.limit === 'number' ? clampLimit(body.limit) : undefined;

    try {
      const hits = await searchServerDocuments({
        supabaseUrl: options.supabaseUrl,
        supabaseAnonKey: options.supabaseAnonKey,
        accessToken,
        embedder: options.embedder,
        query,
        limit,
      });
      json(res, 200, { hits });
    } catch (e) {
      json(res, 422, { error: e instanceof Error ? e.message : 'Search failed' });
    }
    return;
  }

  json(res, 404, { error: 'Not found' });
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

async function readJson(
  req: IncomingMessage
): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}
