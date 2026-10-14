'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  closeLabel,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { closeLabel: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/18" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 grid w-[min(92vw,38rem)] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-[var(--surface-radius)] border border-[var(--glass-edge)] bg-[var(--glass-raised)] p-4 shadow-[var(--shadow)] [backdrop-filter:var(--glass-blur)] [-webkit-backdrop-filter:var(--glass-blur)] outline-none',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 grid size-7 place-items-center rounded-[7px] border-0 bg-transparent text-[var(--muted)] outline-none transition-colors hover:bg-[var(--pill)] hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--fg)]">
          <X className="size-3.5" />
          <span className="sr-only">{closeLabel}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const DialogHeader = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div className={cn('grid gap-1', className)} {...props} />
);
export const DialogTitle = ({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title
    className={cn('text-[14px] font-semibold tracking-[-0.01em] text-[var(--fg)]', className)}
    {...props}
  />
);
export const DialogDescription = ({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description
    className={cn('text-[12px] text-[var(--muted)]', className)}
    {...props}
  />
);
