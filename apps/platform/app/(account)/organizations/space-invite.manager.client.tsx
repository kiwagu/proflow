'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@workspace/ui/components/button';

import { SpaceInviteForm } from '@/app/(account)/organizations/space-invite.form';
import {
  getSpaceSettingsTranslator,
  type SpaceSettingsLocale,
} from '@/app/(account)/space-settings/space-settings.i18n';
import { absoluteSpaceInviteStartUrl } from '@/lib/space-invite.link';
import { revokeSpaceInviteAction } from '@/lib/space-invite.manage.actions';

type CreatedInviteBanner = Readonly<{
  token: string;
  notifyQueued: boolean;
}>;

export type PendingInviteRow = Readonly<{
  id: string;
  email: string;
  roleKey: string;
  roleLabel: string;
  expiresAt: string;
  token: string;
}>;

export type InvitableRoleOption = Readonly<{
  key: string;
  label: string;
}>;

type SpaceInviteManagerClientProps = Readonly<{
  spaceId: string;
  spaceName: string;
  spaceSlug: string;
  locale: SpaceSettingsLocale;
  invitableRoles: readonly InvitableRoleOption[];
  pendingInvites: readonly PendingInviteRow[];
}>;

function formatExpiresAt(iso: string, locale: SpaceSettingsLocale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale);
}

