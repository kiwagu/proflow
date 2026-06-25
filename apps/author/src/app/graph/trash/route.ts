import config from '@payload-config';
import {
  purgeResourceInputSchema,
  restoreResourceInputSchema,
} from '@workspace/knowledge-contracts';
import { NextResponse } from 'next/server';
import { getPayload } from 'payload';

import { purgeResource, restoreResource } from '@/knowledge/fanout';
import {
  isAuthFailure,
  requireRlsSession,
} from '@/lib/supabase/require-rls-session';

/**
 * Trash lens lifecycle endpoints (ADR-0018). DISTINCT from the resource DELETE
 * (which TRASHES, soft + reversible). These are the two operations reached only
 * from inside the Trash lens:
 *
 *   PATCH  — RESTORE a trashed resource (and its trashed-as-a-unit subtree). Clears
 *            `deleted_at`; references re-admit automatically (dormant edges). Gated
 *            by the owner-sovereign-or-`space.knowledge.delete` authority guard.
 *   DELETE — PURGE: permanently destroy a trashed resource (the one-way door). A
 *            real DELETE under the user's RLS — the landed delete policy + the
 *            in-use guard authorize, the hard orphan-cascade destroys descendants,
 *            a durable audit tombstone outlives the row, and (kind=text) the
 *            Payload body is reaped best-effort AFTER commit.
 *
 * Auth context: the Supabase SESSION (cookies). Postgres RLS + triggers are the
 * SOLE authority — verb/in-use gates are enforced on the row, never here. Zero
 * service-role. THIN transport: delegate to the UI-agnostic application modules.
 */

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = restoreResourceInputSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'Invalid request', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const session = await requireRlsSession(request);
  if (isAuthFailure(session)) {
    return session;
  }
  const { db } = session;

  try {
    const result = await restoreResource(parsed.data, { db });
    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Restore failed.';
    // RLS rejection (not owner, no space.knowledge.delete) → clean failure.
    return NextResponse.json({ message }, { status: 422 });
  }
}

export async function DELETE(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = purgeResourceInputSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'Invalid request', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const session = await requireRlsSession(request);
  if (isAuthFailure(session)) {
    return session;
  }
  const { db } = session;

  try {
    const payload = await getPayload({ config });
    const result = await purgeResource(parsed.data, { db, payload });
    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Purge failed.';
    // The in-use guard (`assert_purge_not_in_use`, ADR-0018 §10.5) rejects purge of a
    // resource still referenced by LIVING cross-owner edges unless the caller holds
    // `space.knowledge.delete` — surfaced so the Trash lens can show the cooperative
    // "in use" state (graceful-absence cannot restore a purged row). The guard raises
    // SQLSTATE 42501 with a stable "(living cross-owner references)" message; detect
    // it and tag the response `reason: 'in-use'`. Any other clean rejection (no delete
    // authority, etc.) stays a generic failure. NOTHING was destroyed either way.
    const inUse =
      message.includes('living cross-owner references') ||
      message.includes('42501');
    return NextResponse.json(
      { message, reason: inUse ? 'in-use' : 'error' },
      { status: 422 }
    );
  }
}
