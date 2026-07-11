import { connection } from 'next/server';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';

import { AuthButton } from '@/components/auth-button';
import { ExternalGatewayLink } from '@workspace/ui/common/external-gateway-link';
import { Skeleton } from '@workspace/ui/components/skeleton';
import {
  PLATFORM_LOCALE_COOKIE,
  parsePlatformLocale,
  resolvePlatformLocaleFromAcceptLanguage,
} from '@workspace/settings-runtime';
import { EnvVarWarning } from '@/components/env-var-warning';
import { LoginForm } from '@/components/login-form';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { createClient } from '@/lib/supabase/server';
import {
  getServerSpaceSettingsTranslator,
  type SpaceSettingsTranslator,
} from '@/app/(account)/space-settings/space-settings.i18n';
import {
  isPasswordRecoveryPending,
  PASSWORD_RECOVERY_COOKIE,
  PASSWORD_RECOVERY_UPDATE_PASSWORD_PATH,
} from '@/lib/auth/recovery-flow';
import { userNeedsOrganizationBootstrap } from '@/lib/platform-org-bootstrap-gate';
import type { LoginFormCopy } from '@/components/login-form';
import { resolvePlatformLocaleForSession } from '@/lib/runtime-settings.server';
import { createServiceRoleSupabaseClient } from '@/lib/supabase/service-role';
import { ensureInitialPlatformSuperAdminForUser } from '@/lib/super-admin.bootstrap.server';
import { hasEnvVars } from '@/lib/utils';

function buildLoginFormCopy(t: SpaceSettingsTranslator): LoginFormCopy {
  return {
    title: t('auth.login.title'),
    emailLabel: t('auth.login.emailLabel'),
    emailPlaceholder: t('auth.login.emailPlaceholder'),
    passwordLabel: t('auth.login.passwordLabel'),
    forgotPasswordLabel: t('auth.login.forgotPasswordLabel'),
    requiredError: t('auth.login.requiredError'),
    submitLabel: t('auth.login.submitLabel'),
    submitPendingLabel: t('auth.login.submitPendingLabel'),
    signUpPrompt: t('auth.login.signUpPrompt'),
    signUpLabel: t('auth.login.signUpLabel'),
  };
}

function LoginFormFallback() {
  return (
    <Skeleton className="bg-muted/50 h-[280px] w-full rounded-xl" aria-hidden />
  );
}

/**
 * `createClient()` uses `cookies()` — must run inside `<Suspense>` (Next.js blocking route).
 */
async function HomeLoginArea() {
  await connection();
  const acceptLanguage = (await headers()).get('accept-language');
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get(PLATFORM_LOCALE_COOKIE)?.value ?? null;
  const recoveryCookie = cookieStore.get(PASSWORD_RECOVERY_COOKIE)?.value;
  if (isPasswordRecoveryPending(recoveryCookie)) {
    redirect(PASSWORD_RECOVERY_UPDATE_PASSWORD_PATH);
  }

  if (!hasEnvVars) {
    const fallbackLocale =
      parsePlatformLocale(localeCookie) ??
      resolvePlatformLocaleFromAcceptLanguage(acceptLanguage);
    const t = await getServerSpaceSettingsTranslator(fallbackLocale);

    return <LoginForm copy={buildLoginFormCopy(t)} />;
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (userData.user) {
    await ensureInitialPlatformSuperAdminForUser(supabase, userData.user);

    if (
      await userNeedsOrganizationBootstrap(
        supabase,
        userData.user.id,
        userData.user.email
      )
    ) {
      redirect('/onboarding');
    }
    redirect('/profile');
  }

  const locale = await resolvePlatformLocaleForSession(
    createServiceRoleSupabaseClient(),
    {
      acceptLanguage,
      localeCookie: null,
      userId: null,
    }
  );
  const t = await getServerSpaceSettingsTranslator(locale);

  return <LoginForm copy={buildLoginFormCopy(t)} />;
}

/**
 * Platform root: login for guests; signed-in users go to /onboarding (no org yet) or /profile.
 * Links to / and /author are other Next apps — use <a> (see gateway docs).
 */
export default function Home() {
  return (
    <main className="flex min-h-svh flex-col">
      <nav className="border-b-foreground/10 flex h-16 w-full shrink-0 justify-center border-b">
        <div className="flex w-full max-w-5xl items-center justify-between p-3 px-5 text-sm">
          <div className="flex items-center gap-5 font-semibold">
            <ExternalGatewayLink href="/" className="hover:underline">
              Proflow
            </ExternalGatewayLink>
          </div>
          {!hasEnvVars ? (
            <EnvVarWarning />
          ) : (
            <Suspense>
              <AuthButton />
            </Suspense>
          )}
        </div>
      </nav>

      <div className="flex flex-1 flex-col items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm">
          <Suspense fallback={<LoginFormFallback />}>
            <HomeLoginArea />
          </Suspense>
        </div>
      </div>

      <footer className="mx-auto flex w-full shrink-0 items-center justify-center gap-8 border-t py-8 text-center text-xs">
        <p>
          Powered by{' '}
          <a
            href="https://supabase.com/?utm_source=create-next-app&utm_medium=template&utm_term=nextjs"
            target="_blank"
            className="font-bold hover:underline"
            rel="noreferrer"
          >
            Supabase
          </a>
        </p>
        <ThemeSwitcher />
      </footer>
    </main>
  );
}
