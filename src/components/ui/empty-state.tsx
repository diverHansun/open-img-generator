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
        'flex flex-col items-center justify-center gap-1.5 px-5 py-12 text-center',
        className,
      )}
    >
      <h2 className="m-0 text-[13px] font-medium text-[var(--fg)]">{title}</h2>
      {description ? (
        <p className="m-0 max-w-md text-[12px] leading-[1.45] text-[var(--muted)]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </section>
  );
}
