'use client';

import * as React from 'react';
import { ImageOff } from 'lucide-react';

import { FavoriteButton } from '@/components/generation/favorite-button';
import { useLocale } from '@/components/i18n/locale-provider';
import { accessibleExcerpt } from '@/lib/a11y';
import { formatRelativeTime } from '@/lib/i18n/format';
import type { GalleryItem } from '@/lib/web-client';

import { galleryImageShape } from './gallery-state';
import styles from './gallery-screen.module.css';

export function GalleryTile({
  item,
  favorited,
  favoritePending,
  onOpen,
  onFavoriteChange,
}: {
  item: GalleryItem;
  favorited: boolean;
  favoritePending: boolean;
  onOpen: (trigger: HTMLElement) => void;
  onFavoriteChange: (next: boolean) => void;
}) {
  const { locale, t } = useLocale();
  const [failed, setFailed] = React.useState(false);
  const shape = galleryImageShape(item.width, item.height);
  const accessiblePrompt = accessibleExcerpt(item.prompt);
  const imageUrl = item.url;
  const missing = imageUrl === null;

  return (
    <article
      className={styles.tile}
      data-shape={shape}
      data-gallery-image-id={item.imageId}
    >
      <button
        type="button"
        className={styles.imageButton}
        aria-label={
          missing
            ? t('gallery.viewMissingSource', { prompt: accessiblePrompt })
            : t('gallery.openPreview', { prompt: accessiblePrompt })
        }
        onClick={(event) => onOpen(event.currentTarget)}
      >
        {missing || failed ? (
          <span
            className={styles.imageError}
            role="img"
            aria-label={
              missing ? t('gallery.imageExpired') : t('gallery.imageUnavailable')
            }
          >
            <ImageOff aria-hidden="true" />
            {missing ? <strong>{t('gallery.imageExpired')}</strong> : null}
          </span>
        ) : (
          <img
            src={imageUrl!}
            width={item.width ?? undefined}
            height={item.height ?? undefined}
            alt={accessiblePrompt}
            loading="lazy"
            onError={() => setFailed(true)}
          />
        )}
      </button>
      <div className={styles.tileMeta}>
        <span>
          <strong>{item.model}</strong>
          <small>
            {t('gallery.favoritedAt', {
              time: formatRelativeTime(item.favoritedAt, locale),
            })}
          </small>
        </span>
        <FavoriteButton
          favorited={favorited}
          pending={favoritePending}
          onChange={onFavoriteChange}
        />
      </div>
    </article>
  );
}
