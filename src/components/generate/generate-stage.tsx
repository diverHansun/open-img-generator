'use client';

import * as React from 'react';
import { ArrowLeft, LoaderCircle, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { ImagePreviewDialog } from '@/components/dialogs/image-preview-dialog';
import { FavoriteButton } from '@/components/generation/favorite-button';
import {
  getJobErrorDiagnosticReference,
  getJobErrorMessageKey,
  shouldShowJobError,
} from '@/components/generation/job-error';
import { reconcileGenerationSnapshot } from '@/components/generation/generation-view-state';
import { useLocale } from '@/components/i18n/locale-provider';
import { Button } from '@/components/ui/button';
import { accessibleExcerpt } from '@/lib/a11y';
import { workspaceRoute } from '@/lib/routes';
import {
  areAllJobsTerminal,
  getBrowserWebClientRuntime,
  type GenerationStatus,
  type GenerationView,
} from '@/lib/web-client';

import {
  dispatchGenerateErrorAction,
  getGenerateErrorActionLabelKey,
  mapGenerateError,
  type GenerateErrorAction,
  type GenerateErrorPresentation,
} from './generate-error';
import { summarizeGeneration } from './generate-state';
import styles from './generate-screen.module.css';

export type GenerateStageProps = {
  projectId: string;
  generationId: string;
  initialSnapshot: GenerationView | null;
  onSnapshot: (snapshot: GenerationView) => void;
  onBack: () => void;
};

function statusKey(status: GenerationStatus | 'partial') {
  switch (status) {
    case 'pending':
      return 'generate.status.pending' as const;
    case 'running':
      return 'generate.status.running' as const;
    case 'completed':
      return 'generate.status.completed' as const;
    case 'failed':
      return 'generate.status.failed' as const;
    case 'cancelled':
      return 'generate.status.cancelled' as const;
    case 'partial':
      return 'generate.status.partial' as const;
  }
}

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

function applyFavoriteOverrides(
  view: GenerationView,
  overrides: ReadonlyMap<string, boolean>,
): GenerationView {
  let changed = false;
  const images = view.images.map((image) => {
    const override = overrides.get(image.id);
    if (override === undefined || override === image.favorited) return image;
    changed = true;
    return { ...image, favorited: override };
  });
  return changed ? { ...view, images } : view;
}

export function GenerateStage({
  projectId,
  generationId,
  initialSnapshot,
  onSnapshot,
  onBack,
}: GenerateStageProps) {
  const { t } = useLocale();
  const router = useRouter();
  const runtime = React.useMemo(() => getBrowserWebClientRuntime(), []);
  const [view, setView] = React.useState<GenerationView | null>(
    initialSnapshot?.id === generationId && initialSnapshot.projectId === projectId
      ? initialSnapshot
      : null,
  );
  const [loadError, setLoadError] =
    React.useState<GenerateErrorPresentation | null>(null);
  const [retryNonce, setRetryNonce] = React.useState(0);
  const [cancelling, setCancelling] = React.useState(false);
  const [favoriteBusy, setFavoriteBusy] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [favoriteError, setFavoriteError] = React.useState(false);
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = React.useState<string | null>(null);
  const [previewReturnFocus, setPreviewReturnFocus] =
    React.useState<HTMLElement | null>(null);
  const favoriteOverrides = React.useRef(new Map<string, boolean>());
  const favoritePendingRef = React.useRef(new Set<string>());
  const viewRef = React.useRef(view);
  const mounted = React.useRef(false);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const commitView = React.useCallback(
    (next: GenerationView) => {
      if (!mounted.current) return;
      viewRef.current = next;
      setView(next);
      onSnapshot(next);
    },
    [onSnapshot],
  );

  const acceptSnapshot = React.useCallback(
    (snapshot: GenerationView) => {
      if (snapshot.projectId !== projectId || snapshot.id !== generationId) {
        if (mounted.current) {
          viewRef.current = null;
          setView(null);
          setLoadError({
            messageKey: 'generate.error.notFound',
            action: 'back-to-compose',
          });
        }
        return false;
      }
      const accepted = reconcileGenerationSnapshot(viewRef.current, snapshot);
      const patched = applyFavoriteOverrides(accepted, favoriteOverrides.current);
      if (mounted.current) setLoadError(null);
      if (patched !== viewRef.current) commitView(patched);
      return true;
    },
    [commitView, generationId, projectId],
  );

  React.useEffect(() => {
    setLoadError(null);
    let active = true;
    let unsubscribe = () => {
      active = false;
    };
    unsubscribe = runtime.generationPollRegistry.subscribe(generationId, {
      onUpdate: (snapshot) => {
        if (!active) return;
        if (!acceptSnapshot(snapshot)) {
          active = false;
          unsubscribe();
        }
      },
      onError: (cause) => {
        if (active && mounted.current) {
          setLoadError(mapGenerateError(cause, 'detail'));
        }
      },
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [acceptSnapshot, generationId, retryNonce, runtime]);

  const handleErrorAction = React.useCallback(
    (action: GenerateErrorAction) => {
      dispatchGenerateErrorAction(action, {
        'configure-providers': () =>
          router.push(workspaceRoute(projectId, 'providers')),
        'check-history': () =>
          router.push(workspaceRoute(projectId, 'history')),
        reload: () => window.location.reload(),
        'back-to-compose': onBack,
        wait: () => {
          setLoadError(null);
          setRetryNonce((current) => current + 1);
        },
      });
    },
    [onBack, projectId, router],
  );

  const cancel = React.useCallback(async () => {
    setCancelling(true);
    setLoadError(null);
    try {
      const snapshot = await runtime.client.cancelGeneration(generationId);
      if (mounted.current) acceptSnapshot(snapshot);
    } catch (cause) {
      if (mounted.current) setLoadError(mapGenerateError(cause, 'cancel'));
    } finally {
      if (mounted.current) setCancelling(false);
    }
  }, [acceptSnapshot, generationId, runtime]);

  const toggleFavorite = React.useCallback(
    async (imageId: string) => {
      const current = viewRef.current;
      if (!current || favoritePendingRef.current.has(imageId)) return;
      const image = current.images.find((item) => item.id === imageId);
      if (!image) return;
      const nextFavorited = !image.favorited;
      const previousFavorited = image.favorited;
      const hadPreviousOverride = favoriteOverrides.current.has(imageId);
      const previousOverride = favoriteOverrides.current.get(imageId);
      const optimistic = patchFavorite(current, imageId, nextFavorited);
      favoriteOverrides.current.set(imageId, nextFavorited);
      favoritePendingRef.current.add(imageId);
      setFavoriteError(false);
      setFavoriteBusy((current) => new Set(current).add(imageId));
      commitView(optimistic);
      try {
        if (nextFavorited) await runtime.client.addFavorite(imageId);
        else await runtime.client.removeFavorite(imageId);
      } catch {
        if (hadPreviousOverride && previousOverride !== undefined) {
          favoriteOverrides.current.set(imageId, previousOverride);
        } else {
          favoriteOverrides.current.delete(imageId);
        }
        if (mounted.current && viewRef.current) {
          commitView(
            patchFavorite(viewRef.current, imageId, previousFavorited),
          );
          setFavoriteError(true);
        }
      } finally {
        favoritePendingRef.current.delete(imageId);
        if (mounted.current) {
          setFavoriteBusy((current) => {
            const next = new Set(current);
            next.delete(imageId);
            return next;
          });
        }
      }
    },
    [commitView, runtime],
  );

  const summary = view ? summarizeGeneration(view) : null;
  const runningJobs = view?.jobs.filter(
    (job) => job.status === 'pending' || job.status === 'running',
  ) ?? [];
  const selectedImage = view?.images.find((image) => image.id === selectedImageId);
  const selectedAvailableImage = selectedImage?.url
    ? { ...selectedImage, url: selectedImage.url }
    : null;
  const deleteSelectedImage = React.useCallback(async () => {
    const image = selectedAvailableImage;
    if (!image || deleteBusy) return;
    if (!window.confirm(t('dialogs.deleteImageConfirm'))) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await runtime.client.deleteImage(image.id);
      favoriteOverrides.current.delete(image.id);
      const current = viewRef.current;
      if (current) {
        commitView({
          ...current,
          images: current.images.map((item) =>
            item.id === image.id
              ? {
                  ...item,
                  url: null,
                  favorited: false,
                  availability: 'user_deleted',
                  removedAt: new Date().toISOString(),
                }
              : item,
          ),
        });
      }
      setSelectedImageId(null);
    } catch {
      setDeleteError(t('dialogs.deleteImageError'));
    } finally {
      setDeleteBusy(false);
    }
  }, [commitView, deleteBusy, runtime, selectedAvailableImage, t]);
  const selectedJob = selectedImage
    ? view?.jobs.find((job) => job.id === selectedImage.jobId)
    : undefined;
  const accessiblePrompt = view ? accessibleExcerpt(view.prompt) : '';
  const loadErrorActionLabelKey = loadError
    ? getGenerateErrorActionLabelKey(loadError.action)
    : null;

  return (
    <section className={styles.stage}>
      <header className={styles.stageToolbar}>
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          {t('generate.backToCompose')}
        </Button>
        {summary ? (
          <div className={styles.stageStatus}>
            <strong>{t(statusKey(summary.displayStatus))}</strong>
            <span>
              {t('generate.currentTaskImages', { count: summary.imageCount })}
            </span>
          </div>
        ) : null}
        {summary ? (
          <p className="sr-only" role="status" aria-live="polite">
            {t(statusKey(summary.displayStatus))}.{' '}
            {t('generate.jobsSummary', {
              running: summary.pending + summary.running,
              completed: summary.completed,
              failed: summary.failed + summary.cancelled,
            })}. {t('generate.currentTaskImages', { count: summary.imageCount })}
          </p>
        ) : null}
        {view && !areAllJobsTerminal(view) ? (
          <Button
            type="button"
            variant="danger"
            disabled={cancelling}
            onClick={() => void cancel()}
          >
            {cancelling ? (
              <LoaderCircle className={styles.spin} aria-hidden="true" />
            ) : (
              <XCircle aria-hidden="true" />
            )}
            {t(
              cancelling
                ? 'generate.cancelling'
                : 'generate.cancelGeneration',
            )}
          </Button>
        ) : (
          <span />
        )}
      </header>

      {loadError && !view ? (
        <div className={styles.stageMessage} role="alert">
          <strong>{t(loadError.messageKey)}</strong>
          {loadError.requestId ? (
            <small>
              {t('generate.error.requestId', {
                requestId: loadError.requestId,
              })}
            </small>
          ) : null}
          {loadErrorActionLabelKey ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => handleErrorAction(loadError.action)}
            >
              {t(loadErrorActionLabelKey)}
            </Button>
          ) : null}
        </div>
      ) : view ? (
        <>
          {loadError ? (
            <div className={styles.submissionNotice} role="alert">
              <p>{t(loadError.messageKey)}</p>
              {loadError.requestId ? (
                <small>
                  {t('generate.error.requestId', {
                    requestId: loadError.requestId,
                  })}
                </small>
              ) : null}
              {loadErrorActionLabelKey ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => handleErrorAction(loadError.action)}
                >
                  {t(loadErrorActionLabelKey)}
                </Button>
              ) : null}
            </div>
          ) : null}
          {favoriteError ? (
            <p className={styles.inlineError} role="alert">
              {t('generate.favoriteError')}
            </p>
          ) : null}

          <div
            className={styles.imageStage}
            data-count={Math.min(view.images.length + runningJobs.length, 5)}
          >
            {view.images.map((image) =>
              image.url === null ? (
                <div className={styles.jobPlaceholder} key={image.id}>
                  <XCircle aria-hidden="true" />
                  <span>{t(`generation.image.${image.availability}`)}</span>
                </div>
              ) : (
              <figure className={styles.stageImage} key={image.id}>
                <button
                  type="button"
                  className={styles.previewTrigger}
                  aria-label={t('dialogs.viewImage', { index: image.index + 1 })}
                  onClick={(event) => {
                    setPreviewReturnFocus(event.currentTarget);
                    setSelectedImageId(image.id);
                  }}
                >
                  <img
                    src={image.url}
                    alt={accessiblePrompt}
                    width={image.width ?? undefined}
                    height={image.height ?? undefined}
                  />
                </button>
                <FavoriteButton
                  className={styles.favoriteButton}
                  favorited={image.favorited}
                  pending={favoriteBusy.has(image.id)}
                  onChange={() => void toggleFavorite(image.id)}
                />
              </figure>
              ),
            )}
            {runningJobs.map((job) => (
              <div className={styles.jobPlaceholder} key={job.id}>
                <LoaderCircle className={styles.spin} aria-hidden="true" />
                <span>{t(statusKey(job.status))}</span>
              </div>
            ))}
          </div>

          {view.images.length === 0 && runningJobs.length === 0 ? (
            <p className={styles.noImages}>{t('generate.noImagesTerminal')}</p>
          ) : null}

          <details className={styles.jobDetails}>
            <summary>
              <span>
                <strong>{t('generate.jobsTitle')}</strong>
                {summary ? (
                  <small>
                    {t('generate.jobsSummary', {
                      running: summary.pending + summary.running,
                      completed: summary.completed,
                      failed: summary.failed + summary.cancelled,
                    })}
                  </small>
                ) : null}
              </span>
            </summary>
            <div className={styles.jobList}>
              {view.jobs.map((job) => {
                const imageCount = view.images.filter(
                  (image) => image.jobId === job.id,
                ).length;
                const visibleError = shouldShowJobError(job.status, job.error)
                  ? job.error
                  : undefined;
                const diagnosticReference = getJobErrorDiagnosticReference(visibleError);
                return (
                  <div className={styles.jobRow} key={job.id}>
                    <span>
                      <strong>{job.provider}</strong>
                      <small>{job.model}</small>
                    </span>
                    <span className={styles.jobResult}>
                      <strong>{t(statusKey(job.status))}</strong>
                      <small>
                        {t('generate.jobImages', { count: imageCount })}
                      </small>
                    </span>
                    {visibleError ? (
                      <p className={styles.jobError}>
                        {t(getJobErrorMessageKey(
                          visibleError.code,
                          visibleError.diagnostic,
                          visibleError.storageDiagnostic,
                        ))}
                        {diagnosticReference ? (
                          <small>
                            {' '}
                            {t('generation.jobError.reference', {
                              reference: diagnosticReference,
                            })}
                          </small>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </details>

          {selectedAvailableImage ? (
            <ImagePreviewDialog
              open
              onOpenChange={(open) => {
                if (!open) setSelectedImageId(null);
              }}
              image={selectedAvailableImage}
              prompt={view.prompt}
              provider={selectedJob?.provider}
              model={selectedJob?.model}
              favorited={selectedAvailableImage.favorited}
              favoritePending={favoriteBusy.has(selectedAvailableImage.id)}
              favoriteError={
                favoriteError ? t('generate.favoriteError') : null
              }
              downloadUrl={`/api/images/${encodeURIComponent(selectedAvailableImage.id)}/download`}
              deletePending={deleteBusy}
              deleteError={deleteError}
              onDelete={() => void deleteSelectedImage()}
              onFavoriteChange={() => void toggleFavorite(selectedAvailableImage.id)}
              returnFocus={previewReturnFocus}
            />
          ) : null}
        </>
      ) : (
        <div className={styles.stageMessage} aria-live="polite">
          <LoaderCircle className={styles.spin} aria-hidden="true" />
          <strong>{t('generate.stageLoading')}</strong>
        </div>
      )}
    </section>
  );
}
