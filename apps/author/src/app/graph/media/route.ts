import { entityIds } from '@workspace/entity-id';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { mediaUploadAuthorizeRequestSchema } from '@workspace/knowledge-contracts';

import {
  isAuthFailure,
  requireRlsSession,
} from '@/lib/supabase/require-rls-session';
import {
  MediaAuthorizeError,
  authorizeMediaUpload,
} from '@/knowledge/media/media-upload-authorize';
import { authorizeMediaDownload } from '@/knowledge/media/media-download-authorize';

/**
 * KB media transport (ADR-0026). Thin: it authenticates the Supabase SESSION
 * (never service-role), zod-validates the body, and delegates to the UI-agnostic
 * authorizer modules — all authorize/mint LOGIC lives there. RLS (the graph
 * predicate + `storage.objects`) is the SOLE fence; the bytes egress ONLY via the
 * short-lived signed URLs these authorizers mint under the caller's own client.
 *
 *   POST ?op=upload-url   → authorize node-update, mint a signed UPLOAD url.
 *   POST ?op=download-url → authorize node-read, mint a signed DOWNLOAD url.
 */

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const downloadRequestSchema = z.object({
  spaceId: entityIds.space.prefixSchema,
  nodeId: entityIds.knowledgeResource.prefixSchema,
});

function errorStatus(error: unknown): { message: string; status: number } {
  if (error instanceof MediaAuthorizeError) {
    return { message: error.message, status: error.status };
  }
  const message =
    error instanceof Error ? error.message : 'Media request failed.';
  // Any unclassified failure (incl. RLS rejection) → 422, no leak.
  return { message, status: 422 };
}

export async function POST(request: Request) {
  const op = new URL(request.url).searchParams.get('op');
  if (op !== 'upload-url' && op !== 'download-url') {
    return NextResponse.json(
      { message: 'Unsupported op.' },
      { status: 400, headers: NO_STORE }
    );
  }

  const raw = await request.json().catch(() => null);

  const session = await requireRlsSession(request);
  if (isAuthFailure(session)) {
    return session;
  }
  const { db, userId } = session;

  try {
    if (op === 'upload-url') {
      const parsed = mediaUploadAuthorizeRequestSchema.safeParse(raw);
      if (!parsed.success) {
        return NextResponse.json(
          { message: 'Invalid request', issues: parsed.error.issues },
          { status: 400, headers: NO_STORE }
        );
      }
      const result = await authorizeMediaUpload(parsed.data, { db, userId });
      return NextResponse.json(result, { status: 200, headers: NO_STORE });
    }

    const parsed = downloadRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { message: 'Invalid request', issues: parsed.error.issues },
        { status: 400, headers: NO_STORE }
      );
    }
    const result = await authorizeMediaDownload(parsed.data, { db, userId });
    return NextResponse.json(result, { status: 200, headers: NO_STORE });
  } catch (error) {
    const { message, status } = errorStatus(error);
    return NextResponse.json({ message }, { status, headers: NO_STORE });
  }
}
