import { ImageIcon } from 'lucide-react';

import styles from './thumbnail-strip.module.css';

export type ThumbnailImage = {
  id: string;
  url: string | null;
  width: number | null;
  height: number | null;
};

export function ThumbnailStrip({
  images,
  alt,
  max = 6,
  moreLabel,
  emptyLabel,
}: {
  images: ReadonlyArray<ThumbnailImage>;
  alt: string;
  max?: number;
  moreLabel: (count: number) => string;
  emptyLabel: string;
}) {
  if (images.length === 0) {
    return (
      <span className={styles.empty} aria-label={emptyLabel}>
        <ImageIcon aria-hidden="true" />
      </span>
    );
  }

  const shown = images.slice(0, max);
  const remaining = Math.max(0, images.length - shown.length);
  return (
    <span className={styles.strip} aria-label={`${images.length}`}>
      {shown.map((image, index) =>
        image.url ? (
          <img
            key={image.id}
            src={image.url}
            width={image.width ?? 48}
            height={image.height ?? 48}
            alt={index === 0 ? alt : ''}
            loading="lazy"
          />
        ) : (
          <span key={image.id} className={styles.empty} aria-label={emptyLabel}>
            <ImageIcon aria-hidden="true" />
          </span>
        ),
      )}
      {remaining > 0 ? (
        <span className={styles.more} aria-label={moreLabel(remaining)}>
          …
        </span>
      ) : null}
    </span>
  );
}
