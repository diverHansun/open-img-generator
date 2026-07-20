'use client';

import * as React from 'react';
import { ArrowLeft, ImageOff } from 'lucide-react';

import { FavoriteButton } from '@/components/generation/favorite-button';
import { reconcileGenerationSnapshot } from '@/components/generation/generation-view-state';
import { GenerationStatus } from '@/components/generation/generation-status';
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
import {
  ApiClientError,
  getBrowserWebClientRuntime,
  type GalleryItem,
  type GenerationView,
  type ImageView,
} from '@/lib/web-client';

import styles from './generation-detail-dialog.module.css';

export type GenerationFavoriteChange = {
  imageId: string;
  favorited: boolean;
  galleryItem?: GalleryItem;
};

type FavoriteMutation = {
  value: boolean;
  pending: boolean;
  error: string | null;
};

function patchFavorite(
  view: GenerationView,
  imageId: string,
  favorited: boolean,
): GenerationView {
  return {
    ...view,
    images: view.images.map((image) =>
      image.id === imageId ? { ...image, favorited } : image,
    ),
  };
}

function ResultImage({ image, prompt }: { image: ImageView; prompt: string }) {
  const [failed, setFailed] = React.useState(false);
  const accessiblePrompt = accessibleExcerpt(prompt);
  if (failed) {
    return (
      <span className={styles.resultImageError} role="img" aria-label={accessiblePrompt}>
        <ImageOff aria-hidden="true" />
      </span>
    );
  }
  return (
    <img
      src={image.url}
      width={image.width ?? undefined}
      height={image.height ?? undefined}
      alt={accessiblePrompt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function GenerationDetailDialog({
  generationId,
  open,
  onOpenChange,
  projectTitle,
  returnFocus,
  onFavoriteChange,
}: {
  generationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectTitle?: string;
  returnFocus?: HTMLElement | null;
  onFavoriteChange?: (change: GenerationFavoriteChange) => void;
}) {
  const { client, generationPollRegistry } = React.useMemo(
    () => getBrowserWebClientRuntime(),
    [],
  );
  const { locale, t } = useLocale();
  const [view, setView] = React.useState<GenerationView | null>(null);
  const [loadError, setLoadError] = React.useState<Error | null>(null);
  const [retryNonce, setRetryNonce] = React.useState(0);
  const [cancelling, setCancelling] = React.useState(false);
  const [cancelError, setCancelError] = React.useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = React.useState<string | null>(null);
  const [favoriteMutations, setFavoriteMutations] = React.useState<
    Record<string, FavoriteMutation>
  >({});
  const previousGenerationId = React.useRef<string | null>(null);
  const backButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const resultTriggersRef = React.useRef(new Map<string, HTMLButtonElement>());
  const returnImageIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const changedGeneration = previousGenerationId.current !== generationId;
    previousGenerationId.current = generationId;
    if (changedGeneration) {
      setView(null);
      setSelectedImageId(null);
      setFavoriteMutations({});
      returnImageIdRef.current = null;
    }
    setLoadError(null);
    setCancelError(null);
    const unsubscribe = generationPollRegistry.subscribe(generationId, {
      onUpdate: (nextView) => {
        setView((current) => reconcileGenerationSnapshot(current, nextView));
        setLoadError(null);
      },
      onError: (cause) => {
        setLoadError(
          cause instanceof Error ? cause : new Error('Generation detail request failed'),
        );
      },
    });
    return unsubscribe;
  }, [generationId, generationPollRegistry, open, retryNonce]);

  React.useEffect(() => {
    if (!open) {
      previousGenerationId.current = null;
      setSelectedImageId(null);
      returnImageIdRef.current = null;
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    if (selectedImageId) {
      backButtonRef.current?.focus();
      return;
    }
    const imageId = returnImageIdRef.current;
    if (!imageId) return;
    resultTriggersRef.current.get(imageId)?.focus();
    returnImageIdRef.current = null;
  }, [open, selectedImageId]);

  const updateFavorite = React.useCallback(
    async (imageId: string, next: boolean) => {
      setFavoriteMutations((current) => ({
        ...current,
        [imageId]: { value: next, pending: true, error: null },
      }));
      try {
        const galleryItem = next ? await client.addFavorite(imageId) : undefined;
        if (!next) await client.removeFavorite(imageId);
        setView((current) =>
          current ? patchFavorite(current, imageId, next) : current,
        );
        setFavoriteMutations((current) => ({
          ...current,
          [imageId]: { value: next, pending: false, error: null },
        }));
        onFavoriteChange?.({
          imageId,
          favorited: next,
          galleryItem,
        });
      } catch {
        setFavoriteMutations((current) => ({
          ...current,
          [imageId]: {
            value: !next,
            pending: false,
            error: t('dialogs.favoriteError'),
          },
        }));
      }
    },
    [client, onFavoriteChange, t],
  );

  const cancel = React.useCallback(async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      const nextView = await client.cancelGeneration(generationId);
      setView((current) => reconcileGenerationSnapshot(current, nextView));
    } catch {
      setCancelError(t('dialogs.cancelError'));
    } finally {
      setCancelling(false);
    }
  }, [client, generationId, t]);

  const selectedImage = view?.images.find((image) => image.id === selectedImageId);
  const terminal = view
    ? view.jobs.length > 0 &&
      view.jobs.every((job) =>
        ['completed', 'failed', 'cancelled'].includes(job.status),
      )
    : false;
  const notFound = loadError instanceof ApiClientError && loadError.status === 404;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t('dialogs.close')}
        className={styles.dialog}
        onCloseAutoFocus={(event) => {
          if (returnFocus?.isConnected) {
            event.preventDefault();
            returnFocus.focus();
          }
        }}
      >
        <DialogTitle className="sr-only">{t('dialogs.generationTitle')}</DialogTitle>
        <DialogDescription className="sr-only">
          {view ? accessibleExcerpt(view.prompt) : t('dialogs.detailLoadError')}
        </DialogDescription>

        {selectedImage && view ? (
          <section className={styles.singleImageView}>
            <Button
              ref={backButtonRef}
              type="button"
              variant="secondary"
              size="sm"
              className={styles.backButton}
              onClick={() => setSelectedImageId(null)}
            >
              <ArrowLeft aria-hidden="true" />
              {t('dialogs.backToDetail')}
            </Button>
            <ResultImage image={selectedImage} prompt={view.prompt} />
            <FavoriteButton
              favorited={
                favoriteMutations[selectedImage.id]?.value ?? selectedImage.favorited
              }
              pending={favoriteMutations[selectedImage.id]?.pending}
              onChange={(next) => void updateFavorite(selectedImage.id, next)}
              className={styles.singleFavorite}
            />
            {favoriteMutations[selectedImage.id]?.error ? (
              <p className={styles.imageFavoriteError} role="alert">
                {favoriteMutations[selectedImage.id]?.error}
              </p>
            ) : null}
          </section>
        ) : view ? (
          <div className={styles.detailView}>
            <header className={styles.header}>
              <div className={styles.titleBlock}>
                <span>{t('dialogs.generationTitle')}</span>
                <GenerationStatus status={view.status} jobs={view.jobs} />
              </div>
              {!terminal ? (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={cancelling}
                  onClick={() => void cancel()}
                >
                  {cancelling
                    ? t('dialogs.cancelling')
                    : t('dialogs.cancelGeneration')}
                </Button>
              ) : null}
            </header>

            <section className={styles.prompt}>
              <p>{view.prompt}</p>
              <dl className={styles.timestamps}>
                {projectTitle ? (
                  <div>
                    <dt>{t('dialogs.workspace')}</dt>
                    <dd>{projectTitle}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>{t('dialogs.createdAt')}</dt>
                  <dd>{formatDateTime(view.createdAt, locale)}</dd>
                </div>
                <div>
                  <dt>{t('dialogs.updatedAt')}</dt>
                  <dd>{formatDateTime(view.updatedAt, locale)}</dd>
                </div>
              </dl>
            </section>

            {loadError ? (
              <div className={styles.inlineNotice} role="status">
                <span>
                  {loadError instanceof ApiClientError && loadError.retryable
                    ? t('dialogs.autoRetry')
                    : t('dialogs.detailLoadError')}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRetryNonce((value) => value + 1)}
                >
                  {t('dialogs.retry')}
                </Button>
              </div>
            ) : null}
            {cancelError ? (
              <p className={styles.cancelError} role="alert">
                {cancelError}
              </p>
            ) : null}

            <section className={styles.section}>
              <h3>{t('dialogs.jobs')}</h3>
              <div className={styles.jobList}>
                {view.jobs.map((job) => {
                  const imageCount = view.images.filter(
                    (image) => image.jobId === job.id,
                  ).length;
                  return (
                    <article key={job.id} className={styles.jobRow}>
                      <div className={styles.jobIdentity}>
                        <strong>{job.provider}</strong>
                        <span>{job.model}</span>
                      </div>
                      <GenerationStatus status={job.status} compact />
                      <span className={styles.jobCount}>
                        {t('dialogs.jobImageCount', { count: imageCount })}
                      </span>
                      {job.error ? (
                        <p className={styles.jobError}>
                          {t('dialogs.jobError', { message: job.error.message })}
                        </p>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>

            <section className={styles.section}>
              <h3>{t('dialogs.results')}</h3>
              {view.images.length > 0 ? (
                <div className={styles.resultGrid}>
                  {view.images.map((image, index) => {
                    const mutation = favoriteMutations[image.id];
                    const favorited = mutation?.value ?? image.favorited;
                    return (
                      <article key={image.id} className={styles.resultItem}>
                        <button
                          ref={(node) => {
                            if (node) resultTriggersRef.current.set(image.id, node);
                            else resultTriggersRef.current.delete(image.id);
                          }}
                          type="button"
                          className={styles.resultButton}
                          aria-label={t('dialogs.viewImage', { index: index + 1 })}
                          onClick={() => {
                            returnImageIdRef.current = image.id;
                            setSelectedImageId(image.id);
                          }}
                        >
                          <ResultImage image={image} prompt={view.prompt} />
                        </button>
                        <FavoriteButton
                          favorited={favorited}
                          pending={mutation?.pending}
                          onChange={(next) => void updateFavorite(image.id, next)}
                          className={styles.resultFavorite}
                        />
                        {mutation?.error ? (
                          <span className={styles.resultError} role="alert">
                            {mutation.error}
                          </span>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className={styles.noImages}>{t('dialogs.noImages')}</p>
              )}
            </section>
          </div>
        ) : notFound ? (
          <section className={styles.state}>
            <h2>{t('dialogs.detailNotFound')}</h2>
            <p>{t('dialogs.detailNotFoundText')}</p>
          </section>
        ) : loadError ? (
          <section className={styles.state}>
            <h2>{t('dialogs.detailLoadError')}</h2>
            <p>{loadError.message}</p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRetryNonce((value) => value + 1)}
            >
              {t('dialogs.retry')}
            </Button>
          </section>
        ) : (
          <section
            className={styles.loading}
            role="status"
            aria-label={t('dialogs.generationTitle')}
          >
            <span />
            <span />
            <span />
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
