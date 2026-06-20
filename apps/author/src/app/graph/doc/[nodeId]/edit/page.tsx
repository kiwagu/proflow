import config from '@payload-config';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getPayload } from 'payload';

import { ensureNodeBody } from '@/knowledge/fanout';
import { createRlsClientFromCookieHeader } from '@/lib/supabase/rls-from-request';

/**
 * Edit deep-link resolver — the node-centric URL the workbench reader's "Edit"
 * points at. It bridges the graph's node id to the Payload admin document that
 * owns the Lexical body, so the EDITOR is Payload's own (native Lexical +
 * versions + drafts) — no second editor, no duplicated authoring harness
 * (ADR-0005; edit through the Payload form).
 *
 * Flow: gate node access under the caller's OWN RLS (no row ⇒ no access), resolve
 * (self-healing) the `bodies` doc id, then redirect to the Payload admin doc.
 * A caller who cannot reach the node is sent back to the workbench, never to a
 * body they may not edit — node access gates body access (ADR-0002 §2).
 *
 * A server-component `redirect()` (not a Route Handler `Location`) is used on
 * purpose: it is basePath-aware (Next prepends the app `basePath`, so `/graph` →
 * `/author/graph`), matching `(frontend)/page.tsx`. A Route Handler `Location`
 * drops the basePath.
 */

export const dynamic = 'force-dynamic';

const WORKBENCH = '/graph';

export default async function EditBodyRedirectPage({
  params,
}: {
  params: Promise<{ nodeId: string }>;
}) {
  const { nodeId } = await params;
  const id = nodeId?.trim();
  if (!id) {
    redirect(WORKBENCH);
  }

  const cookieHeader = (await headers()).get('cookie');
  const db = createRlsClientFromCookieHeader(cookieHeader);

  // Gate: a text node the caller may access under RLS (no row ⇒ no access).
  const { data: node } = await db
    .from('knowledge_resources')
    .select('id,space_id')
    .eq('id', id)
    .eq('kind', 'text')
    .maybeSingle();
  if (!node) {
    redirect(WORKBENCH);
  }

  // Resolve (self-healing) the body doc id, then hand off to the native Payload
  // admin editor. A bodyless node (created before the body fan-out) gets a real
  // empty body minted on demand, so every document is editable.
  let docId: string;
  try {
    const payload = await getPayload({ config });
    docId = await ensureNodeBody(
      { nodeId: id, spaceId: (node as { space_id: string }).space_id },
      { db, payload }
    );
  } catch {
    redirect(WORKBENCH);
  }

  redirect(`/admin/collections/bodies/${docId}`);
}
