import Link from 'next/link';
import { Button } from '@workspace/ui/components/button';
import { createClient } from '@/lib/supabase/server';
import { LogoutButton } from './logout-button';

export async function AuthButton() {
  const supabase = await createClient();

  // You can also use getUser() which will be slower.
  const { data } = await supabase.auth.getClaims();

  const user = data?.claims;

  return user ? (
    <div className="flex items-center gap-4" data-testid="auth-user-menu">
      Hey, {user.email}!
      <LogoutButton />
    </div>
  ) : (
    <div className="flex gap-2" data-testid="auth-guest-menu">
      <Button asChild size="sm" variant={'outline'}>
        <Link href="/" data-testid="auth-guest-sign-in-link">
          Sign in
        </Link>
      </Button>
      <Button asChild size="sm" variant={'default'}>
        <Link href="/auth/sign-up" data-testid="auth-guest-sign-up-link">
          Sign up
        </Link>
      </Button>
    </div>
  );
}
