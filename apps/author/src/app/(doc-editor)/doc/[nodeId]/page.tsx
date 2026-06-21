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
 * body + its latest state. Saving goes through the RLS-gated PATCH route.
 */

export const dynamic = 'force-dynamic';

export default async function DocEditorPage({
  params,
}: {
  params: Promise<{ nodeId: string }>;
}) {
  const { nodeId } = await params;

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
  const doc = await payload.findByID({
    collection: 'bodies',
    id: docId,
    overrideAccess: true,
    draft: true,
    depth: 0,
  });

  const messages = await loadGraphMessages('en');

  return (
    <DocEditorClient
      spaceId={node.space_id}
      nodeId={nodeId}
      title={node.title}
      initialBody={(doc as { body?: unknown } | null)?.body ?? null}
      initialStatus={(doc as { _status?: string } | null)?._status ?? null}
      messages={messages}
    />
  );
}
