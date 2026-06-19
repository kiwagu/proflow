import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Payload, PayloadRequest } from 'payload';

import {
  createBodylessResource,
  createEdge,
  createTextResourceWithBody,
  tagResource,
} from '@/knowledge/text-resource.fanout';
import {
  setResourceDescription,
  setResourceLink,
  setResourceMediaMeta,
  setResourceProvenance,
} from '@/knowledge/kb-attribute.fanout';

/**
 * Sample / illustrative knowledge-graph builder — UI-AGNOSTIC application module.
 *
 * The owner can seed an EXAMPLE graph that exercises EVERY engine capability so a
 * fresh user does not face a blank slate (a built-in manual / sample). This builds
 * that graph with REAL write calls, REUSING the existing fan-out modules (text /
 * body-less node create, edge create, tag-on-tagging, KB attribute upserts) — it
 * adds ZERO new write logic and ZERO new topology (Invariant #1: node + edge +
 * satellite attribute only).
 *
 * Trust discipline (ADR-0011 §3): the WHOLE sample is built under the user's
 * RLS-scoped `db` — it is the user's own data, NOT a system seed. `created_by` /
 * `owner_user_id` come from the session (the fan-out modules attribute them).
 * NEVER service-role.
 *
 * Coverage (mirrors the prototype sample, compressed): nested folders via FORWARD
 * `contains`; text docs with Lexical bodies; a `link` node + its URL attribute;
 * `file` and `video` nodes + media-meta (metadata only — real binary upload is a
 * later slice); `tag` nodes + `tagged` edges; `relates_to` associative links
 * between docs; at least one `shortcut`; descriptions + provenance on a subset.
 *
 * Idempotency guard: a marker (a sentinel `folder` titled SAMPLE_ROOT_TITLE) is
 * looked up first; if it already exists in the space, the build is a no-op (the
 * route returns 409). One re-seed marker is simpler and safer than namespaced
 * headers, and visible to the user (it is a real folder).
 */

export const SAMPLE_ROOT_TITLE = 'Knowledge Base (sample)';

export type SeedSampleDeps = {
  /** User's RLS-scoped supabase-js client — NEVER service-role. */
  db: SupabaseClient<Database>;
  /** Payload Local API (text bodies). */
  payload: Payload;
  /** Authenticated Supabase user id (created_by attribution). */
  userId: string;
  /** Payload request carrying the user identity for body creates. */
  req: PayloadRequest;
};

export type SeedSampleResult = {
  /** ids of the root folders the UI can focus after seeding. */
  rootFolderIds: string[];
  /** the sentinel root folder (also the dup-guard marker). */
  sampleRootId: string;
  nodesCreated: number;
  edgesCreated: number;
};

export class SampleAlreadySeededError extends Error {
  constructor() {
    super('Sample knowledge graph already seeded in this space.');
    this.name = 'SampleAlreadySeededError';
  }
}

/** Build a one-paragraph Lexical body (the shape the `bodies` richText accepts). */
function lexicalParagraphs(paragraphs: string[]): unknown {
  return {
    root: {
      type: 'root',
      format: '',
      indent: 0,
      version: 1,
      direction: 'ltr',
      children: paragraphs.map((text) => ({
        type: 'paragraph',
        format: '',
        indent: 0,
        version: 1,
        direction: 'ltr',
        textFormat: 0,
        children: [
          {
            type: 'text',
            mode: 'normal',
            text,
            format: 0,
            style: '',
            detail: 0,
            version: 1,
          },
        ],
      })),
    },
  };
}

/**
 * Seed the illustrative graph. Throws `SampleAlreadySeededError` if the sentinel
 * already exists (the route maps it to 409). Any other failure (e.g. RLS rejection
 * for a caller without `space.knowledge.create`) surfaces as a normal error —
 * nothing is rolled back, but the dup-guard makes a re-run after a partial failure
 * safe to reason about (the sentinel is created LAST so a partial seed re-runs).
 */
