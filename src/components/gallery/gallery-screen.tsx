'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import {
  GenerationDetailDialog,
  type GenerationFavoriteChange,
} from '@/components/dialogs/generation-detail-dialog';
import { ImagePreviewDialog } from '@/components/dialogs/image-preview-dialog';
import { useLocale } from '@/components/i18n/locale-provider';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineNotice } from '@/components/ui/inline-notice';
import { LoadMoreButton } from '@/components/ui/load-more-button';
import { workspaceRoute } from '@/lib/routes';
import {
  getBrowserWebClientRuntime,
  LatestRequestCoordinator,
  type GalleryItem,
  type Page,
  type ProjectSummary,
  type ProviderConfiguration,
} from '@/lib/web-client';

import {
  galleryFiltersHref,
  galleryItemMatchesFilters,
  mergeUniqueGalleryItems,
  parseGalleryFilters,
  type GalleryFilters,
} from './gallery-state';
import { GalleryTile } from './gallery-tile';
import styles from './gallery-screen.module.css';

const PAGE_SIZE = 36;
const MAX_REFRESH_PAGE_SIZE = 100;

type GallerySnapshot = Page<GalleryItem>;
type GalleryState =
  | { status: 'loading' | 'invalid' }
  | { status: 'error'; error: Error }
  | { status: 'ready' | 'refreshing'; snapshot: GallerySnapshot }
  | { status: 'stale'; snapshot: GallerySnapshot; error: Error };

type FilterOptions = {
  projects: ProjectSummary[];
  providers: ProviderConfiguration[];
  projectsLoaded: boolean;
  providersLoaded: boolean;
  hasError: boolean;
};

type FavoriteMutation = {
  favorited: boolean;
  pending: boolean;
  error: string | null;
};

type ActiveDialog =
  | {
      kind: 'preview';
      item: GalleryItem;
      returnFocus: HTMLElement | null;
      handoffToGeneration?: boolean;
    }
  | {
      kind: 'generation';
      generationId: string;
      projectTitle: string;
      returnFocus: HTMLElement | null;
    };

function hasSnapshot(
  state: GalleryState,
): state is Extract<GalleryState, { snapshot: GallerySnapshot }> {
  return 'snapshot' in state;
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error('Gallery request failed');
}

function updateSnapshot(
  state: GalleryState,
  update: (snapshot: GallerySnapshot) => GallerySnapshot,
): GalleryState {
  if (!hasSnapshot(state)) return state;
  return { ...state, snapshot: update(state.snapshot) };
}