export function SpaceInviteManagerClient({
  spaceId,
  spaceName,
  spaceSlug,
  locale,
  invitableRoles,
  pendingInvites,
}: SpaceInviteManagerClientProps) {
  const router = useRouter();
  const t = useMemo(() => getSpaceSettingsTranslator(locale), [locale]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedForId, setCopiedForId] = useState<string | null>(null);
  const [createdBanner, setCreatedBanner] =
    useState<CreatedInviteBanner | null>(null);
  const [bannerClipboardError, setBannerClipboardError] = useState<
    string | null
  >(null);
  /**
   * After create, show until the token appears in `pendingInvites` (refresh).
   * Once it appeared, hide when the row is gone — derived; no setState in render/effect for that.
   */
  const [inviteBannerAppearedInPending, setInviteBannerAppearedInPending] =
    useState(false);

  const clearCreatedBanner = () => {
    setCreatedBanner(null);
    setBannerClipboardError(null);
    setInviteBannerAppearedInPending(false);
  };

  const tokenInPending =
    createdBanner !== null &&
    pendingInvites.some((i) => i.token === createdBanner.token);

  useEffect(() => {
    if (createdBanner !== null && tokenInPending) {
      queueMicrotask(() => {
        setInviteBannerAppearedInPending(true);
      });
    }
  }, [createdBanner, tokenInPending]);

  const displayCreatedBanner =
    createdBanner === null
      ? null
      : tokenInPending || !inviteBannerAppearedInPending
        ? createdBanner
        : null;

  const label = `${spaceName} (${spaceSlug})`;

  return (
    <div
      className="border-border flex min-w-0 flex-col gap-4 rounded-md border p-4"
      data-testid={`space-invite-manager-${spaceId}`}
    >
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium">{t('inviteManager.title')}</p>
        <p className="text-muted-foreground text-xs">{label}</p>
      </div>

      <p className="text-muted-foreground text-xs">
        {t('inviteManager.manualHint')}
      </p>

      <SpaceInviteForm
        spaceId={spaceId}
        spaceLabel={label}
        locale={locale}
        roleOptions={invitableRoles}
        onInviteCreated={(payload) => {
          setInviteBannerAppearedInPending(false);
          setCreatedBanner(payload);
          setBannerClipboardError(null);
        }}
      />

      {bannerClipboardError ? (
        <p className="text-destructive text-sm" role="alert">
          {bannerClipboardError}
        </p>
      ) : null}

      {displayCreatedBanner ? (
        <div
          className="border-border bg-muted/40 flex w-full max-w-lg min-w-0 flex-col gap-3 rounded-md border p-3 text-xs"
          data-testid={`space-invite-token-banner-${spaceId}`}
        >
          <p className="text-muted-foreground font-medium">
            {displayCreatedBanner.notifyQueued
              ? t('inviteManager.banner.notifyQueued')
              : t('inviteManager.banner.notifyFailed')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                void (async () => {
                  try {
                    const url = absoluteSpaceInviteStartUrl(
                      displayCreatedBanner.token
                    );
                    if (!url) return;
                    await navigator.clipboard.writeText(url);
                    clearCreatedBanner();
                  } catch {
                    setBannerClipboardError(
                      t('inviteManager.errors.clipboard')
                    );
                    window.setTimeout(
                      () => setBannerClipboardError(null),
                      4000
                    );
                  }
                })();
              }}
            >
              {t('inviteManager.actions.copyEmailLink')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                void (async () => {
                  try {
                    await navigator.clipboard.writeText(
                      displayCreatedBanner.token
                    );
                    clearCreatedBanner();
                  } catch {
                    setBannerClipboardError(
                      t('inviteManager.errors.clipboard')
                    );
                    window.setTimeout(
                      () => setBannerClipboardError(null),
                      4000
                    );
                  }
                })();
              }}
            >
              {t('inviteManager.actions.copyToken')}
            </Button>
          </div>
          <pre
            className="text-foreground m-0 max-h-24 w-full overflow-x-auto overflow-y-auto font-mono text-[11px] leading-snug break-all"
            tabIndex={0}
          >
            {displayCreatedBanner.token}
          </pre>
        </div>
      ) : null}

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-medium uppercase">
          {t('inviteManager.pending.title')}
        </p>
        {pendingInvites.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t('inviteManager.pending.empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pendingInvites.map((inv) => (
              <li
                key={inv.id}
                className="border-border flex flex-col gap-3 rounded-md border px-3 py-3 text-sm"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium">{inv.email}</span>
                  <span className="text-muted-foreground text-xs">
                    {t('inviteManager.pending.roleExpires', {
                      roleLabel: inv.roleLabel,
                      expiresAt: formatExpiresAt(inv.expiresAt, locale),
                    })}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void (async () => {
                        try {
                          const url = absoluteSpaceInviteStartUrl(inv.token);
                          if (!url) return;
                          await navigator.clipboard.writeText(url);
                          clearCreatedBanner();
                          setCopiedForId(`${inv.id}-link`);
                          window.setTimeout(() => {
                            setCopiedForId((current) =>
                              current === `${inv.id}-link` ? null : current
                            );
                          }, 2000);
                        } catch {
                          setError(t('inviteManager.errors.clipboard'));
                        }
                      })();
                    }}
                  >
                    {copiedForId === `${inv.id}-link`
                      ? t('inviteManager.actions.linkCopied')
                      : t('inviteManager.actions.copyEmailLink')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void (async () => {
                        try {
                          await navigator.clipboard.writeText(inv.token);
                          clearCreatedBanner();
                          setCopiedForId(`${inv.id}-token`);
                          window.setTimeout(() => {
                            setCopiedForId((current) =>
                              current === `${inv.id}-token` ? null : current
                            );
                          }, 2000);
                        } catch {
                          setError(t('inviteManager.errors.clipboard'));
                        }
                      })();
                    }}
                  >
                    {copiedForId === `${inv.id}-token`
                      ? t('inviteManager.actions.tokenCopied')
                      : t('inviteManager.actions.copyToken')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busyId === inv.id}
                    onClick={() => {
                      void (async () => {
                        setError(null);
                        setBusyId(inv.id);
                        const res = await revokeSpaceInviteAction(inv.id);
                        setBusyId(null);
                        if (!res.ok) {
                          setError(res.message);
                          return;
                        }
                        clearCreatedBanner();
                        router.refresh();
                      })();
                    }}
                  >
                    {t('inviteManager.actions.revoke')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
