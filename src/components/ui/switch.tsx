'use client';

import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';

import { cn } from '@/lib/utils';

/** Visuals live in globals.css under [data-slot="switch"]. */
export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root data-slot="switch" className={cn(className)} {...props}>
      <SwitchPrimitive.Thumb data-slot="switch-thumb" />
    </SwitchPrimitive.Root>
  );
}
