'use client';

import { ACTIVE_SPACE_COOKIE } from '@workspace/gateway-auth/active-space.constants';
import { useTenantSelection } from '@payloadcms/plugin-multi-tenant/client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { authorApiPath } from '@/lib/platform-login';

type ActiveSpaceResponse = {
  spaceId?: unknown;
};

type TenantOption = {
  value?: number | string | null;
};

const PAYLOAD_TENANT_COOKIE = 'payload-tenant';

function normalizeTenantId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function waitForNextAttempt(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function readBrowserCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  for (const rawPart of document.cookie.split(';')) {
    const [rawName, ...rawValueParts] = rawPart.trim().split('=');
    if (rawName !== name) {
      continue;
    }

    const value = rawValueParts.join('=').trim();
    if (!value) {
      return null;
    }

    return decodeURIComponent(value);
  }

  return null;
}

// The active-space cookie is an external (DOM) store read as a last-resort display
// fallback. Cookies emit no change event, so the subscription POLLS: the callback
// fires on an interval and React re-reads the snapshot (re-rendering only when the
// value actually changed). A no-op subscribe here FROZE the fallback on the value
// of the first render — the span kept showing the PREVIOUS space after the proxy
// re-synced the cookie (the flaky author-space-sync drift). `getServerSnapshot`
// returns null to match SSR (re-synced after hydration — no mismatch).
const COOKIE_POLL_INTERVAL_MS = 300;

function subscribeToCookie(onStoreChange: () => void): () => void {
  const timer = window.setInterval(onStoreChange, COOKIE_POLL_INTERVAL_MS);
  return () => window.clearInterval(timer);
}

// Read the CANONICAL cross-app active-space cookie FIRST, the payload-tenant
// cookie only as a fallback. `pf_active_space_id` is the source of truth (owned by
// the platform, kept correct by the proxy + the active-space route); `payload-tenant`
// is managed AUTONOMOUSLY by the multi-tenant plugin off the LAGGING payload user
// mirror, so it trails a fresh space switch. Reading canonical first makes the span
// track the truth, not the plugin's transient view.
function readActiveSpaceCookieSnapshot(): string | null {
  return (
    readBrowserCookie(ACTIVE_SPACE_COOKIE) ??
    readBrowserCookie(PAYLOAD_TENANT_COOKIE)
  );
}

function readActiveSpaceCookieServerSnapshot(): string | null {
  return null;
}

