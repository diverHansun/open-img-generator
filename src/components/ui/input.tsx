import * as React from 'react';

import { cn } from '@/lib/utils';

export function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-10 w-full rounded-[var(--radius-md)] border border-input bg-[var(--color-surface-raised)] px-3 text-sm outline-none transition-[border-color,background-color,box-shadow] duration-[var(--duration-fast)] placeholder:text-muted-foreground focus-visible:border-[var(--color-accent-strong)] focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}