export async function seedSampleKnowledgeGraph(
  spaceId: string,
  deps: SeedSampleDeps
): Promise<SeedSampleResult> {
  const { db, payload, userId, req } = deps;

  // ── dup guard: bail if the sentinel sample root already exists ──────────────
  const { data: existing } = await db
    .from('knowledge_resources')
    .select('id')
    .eq('space_id', spaceId)
    .eq('kind', 'folder')
    .eq('title', SAMPLE_ROOT_TITLE)
    .maybeSingle();
  if (existing?.id) {
    throw new SampleAlreadySeededError();
  }

  let nodesCreated = 0;
  let edgesCreated = 0;

  // helpers that count, reusing the existing RLS-scoped fan-out modules ─────────
  const folder = async (title: string, parentFolderId?: string) => {
    const r = await createBodylessResource(
      {
        spaceId,
        kind: 'folder',
        title,
        parentFolder: parentFolderId ? { parentFolderId } : undefined,
      },
      { db, userId }
    );
    nodesCreated += 1;
    if (r.contains_edge_id) {
      edgesCreated += 1;
    }
    return r.node_id;
  };

  const doc = async (
    title: string,
    paragraphs: string[],
    parentFolderId: string
  ) => {
    const r = await createTextResourceWithBody(
      {
        spaceId,
        title,
        lexicalBody: lexicalParagraphs(paragraphs),
        parentFolder: { parentFolderId },
      },
      { db, payload, userId, req }
    );
    nodesCreated += 1;
    if (r.contains_edge_id) {
      edgesCreated += 1;
    }
    return r.node_id;
  };

  const bodyless = async (
    kind: 'link' | 'tag',
    title: string,
    parentFolderId?: string
  ) => {
    const r = await createBodylessResource(
      {
        spaceId,
        kind,
        title,
        parentFolder: parentFolderId ? { parentFolderId } : undefined,
      },
      { db, userId }
    );
    nodesCreated += 1;
    if (r.contains_edge_id) {
      edgesCreated += 1;
    }
    return r.node_id;
  };

  // media nodes (file/video) are body-less in this slice — created via a single
  // RLS INSERT, then their media-meta attribute set. NB: `createBodylessResource`
  // is typed for link/tag/folder; file/video go through a direct RLS INSERT here
  // (same seam, same created_by-from-session), then media-meta is attached.
  const mediaNode = async (
    kind: 'file' | 'video',
    title: string,
    parentFolderId: string,
    meta: { byteSize?: number; durationMs?: number; mimeType?: string }
  ) => {
    const { data, error } = await db
      .from('knowledge_resources')
      .insert({
        space_id: spaceId,
        kind,
        title,
        status: 'active',
        created_by: userId,
        owner_user_id: userId,
      })
      .select('id')
      .single();
    if (error || !data?.id) {
      throw new Error(`sample media node: ${error?.message ?? 'no id'}`);
    }
    nodesCreated += 1;
    const nodeId = data.id;
    // place inside the folder (FORWARD contains)
    await createEdge(
      {
        spaceId,
        fromId: parentFolderId,
        toId: nodeId,
        relationType: 'contains',
      },
      { db, userId }
    );
    edgesCreated += 1;
    await setResourceMediaMeta(
      {
        spaceId,
        nodeId,
        byteSize: meta.byteSize ?? null,
        durationMs: meta.durationMs ?? null,
        mimeType: meta.mimeType ?? null,
      },
      { db, userId }
    );
    return nodeId;
  };

  const relate = async (fromId: string, toId: string) => {
    await createEdge(
      { spaceId, fromId, toId, relationType: 'relates_to' },
      { db, userId }
    );
    edgesCreated += 1;
  };

  const shortcut = async (folderId: string, targetId: string) => {
    await createEdge(
      { spaceId, fromId: folderId, toId: targetId, relationType: 'shortcut' },
      { db, userId }
    );
    edgesCreated += 1;
  };

  const tag = async (resourceId: string, tagTitle: string) => {
    const r = await tagResource(
      { spaceId, resourceId, tagTitle },
      { db, userId }
    );
    if (r.tag_created) {
      nodesCreated += 1;
    }
    edgesCreated += 1;
    return r.tag_id;
  };

  const describe = async (nodeId: string, body: string) => {
    await setResourceDescription({ spaceId, nodeId, body }, { db, userId });
  };

  const provenance = async (
    nodeId: string,
    source: 'human' | 'imported' | 'ai'
  ) => {
    await setResourceProvenance({ spaceId, nodeId, source }, { db, userId });
  };

  // ── folders (with nesting) ──────────────────────────────────────────────────
  const fApi = await folder('API & Developers');
  const fSdk = await folder('SDKs & Libraries', fApi); // nested
  const fPolicies = await folder('Policies & Security');

  await describe(
    fApi,
    'Reference for integrators: authentication, API keys, and webhooks.'
  );
  await provenance(fApi, 'human');

  // ── text docs (with bodies), placed in folders ──────────────────────────────
  const dAuth = await doc(
    'Authentication',
    [
      'Acme uses short-lived sessions for the dashboard and long-lived API keys for programmatic access.',
      'All write endpoints run under the caller’s row-level security context.',
    ],
    fApi
  );
  const dKeys = await doc(
    'API Keys',
    [
      'API keys are space-scoped and carry a set of permission verbs.',
      'Keys are shown once at creation — store them in your secret manager.',
    ],
    fSdk
  );
  const dWebhooks = await doc(
    'Webhooks',
    [
      'Webhooks fan out domain events to your endpoint; each delivery is signed.',
      'Deliveries are at-least-once — make your handler idempotent.',
    ],
    fSdk
  );
  const dSecurity = await doc(
    'Security Overview',
    [
      'Every resource is space-scoped under row-level security.',
      'Access is decided by RBAC verbs; nothing crosses a space boundary implicitly.',
    ],
    fPolicies
  );

  await describe(
    dAuth,
    'How requests are authenticated: sessions, API keys, and token scopes.'
  );
  await provenance(dSecurity, 'human');
  await provenance(dWebhooks, 'imported');

  // ── link node + URL attribute ───────────────────────────────────────────────
  const linkStatus = await bodyless('link', 'Status page', fPolicies);
  await setResourceLink(
    {
      spaceId,
      nodeId: linkStatus,
      url: 'https://status.acme.com',
      host: 'status.acme.com',
    },
    { db, userId }
  );

  // ── file + video nodes + media-meta (metadata only) ─────────────────────────
  const fileArch = await mediaNode('file', 'Architecture.pdf', fApi, {
    byteSize: 2_400_000,
    mimeType: 'application/pdf',
  });
  await describe(
    fileArch,
    'System architecture diagram: gateway, platform, author, and the event backbone.'
  );
  await provenance(fileArch, 'imported');

  await mediaNode('video', 'Onboarding walkthrough', fApi, {
    durationMs: 760_000, // 12:40
    mimeType: 'video/mp4',
  });

  // ── tags + tagged edges (two-step tag-on-tagging) ───────────────────────────
  await tag(dAuth, 'Developer');
  await tag(dKeys, 'Developer');
  await tag(dSecurity, 'Security');
  await tag(dWebhooks, 'Developer');

  // ── associative relates_to between docs ─────────────────────────────────────
  await relate(dAuth, dKeys);
  await relate(dAuth, dWebhooks);
  await relate(dSecurity, dAuth);

  // ── at least one shortcut (folder→target, Drive-only symlink) ───────────────
  await shortcut(fPolicies, fApi);

  // ── sentinel root LAST: marks the sample as seeded (the dup guard) ───────────
  const sampleRootId = await folder(SAMPLE_ROOT_TITLE);
  await describe(
    sampleRootId,
    'A sample knowledge base seeded to illustrate every capability: folders, nesting, docs, links, media, tags, associations, and shortcuts.'
  );

  return {
    rootFolderIds: [fApi, fPolicies, sampleRootId],
    sampleRootId,
    nodesCreated,
    edgesCreated,
  };
}