async function readAuthoritativeActiveSpace(): Promise<string | null> {
  const response = await fetch(authorApiPath('/api/auth/active-space'), {
    cache: 'no-store',
    credentials: 'include',
    headers: {
      'Cache-Control': 'no-store',
    },
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Active-space sync failed: ${response.status}`);
  }

  const body = (await response
    .json()
    .catch(() => null)) as ActiveSpaceResponse | null;

  return normalizeTenantId(body?.spaceId);
}

async function persistActiveSpace(spaceId: string): Promise<void> {
  await fetch(authorApiPath('/api/auth/active-space'), {
    body: JSON.stringify({ spaceId }),
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export function AuthorActiveSpaceSyncClient() {
  const { options, selectedTenantID, setTenant, syncTenants } =
    useTenantSelection();
  const [authoritativeActiveSpaceId, setAuthoritativeActiveSpaceId] = useState<
    string | null
  >(null);
  const cookieSpaceId = useSyncExternalStore(
    subscribeToCookie,
    readActiveSpaceCookieSnapshot,
    readActiveSpaceCookieServerSnapshot
  );
  const initialServerSyncDoneRef = useRef(false);
  const initialSelectionAppliedRef = useRef(false);
  const persistedSelectionRef = useRef<string | null>(null);
  // True once the plugin's OWN selection has caught up to the authoritative
  // (canonical) value at least once. Until then, a `selectedTenant` that differs
  // from authoritative is the multi-tenant plugin's mirror-lag AUTO-FALLBACK — it
  // defaults to the single MIRRORED option while the space-org worker is still
  // populating the payload user's `tenants` array — NOT a user choice. Persisting
  // that fallback POSTs it to `/active-space` and pushes the canonical cookie
  // BACKWARDS (e.g. second-space → primary), corrupting the cross-app source of
  // truth so the admin sticks on the wrong space forever. Only a divergence AFTER
  // convergence is a real author-admin tenant switch worth propagating.
  const pluginConvergedRef = useRef(false);

  const optionIds = (options as TenantOption[])
    .map((option) => normalizeTenantId(option.value))
    .filter((value): value is string => value !== null);
  const optionIdsKey = optionIds.join('|');
  const selectedTenant = normalizeTenantId(selectedTenantID);

  // The one-shot server sync below must run EXACTLY once (after options appear), so
  // it must NOT list `selectedTenant` as a dep — that would re-fire it on every
  // selection change. It still needs the LATEST selection at the moment it resolves,
  // so we read it through a ref kept current each render (preserving the run-once
  // intent while satisfying exhaustive-deps).
  const selectedTenantRef = useRef(selectedTenant);
  useEffect(() => {
    selectedTenantRef.current = selectedTenant;
  });

  useEffect(() => {
    if (initialServerSyncDoneRef.current) {
      return;
    }

    // Deliberately NOT gated on `optionIds.length` — the server read needs no
    // options, and gating on them DISABLED the sync exactly when it matters
    // (a lagging tenant mirror renders with empty options; the old guard then
    // never ran the GET at all — the author-space-sync drift).

    let cancelled = false;

    const syncFromServerOnce = async () => {
      const retryDelaysMs = [0, 250, 500, 1_000, 2_000];

      try {
        for (const delayMs of retryDelaysMs) {
          if (delayMs > 0) {
            await waitForNextAttempt(delayMs);
          }

          if (cancelled) {
            return;
          }

          const nextAuthoritativeSpaceId = await readAuthoritativeActiveSpace();
          if (cancelled) {
            return;
          }

          if (!nextAuthoritativeSpaceId && !selectedTenantRef.current) {
            continue;
          }

          persistedSelectionRef.current = nextAuthoritativeSpaceId;
          setAuthoritativeActiveSpaceId(nextAuthoritativeSpaceId);
          return;
        }

        setAuthoritativeActiveSpaceId(
          (current) => current ?? selectedTenantRef.current
        );
      } catch {
        if (cancelled) {
          return;
        }
      } finally {
        if (!cancelled) {
          initialServerSyncDoneRef.current = true;
          initialSelectionAppliedRef.current = true;
        }
      }
    };

    void syncFromServerOnce();

    return () => {
      cancelled = true;
    };
    // Mount-once: the one-shot needs no deps (options are NOT a prerequisite).
  }, []);

  // The authoritative id we already asked the plugin to refetch options for —
  // guards the syncTenants() call below against firing on every render.
  const tenantsRefetchRequestedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!authoritativeActiveSpaceId) {
      initialSelectionAppliedRef.current = true;
      return;
    }

    if (!optionIds.includes(authoritativeActiveSpaceId)) {
      // The tenant OPTIONS lag behind the memberships (the payload mirror is
      // written asynchronously by the space-org worker): ask the plugin to
      // refetch them from the DB (`populate-tenant-options`), once per
      // authoritative value. When the refreshed options arrive this effect
      // re-runs and applies the selection below.
      if (
        tenantsRefetchRequestedForRef.current !== authoritativeActiveSpaceId
      ) {
        tenantsRefetchRequestedForRef.current = authoritativeActiveSpaceId;
        void syncTenants();
      }
      return;
    }

    if (selectedTenant === authoritativeActiveSpaceId) {
      initialSelectionAppliedRef.current = true;
      return;
    }

    initialSelectionAppliedRef.current = true;
    setTenant({ id: authoritativeActiveSpaceId, refresh: true });
  }, [
    authoritativeActiveSpaceId,
    optionIds,
    optionIdsKey,
    selectedTenant,
    setTenant,
    syncTenants,
  ]);

  // Mark convergence: the plugin's selection now equals the authoritative value.
  // From here a later divergence is a deliberate in-admin tenant switch.
  useEffect(() => {
    if (
      authoritativeActiveSpaceId &&
      selectedTenant === authoritativeActiveSpaceId
    ) {
      pluginConvergedRef.current = true;
    }
  }, [authoritativeActiveSpaceId, selectedTenant]);

  useEffect(() => {
    if (!initialSelectionAppliedRef.current) {
      return;
    }

    if (!selectedTenant || !optionIds.includes(selectedTenant)) {
      return;
    }

    if (persistedSelectionRef.current === selectedTenant) {
      return;
    }

    // Never persist the plugin's pre-convergence mirror-lag fallback — that POST
    // would overwrite the canonical active-space BACKWARDS (the flaky drift).
    // Only propagate a selection that diverged AFTER the plugin already matched
    // the authoritative value (a real user switch in the admin tenant selector).
    if (
      selectedTenant !== authoritativeActiveSpaceId &&
      !pluginConvergedRef.current
    ) {
      return;
    }

    persistedSelectionRef.current = selectedTenant;
    void persistActiveSpace(selectedTenant);
  }, [optionIds, optionIdsKey, selectedTenant, authoritativeActiveSpaceId]);

  // Display priority = closeness to the canonical source of truth, freshest first:
  //   1. the LIVE canonical cookie (polled ~300ms; the truth, updates on any switch)
  //   2. the server-validated authoritative id (one-shot GET; slower, set once)
  //   3. the plugin's own selection (LAST — it trails the mirror and can show a
  //      stale space right after a switch). Putting the plugin ahead of the live
  //      cookie made the span display a lagging space while the async GET was still
  //      in flight (the reverse-direction span flake).
  return (
    <span className="sr-only" data-testid="author-active-space-id">
      {cookieSpaceId ?? authoritativeActiveSpaceId ?? selectedTenant ?? ''}
    </span>
  );
}
