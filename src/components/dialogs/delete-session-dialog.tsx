'use client';

import * as React from 'react';
import { LoaderCircle } from 'lucide-react';

import { useLocale } from '@/components/i18n/locale-provider';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ApiClientError, getBrowserWebClientRuntime, type DeletedSession } from '@/lib/web-client';

export type DeleteSessionTarget = {
  id: string;
  name: string;
  /** Known in History; omitted where only the session itself is loaded. */
  counts?: { generations: number; images: number };
};

/** Confirms, then deletes a session and everything generated in it. */
export function DeleteSessionDialog({
  target,
  onOpenChange,
  onDeleted,
}: {
  target: DeleteSessionTarget | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: (deleted: DeletedSession) => void;
}) {
  const { t } = useLocale();
  const runtime = React.useMemo(() => getBrowserWebClientRuntime(), []);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPending(false);
    setError(null);
  }, [target?.id]);

  const confirm = async () => {
    if (!target || pending) return;
    setPending(true);
    setError(null);
    try {
      const deleted = await runtime.client.deleteSession(target.id);
      onDeleted(deleted);
    } catch (cause) {
      setError(
        t(
          cause instanceof ApiClientError && cause.status === 409
            ? 'dialogs.deleteSessionBusy'
            : 'dialogs.deleteSessionError',
        ),
      );
    } finally {
      setPending(false);
    }
  };

  const counts = target?.counts;

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!pending) onOpenChange(open);
      }}
    >
      {target ? (
        <DialogContent closeLabel={t('dialogs.close')} className="w-[min(92vw,26rem)]">
          <DialogHeader className="pr-8">
            <DialogTitle>{t('dialogs.deleteSessionTitle', { name: target.name })}</DialogTitle>
            <DialogDescription className="leading-[1.5]">
              {counts
                ? counts.generations > 0
                  ? t('dialogs.deleteSessionCounts', counts) + ' '
                  : t('dialogs.deleteSessionEmpty') + ' '
                : null}
              {t('dialogs.deleteSessionBody')}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="m-0 text-[12px] text-[var(--red)]">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {t('dialogs.cancelAction')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() => void confirm()}
            >
              {pending ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : null}
              {t(pending ? 'dialogs.deletingSession' : 'dialogs.deleteSessionConfirm')}
            </Button>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
