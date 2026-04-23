import * as React from 'react';

import { cn } from '@workspace/ui/lib/utils';

export type TwoColumnLayoutProps = Readonly<{
  left: React.ReactNode;
  right: React.ReactNode;
  className?: string;
}>;

export function TwoColumnLayout({
  left,
  right,
  className,
}: TwoColumnLayoutProps) {
  return (
    <div
      className={cn('grid w-full grid-cols-1 gap-6 md:grid-cols-2', className)}
    >
      <div className="flex min-w-0 flex-col gap-6">{left}</div>
      <div className="flex min-w-0 flex-col gap-6">{right}</div>
    </div>
  );
}
