'use client';

import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';

import { cn } from '@/lib/utils';

export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface-strong)] outline-none transition-[background-color,border-color,box-shadow] duration-[var(--duration-fast)] data-[state=checked]:border-[var(--color-accent-strong)] data-[state=checked]:bg-primary focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-5 translate-x-px rounded-full border border-border bg-[var(--color-surface-raised)] shadow-[var(--shadow-thumb)] transition-transform duration-[var(--duration-fast)] data-[state=checked]:translate-x-[19px]"
      />
    </SwitchPrimitive.Root>
  );
}
