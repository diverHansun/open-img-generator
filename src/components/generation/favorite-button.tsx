'use client';

import { Heart, LoaderCircle } from 'lucide-react';

import { useLocale } from '@/components/i18n/locale-provider';
import { Button } from '@/components/ui/button';

import styles from './favorite-button.module.css';

export function FavoriteButton({
  favorited,
  pending = false,
  onChange,
  className,
}: {
  favorited: boolean;
  pending?: boolean;
  onChange: (next: boolean) => void;
  className?: string;
}) {
  const { t } = useLocale();
  const label = pending
    ? t('generation.favorite.updating')
    : favorited
      ? t('generation.favorite.remove')
      : t('generation.favorite.add');

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={`${styles.button}${className ? ` ${className}` : ''}`}
      aria-label={label}
      aria-pressed={favorited}
      aria-busy={pending}
      disabled={pending}
      onClick={() => onChange(!favorited)}
    >
      {pending ? (
        <LoaderCircle className={styles.spinner} aria-hidden="true" />
      ) : (
        <Heart aria-hidden="true" data-filled={favorited || undefined} />
      )}
    </Button>
  );
}
