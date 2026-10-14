import * as React from 'react';

import { cn } from '@/lib/utils';

/** Visuals live in globals.css under [data-slot="input"]. */
export function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return <input type={type} data-slot="input" className={cn(className)} {...props} />;
}
