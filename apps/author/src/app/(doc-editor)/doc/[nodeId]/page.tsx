import config from '@payload-config';
import { loadGraphMessages } from '@workspace/i18n-catalogs/graph';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getPayload } from 'payload';

import { ensureNodeBody } from '@/knowledge/fanout';
import { AUTHOR_BASE_PATH } from '@/lib/author-base-path';
import { getPlatformLoginHrefWithReturn } from '@/lib/platform-login';
import { createRlsClientFromCookieHeader } from '@/lib/supabase/rls-from-request';

import { DocEditorClient } from './doc-editor.client';

/**
 * `/author/doc/[nodeId]` — the dedicated editor page. Renders Payload's full
 * Lexical editor, whose server-function (`renderField`) REQUIRES an authenticated
 * Payload user — so the page gates on Payload auth FIRST (no user ⇒ redirect to
 * platform sign-in with a return path, the typical route behaviour, instead of a
 * raw `Unauthorized` from the editor). Then it gates node access under the
 * caller's OWN RLS (no row ⇒ back to the workbench), resolves (self-healing) the
 * body + the SEED to edit. Saving goes through the RLS-gated PATCH route.
 *
 * The seed is a DELIBERATE choice (read mode shows the published version, but a
 * document may carry several drafts), passed from the chooser as a query:
 *   - `?source=published` → start a new draft from the latest PUBLISHED version,
 *   - `?version=<id>`     → continue THAT version (must belong to this body),
 *   - (none)              → the latest draft (default).
 */

export const dynamic = 'force-dynamic';

/** Resolve the body to seed the editor with, per the chooser's query. */
async function resolveSeed(
  payload: Awaited<ReturnType<typeof getPayload>>,
  docId: string,
  choice: { source?: string; version?: string }
): Promise<{ body: unknown; status: string | null }> {
  // Continue a specific version — only if it belongs to THIS body.
  if (choice.version) {
    const v = (await payload
      .findVersionByID({
        collection: 'bodies',
        id: choice.version,
        overrideAccess: true,
        depth: 0,
      })
      .catch(() => null)) as {
      parent?: string;
      version?: { body?: unknown; _status?: string };
    } | null;
    if (v && v.parent === docId) {
      return {
        body: v.version?.body ?? null,
        status: v.version?._status ?? null,
      };
    }
  }

  // New draft from the latest PUBLISHED version.
  if (choice.source === 'published') {
    const { docs } = await payload.findVersions({
      collection: 'bodies',
      where: {
        and: [
          { parent: { equals: docId } },
          { 'version._status': { equals: 'published' } },
        ],
      },
      overrideAccess: true,
      depth: 0,
      limit: 1,
      sort: '-updatedAt',
      pagination: false,
    });
    const latest = docs[0] as { version?: { body?: unknown } } | undefined;
    return { body: latest?.version?.body ?? null, status: 'published' };
  }

  // Default: the latest draft (the document's current in-progress edit).
  const doc = (await payload.findByID({
    collection: 'bodies',
    id: docId,
    overrideAccess: true,
    draft: true,
    depth: 0,
  })) as { body?: unknown; _status?: string } | null;
  return { body: doc?.body ?? null, status: doc?._status ?? null };
}

export default async function DocEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ nodeId: string }>;
  searchParams: Promise<{ source?: string; version?: string }>;
}) {
  const { nodeId } = await params;
  const { source, version } = await searchParams;

  const reqHeaders = await headers();
  const payload = await getPayload({ config });

  // Auth gate: the editor's server-function needs a Payload user (bridged from
  // Supabase). No user → sign-in, returning here afterwards.
  const { user } = await payload.auth({ headers: reqHeaders });
  if (!user) {
    redirect(
      getPlatformLoginHrefWithReturn(`${AUTHOR_BASE_PATH}/doc/${nodeId}`)
    );
  }

  const db = createRlsClientFromCookieHeader(reqHeaders.get('cookie'));
  const { data: node } = await db
    .from('knowledge_resources')
    .select('id,title,space_id')
    .eq('id', nodeId)
    .eq('kind', 'text')
    .maybeSingle();
  if (!node) {
    redirect('/graph');
  }
  const docId = await ensureNodeBody(
    { nodeId, spaceId: node.space_id },
    { db, payload }
  );
  const seed = await resolveSeed(payload, docId, { source, version });

  const messages = await loadGraphMessages('en');

  return (
    <DocEditorClient
      spaceId={node.space_id}
      nodeId={nodeId}
      title={node.title}
      initialBody={seed.body}
      initialStatus={seed.status}
      messages={messages}
    />
  );
}
