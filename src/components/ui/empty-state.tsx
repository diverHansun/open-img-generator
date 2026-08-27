import * as React from 'react';

import { cn } from '@/lib/utils';

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'grid min-h-48 content-center justify-items-start gap-3 border-y border-border py-10',
        className,
      )}
    >
      <h2 className="m-0 text-lg font-semibold text-foreground">{title}</h2>
      {description ? (
        <p className="m-0 max-w-xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </section>
  );
}
