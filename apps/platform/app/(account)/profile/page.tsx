import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { cookies, headers } from 'next/headers';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldTitle,
} from '@workspace/ui/components/field';
import { TwoColumnLayout } from '@workspace/ui/components/two-column-layout';
import {
  PLATFORM_LOCALE_COOKIE,
  RUNTIME_SETTING_KEYS,
} from '@workspace/settings-runtime';

import { RuntimeSettingSelectForm } from '@/components/runtime-setting-select-form';
import {
  getSpaceSettingsLocaleOptions,
  getServerSpaceSettingsTranslator,
} from '@/app/(account)/space-settings/space-settings.i18n';
import { userNeedsOrganizationBootstrap } from '@/lib/platform-org-bootstrap-gate';
import { loadProfileWorkspaceContext } from '@/lib/profile-workspace-context';
import {
  getScopedRuntimeSettingValue,
  resolveScopedPlatformLocaleValue,
  resolvePlatformLocaleForSession,
} from '@/lib/runtime-settings.server';
import { loadPendingSpaceInvitesForUser } from '@/lib/space-invite.pending.server';
import { createClient } from '@/lib/supabase/server';

import { ProfileForm } from './profile.form';
import { ProfileWorkspaceView } from './profile.workspace.view';
import { updateProfileAction } from './profile.actions';
import type { ProfileFormValues } from './profile.schema';

function ProfileFallback() {
  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <div className="bg-muted/50 h-[420px] w-full animate-pulse rounded-xl" />
    </div>
  );
}

async function ProfileContent() {
  await connection();
  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    redirect('/');
  }

  const userId = userData.user.id;
  const userEmail = userData.user.email ?? '';

  if (await userNeedsOrganizationBootstrap(supabase, userId, userEmail)) {
    redirect('/onboarding');
  }

  const { data: profileData } = await supabase
    .from('profiles')
    .select('email, display_name, avatar_url, bio, entity_id')
    .eq('user_id', userId)
    .maybeSingle();

  const initialValues: ProfileFormValues = {
    email: profileData?.email ?? userEmail,
    display_name: profileData?.display_name ?? '',
    avatar_url: profileData?.avatar_url ?? '',
    bio: profileData?.bio ?? '',
  };

  const workspace = await loadProfileWorkspaceContext(supabase, userId);
  const pendingSpaceInvites = await loadPendingSpaceInvitesForUser(
    supabase,
    userData.user
  );
  const activeSpaceId =
    workspace.kind === 'ok' ? workspace.activeSpace?.spaceId : null;
  const organizationId =
    workspace.kind === 'ok' ? workspace.activeSpace?.organizationId : null;
  const locale = await resolvePlatformLocaleForSession(supabase, {
    acceptLanguage: (await headers()).get('accept-language'),
    localeCookie: (await cookies()).get(PLATFORM_LOCALE_COOKIE)?.value ?? null,
    userId,
    activeSpaceId,
    organizationId,
  });
  const t = await getServerSpaceSettingsTranslator(locale);
  const userLocale = await getScopedRuntimeSettingValue(
    supabase,
    'user',
    userId,
    RUNTIME_SETTING_KEYS.platformLocale
  );
  const localeOptions = getSpaceSettingsLocaleOptions(t);

  return (
    <TwoColumnLayout
      left={
        <Card data-testid="profile-card">
          <CardHeader>
            <CardTitle className="text-2xl">Profile</CardTitle>
            <CardDescription>
              Manage your account details in one place.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm
              initialValues={initialValues}
              userId={userId}
              onSubmitProfile={updateProfileAction}
            />
          </CardContent>
        </Card>
      }
      right={
        <>
          <Card data-testid="profile-account-id-card">
            <CardHeader>
              <CardTitle>Account id</CardTitle>
              <CardDescription>
                Your user id can be useful for debugging integrations.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldTitle className="text-muted-foreground text-xs font-normal">
                    Entity id
                  </FieldTitle>
                  <FieldContent>
                    <pre
                      className="border-input bg-background text-foreground overflow-auto rounded-md border p-3 font-mono text-xs shadow-xs"
                      tabIndex={0}
                    >
                      {profileData?.entity_id ?? ''}
                    </pre>
                  </FieldContent>
                </Field>
                <Field>
                  <FieldTitle className="text-muted-foreground text-xs font-normal">
                    Auth user id
                  </FieldTitle>
                  <FieldContent>
                    <pre
                      className="border-input bg-background text-foreground overflow-auto rounded-md border p-3 font-mono text-xs shadow-xs"
                      tabIndex={0}
                    >
                      {userId}
                    </pre>
                  </FieldContent>
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card data-testid="profile-language-card">
            <CardHeader>
              <CardTitle>{t('profile.preferences.title')}</CardTitle>
              <CardDescription>
                {t('profile.preferences.description')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RuntimeSettingSelectForm
                allowInherit
                currentValue={resolveScopedPlatformLocaleValue(userLocale, {
                  allowInherit: true,
                  source: 'user scope',
                })}
                description={t(
                  'runtimeSettings.platformLocale.description.user'
                )}
                fieldLabel={t('runtimeSettings.platformLocale.fieldLabel')}
                inheritOptionLabel={t(
                  'runtimeSettings.platformLocale.inherit.user'
                )}
                revalidatePath="/profile"
                scope="user"
                scopeId={userId}
                settingKey={RUNTIME_SETTING_KEYS.platformLocale}
                submitLabel={t('runtimeSettings.actions.save')}
                successMessage={t('runtimeSettings.messages.saved')}
                options={localeOptions}
                testId="profile-platform-locale"
              />
            </CardContent>
          </Card>

          <ProfileWorkspaceView
            workspace={workspace}
            pendingSpaceInvites={pendingSpaceInvites}
          />
        </>
      }
      className="flex-1"
    />
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<ProfileFallback />}>
      <ProfileContent />
    </Suspense>
  );
}
