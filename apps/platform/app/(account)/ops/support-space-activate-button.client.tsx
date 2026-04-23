'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@workspace/ui/components/button';

import { setActiveSpaceAction } from '@/lib/space.active.actions';

type SupportSpaceActivateButtonProps = Readonly<{
  spaceId: string;
  label: string;
}>;

export function SupportSpaceActivateButton({
  spaceId,
  label,
}: SupportSpaceActivateButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function activateSupportContext(): Promise<void> {
    setError(null);

    const result = await setActiveSpaceAction(spaceId);
    if (!result.ok) {
      setError(result.message);
      return;
    }

    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => {
          startTransition(() => {
            void activateSupportContext();
          });
        }}
      >
        {label}
      </Button>
      {error ? (
        <p className="text-destructive text-right text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
