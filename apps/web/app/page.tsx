import { Button } from '@workspace/ui/components/button';
import { ThemeSwitcher } from '@workspace/ui/components/theme-switcher';
import {
  getGatewayAuthorPath,
  getGatewayPlatformPath,
} from '@workspace/gateway-auth/gateway-paths';

/**
 * Cross-app paths must use <a>, not next/link.
 * Client-side <Link> stays inside this Next.js app; dev rewrites run on full document requests.
 */
export default function Page() {
  const platformPath = getGatewayPlatformPath();
  const authorPath = getGatewayAuthorPath();
  return (
    <div className="flex min-h-svh p-6">
      <div className="flex max-w-md min-w-0 flex-col gap-4 text-sm leading-loose">
        <div>
          <h1 className="font-medium">Project ready!</h1>
          <p>You may now add components and start building.</p>
          <p>We&apos;ve already added the button component for you.</p>
          <div className="mt-2 flex items-center gap-2">
            <ThemeSwitcher />
            <Button>Button</Button>
          </div>
        </div>
        {process.env.NODE_ENV === 'development' ? (
          <div className="rounded-md border p-4 text-xs leading-relaxed">
            <p className="font-medium">Dev gateway</p>
            <p className="text-muted-foreground mt-1">
              This app is the browser entry at <code>/</code>. Other apps are
              mounted under path prefixes (see{' '}
              <code>apps/web/lib/gateway-config.ts</code>).
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>
                <a href={platformPath} className="underline underline-offset-4">
                  Platform (auth) — {platformPath}
                </a>
              </li>
              <li>
                <a href={authorPath} className="underline underline-offset-4">
                  Author — {authorPath}
                </a>
              </li>
            </ul>
          </div>
        ) : null}
        <div className="text-muted-foreground font-mono text-xs">
          (Press <kbd>d</kbd> to toggle dark mode)
        </div>
      </div>
    </div>
  );
}
