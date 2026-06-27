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
// fallback. Cookies emit no change event, so `subscribe` is a no-op; the snapshot is
// re-read on every render (React polls it), which mirrors the prior effect that
// re-read on each sync-state change. `getServerSnapshot` returns null to match SSR
// (useSyncExternalStore re-syncs to the real value after hydration — no mismatch).
function subscribeToCookie(): () => void {
  return () => {};
}

function readActiveSpaceCookieSnapshot(): string | null {
  return (
    readBrowserCookie(PAYLOAD_TENANT_COOKIE) ??
    readBrowserCookie(ACTIVE_SPACE_COOKIE)
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
  const { options, selectedTenantID, setTenant } = useTenantSelection();
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

    if (optionIds.length === 0) {
      return;
    }

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
  }, [optionIds.length]);

  useEffect(() => {
    if (!authoritativeActiveSpaceId) {
      initialSelectionAppliedRef.current = true;
      return;
    }

    if (!optionIds.includes(authoritativeActiveSpaceId)) {
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
  ]);

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

    persistedSelectionRef.current = selectedTenant;
    void persistActiveSpace(selectedTenant);
  }, [optionIds, optionIdsKey, selectedTenant]);

  return (
    <span className="sr-only" data-testid="author-active-space-id">
      {authoritativeActiveSpaceId ?? selectedTenant ?? cookieSpaceId ?? ''}
    </span>
  );
}
