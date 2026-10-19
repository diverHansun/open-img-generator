'use client';

import * as React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  LayoutGrid,
  LoaderCircle,
  Maximize2,
  Square,
  XCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

import { ImagePreviewDialog } from '@/components/dialogs/image-preview-dialog';
import { FavoriteButton } from '@/components/generation/favorite-button';
import {
  getJobErrorDiagnosticReference,
  getJobErrorMessageKey,
  isWaitingForProvider,
  shouldShowJobError,
} from '@/components/generation/job-error';
import { reconcileGenerationSnapshot } from '@/components/generation/generation-view-state';
import { useLocale } from '@/components/i18n/locale-provider';
import {
  favoriteErrorNotice,
  favoriteSaveErrorNotice,
  favoriteSuccessNotice,
  useWorkspaceNotices,
} from '@/components/shell/workspace-notices';
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
import { GenerationPlaceholder } from './generation-placeholder';
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
  const { showWorkspaceNotice } = useWorkspaceNotices();
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
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = React.useState<string | null>(null);
  const [activeImageId, setActiveImageId] = React.useState<string | null>(null);
  const [viewMode, setViewMode] = React.useState<'single' | 'grid'>('grid');
  // Focus follows the switch between the gallery and the focused image.
  const pendingFocus = React.useRef<'single' | 'grid' | null>(null);
  const singleTriggerRef = React.useRef<HTMLButtonElement>(null);
  const galleryRef = React.useRef<HTMLDivElement>(null);
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
      setFavoriteBusy((current) => new Set(current).add(imageId));
      commitView(optimistic);
      try {
        if (nextFavorited) await runtime.client.addFavoriteWithBrowserFallback(imageId);
        else await runtime.client.removeFavorite(imageId);
        if (mounted.current) {
          showWorkspaceNotice(
            favoriteSuccessNotice(
              t(nextFavorited ? 'generate.favoriteAdded' : 'generate.favoriteRemoved'),
            ),
          );
        }
      } catch (error) {
        if (hadPreviousOverride && previousOverride !== undefined) {
          favoriteOverrides.current.set(imageId, previousOverride);
        } else {
          favoriteOverrides.current.delete(imageId);
        }
        if (mounted.current && viewRef.current) {
          commitView(
            patchFavorite(viewRef.current, imageId, previousFavorited),
          );
          showWorkspaceNotice(
            nextFavorited
              ? favoriteSaveErrorNotice(error, {
                  generic: t('generate.favoriteError'),
                  retryable: t('generate.favoriteError'),
                  storage: t('generate.favoriteStorageError'),
                  unavailable: t('generate.favoriteUnavailable'),
                })
              : favoriteErrorNotice(t('generate.favoriteError')),
          );
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
    [commitView, runtime, showWorkspaceNotice, t],
  );

  const summary = view ? summarizeGeneration(view) : null;
  const runningJobs =
    view?.jobs.filter(
      (job) => job.status === 'pending' || job.status === 'running',
    ) ?? [];
  const availableImages = React.useMemo(
    () =>
      (view?.images ?? []).filter(
        (image): image is typeof image & { url: string } => image.url !== null,
      ),
    [view?.images],
  );

  React.useEffect(() => {
    if (availableImages.length === 0) {
      setActiveImageId(null);
      return;
    }
    setActiveImageId((current) =>
      current && availableImages.some((img) => img.id === current)
        ? current
        : availableImages[0]?.id ?? null,
    );
  }, [availableImages]);

  const activeImageIndex = availableImages.findIndex(
    (img) => img.id === activeImageId,
  );
  const activeImage =
    activeImageIndex >= 0 ? availableImages[activeImageIndex] : availableImages[0] ?? null;
  const activeImageJob = activeImage
    ? view?.jobs.find((job) => job.id === activeImage.jobId)
    : undefined;

  const focusImage = React.useCallback((imageId: string) => {
    setActiveImageId(imageId);
    pendingFocus.current = 'single';
    setViewMode('single');
  }, []);

  const showGallery = React.useCallback(() => {
    pendingFocus.current = 'grid';
    setViewMode('grid');
  }, []);

  const stepImage = React.useCallback(
    (delta: number) => {
      if (availableImages.length < 2) return;
      const next =
        (activeImageIndex + delta + availableImages.length) % availableImages.length;
      setActiveImageId(availableImages[next]?.id ?? null);
    },
    [activeImageIndex, availableImages],
  );

  React.useEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target === 'single') {
      singleTriggerRef.current?.focus({ preventScroll: true });
    } else if (target === 'grid' && activeImageId) {
      galleryRef.current
        ?.querySelector<HTMLElement>(`[data-gallery-image="${CSS.escape(activeImageId)}"]`)
        ?.focus({ preventScroll: true });
    }
  }, [activeImageId, viewMode]);

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
    <div className={styles.stage}>
      <header className={styles.stageToolbar}>
        <div className={styles.stageStatus}>
          <strong>
            {summary ? t(statusKey(summary.displayStatus)) : t('generate.stageLoading')}
          </strong>
          {summary ? (
            <span className={styles.stageCount}>
              {t('generate.currentTaskImages', { count: summary.imageCount })}
            </span>
          ) : null}
        </div>

        {summary ? (
          <p className="sr-only" role="status" aria-live="polite">
            {t(statusKey(summary.displayStatus))}.{' '}
            {t('generate.jobsSummary', {
              running: summary.pending + summary.running,
              completed: summary.completed,
              failed: summary.failed + summary.cancelled,
            })}
            . {t('generate.currentTaskImages', { count: summary.imageCount })}
          </p>
        ) : null}

        <div className={styles.stageActions}>
          {availableImages.length > 0 ? (
            <div className={styles.segs} role="group" aria-label={t('generate.viewMode')}>
              <button
                type="button"
                className={viewMode === 'single' ? styles.segOn : styles.segOpt}
                aria-pressed={viewMode === 'single'}
                onClick={() => {
                  if (viewMode !== 'single' && activeImage) focusImage(activeImage.id);
                }}
              >
                <Square aria-hidden="true" />
                <span>{t('generate.inspectView')}</span>
              </button>
              <button
                type="button"
                className={viewMode === 'grid' ? styles.segOn : styles.segOpt}
                aria-pressed={viewMode === 'grid'}
                onClick={() => {
                  if (viewMode !== 'grid') showGallery();
                }}
              >
                <LayoutGrid aria-hidden="true" />
                <span>{t('generate.gridView')}</span>
              </button>
            </div>
          ) : null}

          {view && !areAllJobsTerminal(view) ? (
            <Button
              type="button"
              size="sm"
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
          ) : null}
        </div>
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
        <div className={styles.stageContent}>
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
                  variant="secondary"
                  onClick={() => handleErrorAction(loadError.action)}
                >
                  {t(loadErrorActionLabelKey)}
                </Button>
              ) : null}
            </div>
          ) : null}

          {viewMode === 'single' && activeImage ? (
            <div
              className={styles.singleViewer}
              onKeyDown={(event) => {
                if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) return;
                if (event.key === 'Escape') {
                  event.preventDefault();
                  showGallery();
                } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault();
                  stepImage(event.key === 'ArrowLeft' ? -1 : 1);
                }
              }}
            >
              <div className={styles.singleCanvas}>
                {availableImages.length > 1 ? (
                  <button
                    type="button"
                    className={`${styles.navArrow} ${styles.navPrev}`}
                    aria-label={t('generate.previousImage')}
                    onClick={() => stepImage(-1)}
                  >
                    <ChevronLeft aria-hidden="true" />
                  </button>
                ) : null}

                <button
                  ref={singleTriggerRef}
                  type="button"
                  className={styles.previewTrigger}
                  aria-label={t('dialogs.viewImage', { index: activeImage.index + 1 })}
                  onClick={(event) => {
                    setPreviewReturnFocus(event.currentTarget);
                    setSelectedImageId(activeImage.id);
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={activeImage.url}
                    alt={accessiblePrompt}
                    width={activeImage.width ?? undefined}
                    height={activeImage.height ?? undefined}
                  />
                </button>

                {availableImages.length > 1 ? (
                  <button
                    type="button"
                    className={`${styles.navArrow} ${styles.navNext}`}
                    aria-label={t('generate.nextImage')}
                    onClick={() => stepImage(1)}
                  >
                    <ChevronRight aria-hidden="true" />
                  </button>
                ) : null}

                <div className={styles.singleHud}>
                  <span className={styles.hudModel}>
                    {activeImageJob
                      ? `${activeImageJob.provider} · ${activeImageJob.model}`
                      : `#${activeImage.index + 1}`}
                    {availableImages.length > 1 ? (
                      <em>
                        {activeImageIndex + 1} / {availableImages.length}
                      </em>
                    ) : null}
                  </span>
                  <div className={styles.hudActions}>
                    <FavoriteButton
                      className={styles.hudBtn}
                      favorited={activeImage.favorited}
                      pending={favoriteBusy.has(activeImage.id)}
                      onChange={() => void toggleFavorite(activeImage.id)}
                    />
                    <a
                      className={styles.hudIconLink}
                      href={`/api/images/${encodeURIComponent(activeImage.id)}/download`}
                      download
                      aria-label={t('dialogs.downloadImage')}
                      title={t('dialogs.downloadImage')}
                    >
                      <Download aria-hidden="true" />
                    </a>
                    <button
                      type="button"
                      className={styles.hudIconLink}
                      aria-label={t('dialogs.viewImage', { index: activeImage.index + 1 })}
                      onClick={(event) => {
                        setPreviewReturnFocus(event.currentTarget);
                        setSelectedImageId(activeImage.id);
                      }}
                    >
                      <Maximize2 aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>

              {availableImages.length > 1 || runningJobs.length > 0 ? (
                <div className={styles.thumbRail}>
                  {availableImages.map((image, idx) => (
                    <button
                      key={image.id}
                      type="button"
                      className={
                        image.id === activeImage.id
                          ? styles.thumbItemActive
                          : styles.thumbItem
                      }
                      aria-label={t('dialogs.viewImage', { index: idx + 1 })}
                      aria-pressed={image.id === activeImage.id}
                      onClick={() => setActiveImageId(image.id)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.url} alt="" />
                    </button>
                  ))}
                  {runningJobs.map((job) => (
                    <GenerationPlaceholder key={job.id} job={job} compact />
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className={styles.imageStage} ref={galleryRef}>
              {/* Newest first: work still in progress leads the gallery. */}
              {runningJobs.map((job) => (
                <GenerationPlaceholder key={job.id} job={job} />
              ))}
              {view.images.map((image) => {
                const job = view.jobs.find((item) => item.id === image.jobId);
                const label = job ? `${job.provider} · ${job.model}` : `#${image.index + 1}`;
                return image.url === null ? (
                  <figure className={styles.stageImage} key={image.id}>
                    <div className={styles.jobPlaceholder}>
                      <XCircle aria-hidden="true" />
                      <span>{t(`generation.image.${image.availability}`)}</span>
                    </div>
                    <figcaption className={styles.gridCaption}>
                      <span title={label}>{label}</span>
                    </figcaption>
                  </figure>
                ) : (
                  <figure className={styles.stageImage} key={image.id}>
                    <button
                      type="button"
                      className={styles.galleryTile}
                      data-gallery-image={image.id}
                      aria-label={t('generate.focusImage', { index: image.index + 1 })}
                      onClick={() => focusImage(image.id)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image.url}
                        alt={accessiblePrompt}
                        width={image.width ?? undefined}
                        height={image.height ?? undefined}
                        loading="lazy"
                      />
                    </button>
                    <figcaption className={styles.gridCaption}>
                      <span title={label}>{label}</span>
                      <FavoriteButton
                        className={styles.favoriteButton}
                        favorited={image.favorited}
                        pending={favoriteBusy.has(image.id)}
                        onChange={() => void toggleFavorite(image.id)}
                      />
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          )}

          {view.images.length === 0 && runningJobs.length === 0 ? (
            <p className={styles.noImages}>{t('generate.noImagesTerminal')}</p>
          ) : null}

          <details className={styles.jobDetails} open={runningJobs.length > 0}>
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
                    <span className={styles.jobWho}>
                      <i
                        className={styles.statusDot}
                        data-status={job.status}
                        aria-hidden="true"
                      />
                      <strong>{job.provider}</strong>
                      <code>{job.model}</code>
                    </span>
                    <span className={styles.jobResult}>
                      <strong>{t(statusKey(job.status))}</strong>
                      <small>
                        {t('generate.jobImages', { count: imageCount })}
                      </small>
                    </span>
                    {visibleError ? (
                      <p className={styles.jobError}>
                        {t(
                          getJobErrorMessageKey(
                            visibleError.code,
                            visibleError.diagnostic,
                            visibleError.storageDiagnostic,
                          ),
                        )}
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
                    {isWaitingForProvider(job) ? (
                      <p className={styles.jobNotice} role="status">
                        {t('generation.providerWaiting')}
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
              downloadUrl={`/api/images/${encodeURIComponent(selectedAvailableImage.id)}/download`}
              deletePending={deleteBusy}
              deleteError={deleteError}
              onDelete={() => void deleteSelectedImage()}
              onFavoriteChange={() => void toggleFavorite(selectedAvailableImage.id)}
              returnFocus={previewReturnFocus}
            />
          ) : null}
        </div>
      ) : (
        <div className={styles.stageMessage} aria-live="polite">
          <LoaderCircle className={styles.spin} aria-hidden="true" />
          <strong>{t('generate.stageLoading')}</strong>
        </div>
      )}
    </div>
  );
}
