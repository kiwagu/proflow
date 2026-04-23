'use client';

import { authorApiPath } from '@/lib/platform-login';
import {
  clearSupabaseBrowserSession,
  getSupabaseBrowserClient,
} from '@/lib/supabase-browser';
import { Button, useTranslation } from '@payloadcms/ui';

export default function AdminLogoutButton() {
  const { t } = useTranslation();

  return (
    <Button
      buttonStyle="icon-label"
      className="nav__log-out"
      onClick={() => {
        const supabase = getSupabaseBrowserClient();

        const fullLogout = fetch(authorApiPath('/api/auth/full-logout'), {
          credentials: 'include',
          method: 'POST',
        }).catch(() => null);
        const supabaseLogout = supabase
          ? supabase.auth.signOut({ scope: 'global' }).catch(() => null)
          : Promise.resolve(null);

        void Promise.all([fullLogout, supabaseLogout]).finally(() => {
          clearSupabaseBrowserSession();
          // After clearing both sessions, go to author root; proxy will 307 to platform sign-in.
          window.location.assign(authorApiPath('/'));
        });
      }}
    >
      {t('authentication:logOut')}
    </Button>
  );
}
