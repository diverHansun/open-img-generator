'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { GenerationDetailDialog } from '@/components/dialogs/generation-detail-dialog';
import { useLocale } from '@/components/i18n/locale-provider';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineNotice } from '@/components/ui/inline-notice';
import { Pagination } from '@/components/ui/pagination';
import { workspaceRoute } from '@/lib/routes';
import {
  getBrowserWebClientRuntime,
  LatestRequestCoordinator,
  type HistoryPage,
} from '@/lib/web-client';

import {
  appendHistoryGroupPage,
  mergeHistoryRefresh,
  parseHistoryPage,
} from './history-state';
import {
  HistorySessionGroup,
  type HistoryGroupLoadState,
} from './history-session-group';
import styles from './history-screen.module.css';

type HistoryState =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready' | 'refreshing'; page: HistoryPage }
  | { status: 'stale'; page: HistoryPage; error: Error };

type ActiveDetail = {
  generationId: string;
  returnFocus: HTMLElement | null;
};

function hasPage(
  state: HistoryState,
): state is Extract<HistoryState, { page: HistoryPage }> {
  return 'page' in state;
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error('History request failed');
}

function historyPageHref(pathname: string, page: number): string {
  return page <= 1 ? pathname : pathname + '?page=' + page;
}

export function HistoryScreen({ projectId }: { projectId: string }) {
  const { client } = React.useMemo(() => getBrowserWebClientRuntime(), []);
  const coordinator = React.useMemo(() => new LatestRequestCoordinator(), []);
  const { t } = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedPage = parseHistoryPage(searchParams.get('page'));
  const mountedRef = React.useRef(false);
  const resolvedPageRef = React.useRef<number | null>(null);
  const groupControllers = React.useRef(new Map<string, AbortController>());
  const [state, setState] = React.useState<HistoryState>({ status: 'loading' });
  const [expandedSessions, setExpandedSessions] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [groupLoads, setGroupLoads] = React.useState<
    Record<string, HistoryGroupLoadState>
  >({});
  const [detail, setDetail] = React.useState<ActiveDetail | null>(null);
  const [announcement, setAnnouncement] = React.useState('');

  const loadHistory = React.useCallback(
    async (background: boolean) => {
      setState((current) => {
        if (background && hasPage(current)) {
          return { status: 'refreshing', page: current.page };
        }
        return { status: 'loading' };
      });
      try {
        const result = await coordinator.run((signal) =>
          client.getProjectHistory(
            projectId,
            { page: requestedPage, sessionLimit: 5, generationLimit: 10 },
            { signal },
          ),
        );
        if (result.state !== 'current' || !mountedRef.current) return;

        const lastPage = Math.max(result.value.totalPages, 1);
        const normalizedPage = Math.min(requestedPage, lastPage);
        if (normalizedPage !== requestedPage) {
          router.replace(historyPageHref(pathname, normalizedPage));
          return;
        }

        setState((current) => ({
          status: 'ready',
          page: background && hasPage(current)
            ? mergeHistoryRefresh(current.page, result.value)
            : result.value,
        }));
        const changedPage = resolvedPageRef.current !== result.value.page;
        resolvedPageRef.current = result.value.page;
        setExpandedSessions((current) => {
          if (changedPage) {
            const firstSession = result.value.groups[0]?.session.id;
            return new Set(firstSession ? [firstSession] : []);
          }
          const valid = new Set(
            [...current].filter((sessionId) =>
              result.value.groups.some((group) => group.session.id === sessionId),
            ),
          );
          return valid;
        });
      } catch (cause) {
        if (!mountedRef.current) return;
        const error = toError(cause);
        setState((current) =>
          hasPage(current)
            ? { status: 'stale', page: current.page, error }
            : { status: 'error', error },
        );
      }
    }, [client, coordinator, pathname, projectId, requestedPage, router]);

  React.useEffect(() => {
    mountedRef.current = true;
    setGroupLoads({});
    for (const controller of groupControllers.current.values()) controller.abort();
    groupControllers.current.clear();
    void loadHistory(false);
    return () => {
      mountedRef.current = false;
      coordinator.cancel();
      for (const controller of groupControllers.current.values()) controller.abort();
      groupControllers.current.clear();
    };
  }, [coordinator, loadHistory]);

  React.useEffect(() => {
    function revalidateWhenVisible() {
      if (document.visibilityState === 'visible') void loadHistory(true);
    }
    document.addEventListener('visibilitychange', revalidateWhenVisible);
    return () => document.removeEventListener('visibilitychange', revalidateWhenVisible);
  }, [loadHistory]);

  const page = hasPage(state) ? state.page : null;

  async function loadMore(sessionId: string) {
    const group = page?.groups.find((candidate) => candidate.session.id === sessionId);
    if (!group?.nextCursor || groupLoads[sessionId]?.loading) return;

    groupControllers.current.get(sessionId)?.abort();
    const controller = new AbortController();
    groupControllers.current.set(sessionId, controller);
    setGroupLoads((current) => ({
      ...current,
      [sessionId]: { loading: true, error: false },
    }));
    try {
      const nextPage = await client.listGenerations(
        { sessionId, cursor: group.nextCursor, limit: 10 },
        { signal: controller.signal },
      );
      if (controller.signal.aborted || !mountedRef.current) return;
      setState((current) => {
        if (!hasPage(current) || current.page.page !== requestedPage) return current;
        return {
          status: 'ready',
          page: {
            ...current.page,
            groups: current.page.groups.map((currentGroup) =>
              currentGroup.session.id === sessionId
                ? appendHistoryGroupPage(currentGroup, nextPage)
                : currentGroup,
            ),
          },
        };
      });
      setGroupLoads((current) => ({
        ...current,
        [sessionId]: { loading: false, error: false },
      }));
      setAnnouncement(t('history.loadedMore', { count: nextPage.items.length }));
    } catch {
      if (controller.signal.aborted || !mountedRef.current) return;
      setGroupLoads((current) => ({
        ...current,
        [sessionId]: { loading: false, error: true },
      }));
    } finally {
      if (groupControllers.current.get(sessionId) === controller) {
        groupControllers.current.delete(sessionId);
      }
    }
  }

  const description = page
    ? t('history.summary', {
        sessions: page.totalSessions,
        generations: page.totals.generations,
        images: page.totals.images,
      })
    : t('history.description');

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={t('history.eyebrow')}
        title={t('history.title')}
        description={description}
      />

      {state.status === 'loading' ? <HistoryLoading /> : null}

      {state.status === 'error' ? (
        <InlineNotice
          variant="error"
          title={t('history.loadError')}
          action={
            <Button type="button" variant="secondary" onClick={() => void loadHistory(false)}>
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
          title={t('history.loadError')}
          action={
            <Button type="button" variant="ghost" onClick={() => void loadHistory(true)}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : null}

      {page && page.groups.length === 0 ? (
        <EmptyState
          title={t('history.emptyTitle')}
          description={t('history.emptyDescription')}
          action={
            <Button asChild>
              <Link href={workspaceRoute(projectId, 'generate')}>
                {t('history.goGenerate')}
              </Link>
            </Button>
          }
        />
      ) : null}

      {page && page.groups.length > 0 ? (
        <>
          <div
            className={styles.groups}
            aria-busy={state.status === 'refreshing' || undefined}
          >
            {page.groups.map((group) => (
              <HistorySessionGroup
                key={group.session.id}
                group={group}
                expanded={expandedSessions.has(group.session.id)}
                loadState={groupLoads[group.session.id] ?? { loading: false, error: false }}
                onExpandedChange={(expanded) =>
                  setExpandedSessions((current) => {
                    const next = new Set(current);
                    if (expanded) next.add(group.session.id);
                    else next.delete(group.session.id);
                    return next;
                  })
                }
                onLoadMore={() => void loadMore(group.session.id)}
                onOpenDetail={(generationId, returnFocus) =>
                  setDetail({ generationId, returnFocus })
                }
              />
            ))}
          </div>
          <div className={styles.pagination}>
            <Pagination
              currentPage={page.page}
              totalPages={page.totalPages}
              previousLabel={t('history.previous')}
              nextLabel={t('history.next')}
              pageLabel={(number) => t('history.page', { page: number })}
              onPageChange={(number) => router.push(historyPageHref(pathname, number))}
            />
          </div>
        </>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {detail ? (
        <GenerationDetailDialog
          generationId={detail.generationId}
          open
          onOpenChange={(open) => {
            if (!open) setDetail(null);
          }}
          returnFocus={detail.returnFocus}
        />
      ) : null}
    </div>
  );
}

function HistoryLoading() {
  const { t } = useLocale();
  return (
    <div className={styles.loading} role="status" aria-label={t('common.loading')}>
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}
