import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { Skeleton } from '@workspace/ui/components/skeleton';

import { userNeedsOrganizationBootstrap } from '@/lib/platform-org-bootstrap-gate';
import { ensureInitialPlatformSuperAdminForUser } from '@/lib/super-admin.bootstrap.server';
import { createClient } from '@/lib/supabase/server';

import { bootstrapOrganizationAction } from './organization.bootstrap.actions';
import { OrganizationBootstrapForm } from './organization.bootstrap.form';

function OnboardingFallback() {
  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 p-6">
      <Skeleton className="bg-muted/50 h-40 w-full rounded-xl" aria-hidden />
      <Skeleton
        className="bg-muted/50 h-[280px] w-full rounded-xl"
        aria-hidden
      />
    </main>
  );
}

/**
 * `createClient()` uses `cookies()` — must run inside `<Suspense>` (Next.js blocking route).
 */
async function OnboardingContent() {
  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    redirect('/auth/login');
  }

  await ensureInitialPlatformSuperAdminForUser(supabase, userData.user);

  if (
    !(await userNeedsOrganizationBootstrap(
      supabase,
      userData.user.id,
      userData.user.email
    ))
  ) {
    redirect('/');
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Create your organization
        </h1>
        <p className="text-muted-foreground text-sm">
          You need an organization and a space before using the platform. This
          creates your first Space and assigns you as organization admin.
        </p>
      </div>
      <OrganizationBootstrapForm
        onSubmitBootstrap={bootstrapOrganizationAction}
      />
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<OnboardingFallback />}>
      <OnboardingContent />
    </Suspense>
  );
}
