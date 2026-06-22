import { ACTIVE_SPACE_COOKIE } from '@workspace/gateway-auth/active-space.constants';
import type { Access, CollectionConfig, PayloadRequest, Where } from 'payload';

import { createRlsClientFromCookieHeader } from '@/lib/supabase/rls-from-request';

/**
 * `bodies` — the ONE projection-agnostic Lexical-body collection (ADR-0005
 * Invariant #1). One Lexical doc = one body of a `kind=text` knowledge node.
 * Holds ONLY the bridge keys + the body; ZERO article/course/document fields.
 *
 * Authority is the node, not the body (ADR-0002 §1). Payload access here is
 * SUBORDINATE to Postgres RLS (§3.3, discipline A): read/update/delete reduce to
 * a Postgres-RLS check keyed on `node_id` under the user's own JWT — if RLS
 * returns no `knowledge_resources` row for that node, access is `false`. `create`
 * is closed to the admin UI; the body is born only through the application
 * fan-out (which already INSERTed the node under RLS). The multiTenant `tenant`
 * scope is a UX narrowing, NOT a second access authority.
 */

const PAYLOAD_TENANT_COOKIE = 'payload-tenant';

function readCookieValue(
  req: PayloadRequest,
  cookieName: string
): string | null {
  const cookieHeader = req.headers.get('cookie');
  if (!cookieHeader) {
    return null;
  }
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) {
      continue;
    }
    const name = part.slice(0, eq).trim();
    if (name !== cookieName) {
      continue;
    }
    const value = part.slice(eq + 1).trim();
    return value.length > 0 ? decodeURIComponent(value) : null;
  }
  return null;
}

function resolveTenantId(value: unknown): string | null {
  if (typeof value === 'string') {
    const tenantId = value.trim();
    return tenantId.length > 0 ? tenantId : null;
  }
  if (
    value &&
    typeof value === 'object' &&
    'id' in value &&
    typeof (value as { id?: unknown }).id === 'string'
  ) {
    const tenantId = (value as { id: string }).id.trim();
    return tenantId.length > 0 ? tenantId : null;
  }
  return null;
}

/** Node ids the caller may read under THEIR RLS session (empty ⇒ no access). */
async function rlsVisibleNodeIds(
  req: PayloadRequest,
  nodeIds?: string[]
): Promise<string[]> {
  const db = createRlsClientFromCookieHeader(req.headers.get('cookie'));
  let query = db.from('knowledge_resources').select('id').eq('kind', 'text');
  if (nodeIds && nodeIds.length > 0) {
    query = query.in('id', nodeIds);
  }
  const { data, error } = await query;
  if (error || !data) {
    return [];
  }
  return data.map((row) => row.id);
}

/** Does the caller's RLS session see this single node? (discipline A.) */
async function rlsCanAccessNode(
  req: PayloadRequest,
  nodeId: string | null | undefined
): Promise<boolean> {
  if (!nodeId) {
    return false;
  }
  const visible = await rlsVisibleNodeIds(req, [nodeId]);
  return visible.includes(nodeId);
}

/**
 * read access: subordinate to Postgres RLS by `node_id`.
 * - single-doc read (`id` present): resolve the doc's `node_id`, check RLS.
 * - collection read: return a `Where` keyed on the RLS-visible node id set, so
 *   the body list can never reveal a body whose node RLS hides. The in-list is
 *   itself produced by an RLS query — Postgres remains the authority.
 */
const readAccess: Access = async ({ req, id }) => {
  if (!req.user) {
    return false;
  }

  if (id != null) {
    const doc = await req.payload.findByID({
      collection: 'bodies',
      id: String(id),
      req,
      depth: 0,
      overrideAccess: true,
    });
    const nodeId = doc && typeof doc.node_id === 'string' ? doc.node_id : null;
    return rlsCanAccessNode(req, nodeId);
  }

  const visible = await rlsVisibleNodeIds(req);
  if (visible.length === 0) {
    return false;
  }
  const where: Where = { node_id: { in: visible } };
  return where;
};

/** update/delete: the caller must pass the node's Postgres-RLS gate. */
const mutateExistingAccess: Access = async ({ req, id }) => {
  if (!req.user || id == null) {
    return false;
  }
  const doc = await req.payload.findByID({
    collection: 'bodies',
    id: String(id),
    req,
    depth: 0,
    overrideAccess: true,
  });
  const nodeId = doc && typeof doc.node_id === 'string' ? doc.node_id : null;
  return rlsCanAccessNode(req, nodeId);
};

/**
 * create: closed to the admin UI. The body is created only by the application
 * fan-out via the Local API with `overrideAccess` (after the node INSERT passed
 * RLS). A direct admin `create` without a node has no authority and is denied.
 */
const createAccess: Access = () => false;

export const Bodies: CollectionConfig = {
  slug: 'bodies',
  admin: {
    useAsTitle: 'node_id',
    description:
      'Lexical bodies for kind=text knowledge nodes. Authority is the node (Postgres); access is subordinate to RLS by node_id.',
  },
  access: {
    read: readAccess,
    create: createAccess,
    update: mutateExistingAccess,
    delete: mutateExistingAccess,
  },
  versions: {
    drafts: true,
    // Cap revision history per body (owner decision); Payload prunes the oldest
    // beyond this on each new version (there is no per-version delete API).
    maxPerDoc: 10,
  },
  hooks: {
    beforeChange: [
      ({ data, originalDoc, req }) => {
        const tenantFromCookies =
          readCookieValue(req, PAYLOAD_TENANT_COOKIE) ??
          readCookieValue(req, ACTIVE_SPACE_COOKIE);
        const tenantId =
          resolveTenantId(data?.tenant) ??
          resolveTenantId(originalDoc?.tenant) ??
          resolveTenantId(data?.space_id) ??
          resolveTenantId(originalDoc?.space_id) ??
          resolveTenantId(tenantFromCookies);

        if (!tenantId) {
          return data;
        }

        // space_id is a DERIVED mirror of the node's space (a stable text
        // back-ref key); `tenant` is the multiTenant relationship (UX scope).
        // Neither is the access authority — that stays Postgres RLS by node_id.
        return {
          ...(data ?? {}),
          tenant: data?.tenant ?? tenantId,
          space_id: data?.space_id ?? tenantId,
        };
      },
    ],
  },
  fields: [
    {
      name: 'node_id',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        readOnly: true,
        description:
          'Back-ref to knowledge_resources.id (knr_…). One body per node.',
      },
    },
    {
      name: 'space_id',
      type: 'text',
      required: true,
      index: true,
      admin: {
        readOnly: true,
        description:
          'Mirror of the node space (tenant consistency). Derived, not authoritative.',
      },
    },
    {
      name: 'body',
      type: 'richText',
    },
  ],
};
