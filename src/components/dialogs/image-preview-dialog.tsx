'use client';

import * as React from 'react';
import { ArrowRight, ImageOff } from 'lucide-react';

import { FavoriteButton } from '@/components/generation/favorite-button';
import { useLocale } from '@/components/i18n/locale-provider';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { accessibleExcerpt } from '@/lib/a11y';
import { formatDateTime } from '@/lib/i18n/format';

import styles from './image-preview-dialog.module.css';

export type PreviewImage = {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
};

export function ImagePreviewDialog({
  open,
  onOpenChange,
  image,
  prompt,
  projectTitle,
  provider,
  model,
  favoritedAt,
  favorited,
  favoritePending,
  favoriteError,
  onFavoriteChange,
  onViewGeneration,
  returnFocus,
  suppressReturnFocus = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  image: PreviewImage;
  prompt: string;
  projectTitle?: string;
  provider?: string;
  model?: string;
  favoritedAt?: string;
  favorited?: boolean;
  favoritePending?: boolean;
  favoriteError?: string | null;
  onFavoriteChange?: (next: boolean) => void;
  onViewGeneration?: () => void;
  returnFocus?: HTMLElement | null;
  suppressReturnFocus?: boolean;
}) {
  const { locale, t } = useLocale();
  const [imageFailed, setImageFailed] = React.useState(false);
  const accessiblePrompt = accessibleExcerpt(prompt);

  React.useEffect(() => setImageFailed(false), [image.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t('dialogs.close')}
        className={styles.dialog}
        onCloseAutoFocus={(event) => {
          if (suppressReturnFocus) {
            event.preventDefault();
            return;
          }
          if (returnFocus?.isConnected) {
            event.preventDefault();
            returnFocus.focus();
          }
        }}
      >
        <DialogTitle className="sr-only">
          {t('dialogs.imagePreviewTitle')}
        </DialogTitle>
        <DialogDescription className="sr-only">{accessiblePrompt}</DialogDescription>

        <figure className={styles.figure}>
          {imageFailed ? (
            <div className={styles.imageError} role="img" aria-label={accessiblePrompt}>
              <ImageOff aria-hidden="true" />
            </div>
          ) : (
            <img
              src={image.url}
              width={image.width ?? undefined}
              height={image.height ?? undefined}
              alt={accessiblePrompt}
              onError={() => setImageFailed(true)}
            />
          )}
        </figure>

        <aside className={styles.details}>
          <div className={styles.detailHeading}>
            <div>
              <span>{t('dialogs.imagePreviewTitle')}</span>
              <strong>{model ?? provider ?? t('dialogs.results')}</strong>
            </div>
            {favorited !== undefined && onFavoriteChange ? (
              <FavoriteButton
                favorited={favorited}
                pending={favoritePending}
                onChange={onFavoriteChange}
              />
            ) : null}
          </div>

          <dl className={styles.metadata}>
            {projectTitle ? (
              <div>
                <dt>{t('dialogs.workspace')}</dt>
                <dd>{projectTitle}</dd>
              </div>
            ) : null}
            {provider ? (
              <div>
                <dt>{t('dialogs.provider')}</dt>
                <dd>{provider}</dd>
              </div>
            ) : null}
            {model ? (
              <div>
                <dt>{t('dialogs.model')}</dt>
                <dd className={styles.mono}>{model}</dd>
              </div>
            ) : null}
            {favoritedAt ? (
              <div>
                <dt>{t('dialogs.favoritedAt')}</dt>
                <dd>{formatDateTime(favoritedAt, locale)}</dd>
              </div>
            ) : null}
          </dl>

          <section className={styles.promptSection}>
            <h3>{t('dialogs.prompt')}</h3>
            <p>{prompt}</p>
          </section>

          {favoriteError ? (
            <p className={styles.inlineError} role="alert">
              {favoriteError}
            </p>
          ) : null}

          {onViewGeneration ? (
            <Button
              type="button"
              variant="secondary"
              className={styles.viewGeneration}
              onClick={onViewGeneration}
            >
              {t('dialogs.viewGeneration')}
              <ArrowRight aria-hidden="true" />
            </Button>
          ) : null}
        </aside>
      </DialogContent>
    </Dialog>
  );
}
