import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';

import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'default' | 'sm' | 'icon';

/**
 * Visuals live in globals.css under [data-slot="button"] keyed by
 * data-variant / data-size, so there is one source of truth for the look.
 */
export function Button({
  className,
  variant = 'primary',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & {
  variant?: ButtonVariant | null;
  size?: ButtonSize | null;
  asChild?: boolean;
}) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      data-slot="button"
      data-variant={variant ?? 'primary'}
      data-size={size ?? 'default'}
      className={cn(className)}
      {...props}
    />
  );
}