export function GalleryScreen({ projectId }: { projectId: string }) {
  const { client } = React.useMemo(() => getBrowserWebClientRuntime(), []);
  const galleryCoordinator = React.useMemo(() => new LatestRequestCoordinator(), []);
  const optionsCoordinator = React.useMemo(() => new LatestRequestCoordinator(), []);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const parsed = parseGalleryFilters(
    searchParams.get('workspace'),
    searchParams.get('provider'),
  );
  const filters = parsed.filters;
  const mountedRef = React.useRef(false);
  const loadMoreController = React.useRef<AbortController | null>(null);
  const revalidateAfterLoadMoreRef = React.useRef(false);
  const snapshotRef = React.useRef<GallerySnapshot | null>(null);
  const gridRef = React.useRef<HTMLDivElement | null>(null);
  const filtersRef = React.useRef<HTMLDivElement | null>(null);
  const mutationEpochRef = React.useRef(0);
  const pendingFavoriteIdsRef = React.useRef(new Set<string>());
  const [state, setState] = React.useState<GalleryState>({ status: 'loading' });
  const [options, setOptions] = React.useState<FilterOptions>({
    projects: [],
    providers: [],
    projectsLoaded: false,
    providersLoaded: false,
    hasError: false,
  });
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [loadMoreError, setLoadMoreError] = React.useState(false);
  const [mutations, setMutations] = React.useState<Record<string, FavoriteMutation>>({});
  const [activeDialog, setActiveDialog] = React.useState<ActiveDialog | null>(null);
  const [announcement, setAnnouncement] = React.useState('');

  const invalidWorkspace = Boolean(
    filters.workspace &&
      options.projectsLoaded &&
      !options.projects.some((entry) => entry.project.id === filters.workspace),
  );
  const invalidQuery = parsed.invalid || invalidWorkspace;
  const filterKey = (filters.workspace ?? '') + ':' + (filters.provider ?? '');

  const loadGallery = React.useCallback(
    async (background: boolean) => {
      if (background && loadMoreController.current) {
        revalidateAfterLoadMoreRef.current = true;
        return;
      }
      const requestMutationEpoch = mutationEpochRef.current;
      if (!background) {
        revalidateAfterLoadMoreRef.current = false;
        loadMoreController.current?.abort();
        loadMoreController.current = null;
        setLoadingMore(false);
        setLoadMoreError(false);
      }
      if (invalidQuery) {
        galleryCoordinator.cancel();
        setState({ status: 'invalid' });
        return;
      }
      setState((current) =>
        background && hasSnapshot(current)
          ? { status: 'refreshing', snapshot: current.snapshot }
          : { status: 'loading' },
      );
      try {
        const targetItemCount = background
          ? Math.max(PAGE_SIZE, snapshotRef.current?.items.length ?? 0)
          : PAGE_SIZE;
        const result = await galleryCoordinator.run(async (signal) => {
          let items: GalleryItem[] = [];
          let cursor: string | undefined;
          let nextCursor: string | null = null;
          while (items.length < targetItemCount) {
            const page = await client.listFavorites(
              {
                limit: Math.min(
                  MAX_REFRESH_PAGE_SIZE,
                  targetItemCount - items.length,
                ),
                cursor,
                projectId: filters.workspace,
                provider: filters.provider,
                sort: 'newest',
              },
              { signal },
            );
            const previousLength = items.length;
            items = mergeUniqueGalleryItems(items, page.items);
            nextCursor = page.nextCursor;
            if (!nextCursor || items.length === previousLength) break;
            cursor = nextCursor;
          }
          return { items, nextCursor } satisfies GallerySnapshot;
        });
        if (result.state === 'current' && mountedRef.current) {
          setState((current) =>
            requestMutationEpoch !== mutationEpochRef.current && hasSnapshot(current)
              ? { status: 'ready', snapshot: current.snapshot }
              : { status: 'ready', snapshot: result.value },
          );
        }
      } catch (cause) {
        if (!mountedRef.current) return;
        const error = toError(cause);
        setState((current) =>
          hasSnapshot(current)
            ? { status: 'stale', snapshot: current.snapshot, error }
            : { status: 'error', error },
        );
      }
    }, [client, filterKey, galleryCoordinator, invalidQuery]);

  const loadOptions = React.useCallback(async () => {
    const result = await optionsCoordinator.run(async (signal) => {
      const [projects, providers] = await Promise.allSettled([
        client.listProjectSummaries({ signal }),
        client.listProviderConfigurations({ signal }),
      ]);
      return { projects, providers };
    });
    if (result.state !== 'current' || !mountedRef.current) return;
    setOptions({
      projects: result.value.projects.status === 'fulfilled' ? result.value.projects.value : [],
      providers:
        result.value.providers.status === 'fulfilled' ? result.value.providers.value : [],
      projectsLoaded: result.value.projects.status === 'fulfilled',
      providersLoaded: result.value.providers.status === 'fulfilled',
      hasError:
        result.value.projects.status === 'rejected' ||
        result.value.providers.status === 'rejected',
    });
  }, [client, optionsCoordinator]);

  React.useEffect(() => {
    snapshotRef.current = hasSnapshot(state) ? state.snapshot : null;
  }, [state]);

  React.useEffect(() => {
    mountedRef.current = true;
    void loadOptions();
    return () => {
      mountedRef.current = false;
      optionsCoordinator.cancel();
    };
  }, [loadOptions, optionsCoordinator]);

  React.useEffect(() => {
    void loadGallery(false);
    return () => {
      galleryCoordinator.cancel();
      loadMoreController.current?.abort();
      loadMoreController.current = null;
      revalidateAfterLoadMoreRef.current = false;
    };
  }, [galleryCoordinator, loadGallery]);

  React.useEffect(() => {
    function revalidateWhenVisible() {
      if (document.visibilityState !== 'visible') return;
      void loadOptions();
      void loadGallery(true);
    }
    document.addEventListener('visibilitychange', revalidateWhenVisible);
    return () => document.removeEventListener('visibilitychange', revalidateWhenVisible);
  }, [loadGallery, loadOptions]);

  React.useEffect(() => {
    if (activeDialog?.kind !== 'preview' || !activeDialog.handoffToGeneration) {
      return;
    }
    setActiveDialog({
      kind: 'generation',
      generationId: activeDialog.item.generationId,
      projectTitle: activeDialog.item.projectTitle,
      returnFocus: activeDialog.returnFocus,
    });
  }, [activeDialog]);

  const snapshot = hasSnapshot(state) ? state.snapshot : null;

  function changeFilters(next: GalleryFilters) {
    router.replace(galleryFiltersHref(pathname, next), { scroll: false });
  }

  async function loadMore() {
    if (!snapshot?.nextCursor || loadingMore || state.status === 'refreshing') return;
    loadMoreController.current?.abort();
    const controller = new AbortController();
    loadMoreController.current = controller;
    setLoadingMore(true);
    setLoadMoreError(false);
    const requestMutationEpoch = mutationEpochRef.current;
    try {
      const page = await client.listFavorites(
        {
          limit: PAGE_SIZE,
          cursor: snapshot.nextCursor,
          projectId: filters.workspace,
          provider: filters.provider,
          sort: 'newest',
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted || !mountedRef.current) return;
      if (requestMutationEpoch !== mutationEpochRef.current) return;
      setState((current) =>
        updateSnapshot(current, (currentSnapshot) => ({
          items: mergeUniqueGalleryItems(currentSnapshot.items, page.items),
          nextCursor: page.nextCursor,
        })),
      );
      setAnnouncement(t('gallery.loadedMore', { count: page.items.length }));
    } catch {
      if (!controller.signal.aborted && mountedRef.current) setLoadMoreError(true);
    } finally {
      if (loadMoreController.current === controller) loadMoreController.current = null;
      if (!controller.signal.aborted && mountedRef.current) setLoadingMore(false);
      if (
        !controller.signal.aborted &&
        mountedRef.current &&
        revalidateAfterLoadMoreRef.current
      ) {
        revalidateAfterLoadMoreRef.current = false;
        window.setTimeout(() => {
          if (mountedRef.current) void loadGallery(true);
        }, 0);
      }
    }
  }

  function removalFocusFallback(imageId: string): HTMLElement | null {
    const grid = gridRef.current;
    if (grid) {
      const tiles = Array.from(
        grid.querySelectorAll<HTMLElement>('[data-gallery-image-id]'),
      );
      const index = tiles.findIndex(
        (tile) => tile.dataset.galleryImageId === imageId,
      );
      const sibling = index >= 0 ? tiles[index + 1] ?? tiles[index - 1] : null;
      const siblingTrigger = sibling?.querySelector<HTMLElement>('button:not(:disabled)');
      if (siblingTrigger) return siblingTrigger;
    }
    return filtersRef.current?.querySelector<HTMLElement>('select') ?? null;
  }

  function preserveDialogReturnFocus(
    imageId: string,
    fallback: HTMLElement | null,
  ) {
    if (!fallback) return;
    setActiveDialog((current) => {
      if (!current) return current;
      const returnTile = current.returnFocus?.closest<HTMLElement>(
        '[data-gallery-image-id]',
      );
      return returnTile?.dataset.galleryImageId === imageId
        ? { ...current, returnFocus: fallback }
        : current;
    });
  }

  function focusAfterTileRemoval(fallback: HTMLElement | null) {
    window.requestAnimationFrame(() => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (activeElement?.isConnected && activeElement !== document.body) return;
      const target = fallback?.isConnected
        ? fallback
        : filtersRef.current?.querySelector<HTMLElement>('select');
      target?.focus();
    });
  }

  async function changeFavorite(item: GalleryItem, next: boolean) {
    if (pendingFavoriteIdsRef.current.has(item.imageId)) return;
    pendingFavoriteIdsRef.current.add(item.imageId);
    const removalFallback = next ? null : removalFocusFallback(item.imageId);
    mutationEpochRef.current += 1;
    galleryCoordinator.cancel();
    loadMoreController.current?.abort();
    loadMoreController.current = null;
    revalidateAfterLoadMoreRef.current = false;
    setLoadingMore(false);
    setState((current) =>
      hasSnapshot(current)
        ? { status: 'ready', snapshot: current.snapshot }
        : current,
    );
    setMutations((current) => ({
      ...current,
      [item.imageId]: { favorited: next, pending: true, error: null },
    }));
    try {
      const updatedItem = next ? await client.addFavorite(item.imageId) : null;
      if (!next) await client.removeFavorite(item.imageId);
      if (!mountedRef.current) return;
      setMutations((current) => ({
        ...current,
        [item.imageId]: { favorited: next, pending: false, error: null },
      }));
      setState((current) =>
        updateSnapshot(current, (currentSnapshot) => ({
          ...currentSnapshot,
          items: next && updatedItem && galleryItemMatchesFilters(updatedItem, filters)
            ? mergeUniqueGalleryItems([updatedItem], currentSnapshot.items)
            : currentSnapshot.items.filter((entry) => entry.imageId !== item.imageId),
        })),
      );
      if (updatedItem) {
        setActiveDialog((current) =>
          current?.kind === 'preview' && current.item.imageId === item.imageId
            ? { ...current, item: updatedItem }
            : current,
        );
      }
      if (next) {
        setAnnouncement(t('gallery.favoriteAdded'));
      } else {
        preserveDialogReturnFocus(item.imageId, removalFallback);
        setAnnouncement(t('gallery.favoriteRemoved'));
        focusAfterTileRemoval(removalFallback);
      }
    } catch {
      if (!mountedRef.current) return;
      setMutations((current) => ({
        ...current,
        [item.imageId]: {
          favorited: !next,
          pending: false,
          error: t('gallery.favoriteError'),
        },
      }));
      setAnnouncement(t('gallery.favoriteError'));
    } finally {
      pendingFavoriteIdsRef.current.delete(item.imageId);
      mutationEpochRef.current += 1;
    }
  }

  function applyDetailFavorite(change: GenerationFavoriteChange) {
    const removalFallback = change.favorited
      ? null
      : removalFocusFallback(change.imageId);
    mutationEpochRef.current += 1;
    galleryCoordinator.cancel();
    loadMoreController.current?.abort();
    loadMoreController.current = null;
    revalidateAfterLoadMoreRef.current = false;
    setLoadingMore(false);
    setMutations((current) => ({
      ...current,
      [change.imageId]: { favorited: change.favorited, pending: false, error: null },
    }));
    setState((current) =>
      updateSnapshot(current, (currentSnapshot) => ({
        ...currentSnapshot,
        items:
          change.favorited && change.galleryItem &&
          galleryItemMatchesFilters(change.galleryItem, filters)
            ? mergeUniqueGalleryItems([change.galleryItem], currentSnapshot.items)
            : currentSnapshot.items.filter((item) => item.imageId !== change.imageId),
      })),
    );
    if (change.favorited) {
      setAnnouncement(t('gallery.favoriteAdded'));
    } else {
      preserveDialogReturnFocus(change.imageId, removalFallback);
      setAnnouncement(t('gallery.favoriteRemoved'));
    }
  }

  const noFilters = !filters.workspace && !filters.provider;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={t('gallery.eyebrow')}
        title={t('gallery.title')}
        description={t('gallery.description')}
        actions={
          <div ref={filtersRef} className={styles.filters}>
            <label>
              <span>{t('gallery.workspaceFilter')}</span>
              <select
                value={filters.workspace ?? ''}
                onChange={(event) =>
                  changeFilters({
                    ...filters,
                    workspace: event.target.value || undefined,
                  })
                }
              >
                <option value="">{t('gallery.allWorkspaces')}</option>
                {filters.workspace &&
                !options.projects.some(
                  (entry) => entry.project.id === filters.workspace,
                ) ? (
                  <option value={filters.workspace}>{filters.workspace}</option>
                ) : null}
                {options.projects.map((entry) => (
                  <option key={entry.project.id} value={entry.project.id}>
                    {entry.project.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('gallery.providerFilter')}</span>
              <select
                value={filters.provider ?? ''}
                onChange={(event) =>
                  changeFilters({
                    ...filters,
                    provider: (event.target.value ||
                      undefined) as GalleryFilters['provider'],
                  })
                }
              >
                <option value="">{t('gallery.allProviders')}</option>
                {filters.provider &&
                !options.providers.some(
                  (entry) => entry.providerId === filters.provider,
                ) ? (
                  <option value={filters.provider}>{filters.provider}</option>
                ) : null}
                {options.providers.map((entry) => (
                  <option key={entry.providerId} value={entry.providerId}>
                    {entry.displayName}
                  </option>
                ))}
              </select>
            </label>
          </div>
        }
      />

      {options.hasError ? (
        <InlineNotice variant="warning" title={t('gallery.filterError')} />
      ) : null}

      {state.status === 'loading' ? <GalleryLoading /> : null}

      {state.status === 'invalid' ? (
        <InlineNotice
          variant="error"
          title={t('gallery.invalidFilter')}
          action={
            <Button type="button" variant="secondary" onClick={() => changeFilters({})}>
              {t('gallery.clearFilters')}
            </Button>
          }
        />
      ) : null}

      {state.status === 'error' ? (
        <InlineNotice
          variant="error"
          title={t('gallery.loadError')}
          action={
            <Button type="button" variant="secondary" onClick={() => void loadGallery(false)}>
              {t('common.retry')}
            </Button>
          }
        >
          <p>{state.error.message}</p>
        </InlineNotice>
      ) : null}

      {state.status === 'stale' ? (
        <InlineNotice
          variant="warning"
          title={t('gallery.loadError')}
          action={
            <Button type="button" variant="ghost" onClick={() => void loadGallery(true)}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : null}

      {snapshot?.items.length === 0 ? (
        <EmptyState
          title={
            noFilters ? t('gallery.globalEmptyTitle') : t('gallery.filteredEmptyTitle')
          }
          description={
            noFilters
              ? t('gallery.globalEmptyDescription')
              : t('gallery.filteredEmptyDescription')
          }
          action={
            noFilters ? (
              <div className={styles.emptyActions}>
                <Button asChild>
                  <Link href={workspaceRoute(projectId, 'generate')}>
                    {t('gallery.goGenerate')}
                  </Link>
                </Button>
                <Button asChild variant="ghost">
                  <Link href={workspaceRoute(projectId, 'history')}>
                    {t('gallery.goHistory')}
                  </Link>
                </Button>
              </div>
            ) : (
              <Button type="button" variant="secondary" onClick={() => changeFilters({})}>
                {t('gallery.clearFilters')}
              </Button>
            )
          }
        />
      ) : null}

      {snapshot && snapshot.items.length > 0 ? (
        <>
          <div
            ref={gridRef}
            className={styles.grid}
            aria-busy={state.status === 'refreshing' || undefined}
          >
            {snapshot.items.map((item) => {
              const mutation = mutations[item.imageId];
              return (
                <GalleryTile
                  key={item.favoriteId}
                  item={item}
                  favorited={mutation?.favorited ?? true}
                  favoritePending={mutation?.pending ?? false}
                  onOpen={(returnFocus) =>
                    setActiveDialog(
                      item.url === null
                        ? {
                            kind: 'generation',
                            generationId: item.generationId,
                            projectTitle: item.projectTitle,
                            returnFocus,
                          }
                        : { kind: 'preview', item, returnFocus },
                    )
                  }
                  onFavoriteChange={(next) => void changeFavorite(item, next)}
                />
              );
            })}
          </div>
          <div className={styles.loadMoreArea}>
            {loadMoreError ? (
              <p role="alert">{t('gallery.loadMoreError')}</p>
            ) : null}
            {snapshot.nextCursor ? (
              <LoadMoreButton
                label={t('gallery.loadMore')}
                loadingLabel={t('gallery.loadingMore')}
                loading={loadingMore}
                disabled={state.status === 'refreshing'}
                onClick={() => void loadMore()}
              />
            ) : (
              <span>{t('gallery.endOfResults')}</span>
            )}
          </div>
        </>
      ) : null}

      <p className="sr-only" aria-live="polite">{announcement}</p>

      {activeDialog?.kind === 'preview' && activeDialog.item.url !== null ? (
        <ImagePreviewDialog
          open
          onOpenChange={(open) => {
            if (!open) setActiveDialog(null);
          }}
          image={{
            id: activeDialog.item.imageId,
            url: activeDialog.item.url,
            width: activeDialog.item.width,
            height: activeDialog.item.height,
          }}
          prompt={activeDialog.item.prompt}
          projectTitle={activeDialog.item.projectTitle}
          provider={activeDialog.item.provider}
          model={activeDialog.item.model}
          favoritedAt={activeDialog.item.favoritedAt}
          favorited={mutations[activeDialog.item.imageId]?.favorited ?? true}
          favoritePending={mutations[activeDialog.item.imageId]?.pending}
          favoriteError={mutations[activeDialog.item.imageId]?.error}
          onFavoriteChange={(next) => void changeFavorite(activeDialog.item, next)}
          onViewGeneration={() =>
            setActiveDialog((current) =>
              current?.kind === 'preview'
                ? { ...current, handoffToGeneration: true }
                : current,
            )
          }
          returnFocus={activeDialog.returnFocus}
          suppressReturnFocus={activeDialog.handoffToGeneration}
        />
      ) : null}

      {activeDialog?.kind === 'generation' ? (
        <GenerationDetailDialog
          generationId={activeDialog.generationId}
          open
          onOpenChange={(open) => {
            if (!open) setActiveDialog(null);
          }}
          projectTitle={activeDialog.projectTitle}
          returnFocus={activeDialog.returnFocus}
          onFavoriteChange={applyDetailFavorite}
        />
      ) : null}
    </div>
  );
}

function GalleryLoading() {
  const { t } = useLocale();
  return (
    <div
      className={styles.loadingGrid}
      role="status"
      aria-label={t('common.loading')}
    >
      {Array.from({ length: 12 }, (_, index) => <span key={index} />)}
    </div>
  );
}
