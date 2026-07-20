'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';

import { GenerationStatus } from '@/components/generation/generation-status';
import { ThumbnailStrip } from '@/components/generation/thumbnail-strip';
import { useLocale } from '@/components/i18n/locale-provider';
import { LoadMoreButton } from '@/components/ui/load-more-button';
import { formatDateTime, formatRelativeTime } from '@/lib/i18n/format';
import { accessibleExcerpt } from '@/lib/a11y';
import type { GenerationSummary, HistoryGroup } from '@/lib/web-client';

import styles from './history-screen.module.css';

function generationTargets(item: GenerationSummary) {
  const seen = new Set<string>();
  return item.jobs.filter((job) => {
    const key = job.provider + ':' + job.model;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type HistoryGroupLoadState = {
  loading: boolean;
  error: boolean;
};

export function HistorySessionGroup({
  group,
  expanded,
  loadState,
  onExpandedChange,
  onLoadMore,
  onOpenDetail,
}: {
  group: HistoryGroup;
  expanded: boolean;
  loadState: HistoryGroupLoadState;
  onExpandedChange: (expanded: boolean) => void;
  onLoadMore: () => void;
  onOpenDetail: (generationId: string, trigger: HTMLElement) => void;
}) {
  const { locale, t } = useLocale();
  const sessionName = group.session.title?.trim() || t('history.untitledSession');
  const contentId = 'history-session-' + group.session.id;
  const triggerId = contentId + '-trigger';

  return (
    <section className={styles.group}>
      <button
        id={triggerId}
        type="button"
        className={styles.groupToggle}
        aria-expanded={expanded}
        aria-controls={contentId}
        aria-label={
          expanded
            ? t('history.collapseSession', { name: sessionName })
            : t('history.expandSession', { name: sessionName })
        }
        onClick={() => onExpandedChange(!expanded)}
      >
        <ChevronDown data-expanded={expanded || undefined} aria-hidden="true" />
        <span className={styles.groupIdentity}>
          <strong title={sessionName}>{sessionName}</strong>
          <code title={group.session.id}>{group.session.id}</code>
        </span>
        <span className={styles.groupCounts}>
          {t('history.groupCounts', {
            generations: group.generationCount,
            images: group.imageCount,
          })}
        </span>
        <time
          dateTime={group.lastGenerationAt}
          title={formatDateTime(group.lastGenerationAt, locale)}
        >
          {formatRelativeTime(group.lastGenerationAt, locale)}
        </time>
      </button>

      {expanded ? (
        <div
          id={contentId}
          className={styles.groupContent}
          role="region"
          aria-labelledby={triggerId}
        >
          <div className={styles.columnHeader} aria-hidden="true">
            <span />
            <span>{t('history.promptColumn')}</span>
            <span>{t('history.modelColumn')}</span>
            <span>{t('history.statusColumn')}</span>
            <span>{t('history.updatedColumn')}</span>
          </div>

          <div className={styles.generationList}>
            {group.items.map((item) => {
              const targets = generationTargets(item);
              const firstTarget = targets[0];
              const accessiblePrompt = accessibleExcerpt(item.prompt);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={styles.generationRow}
                  aria-label={t('history.openDetail', { prompt: accessiblePrompt })}
                  onClick={(event) => onOpenDetail(item.id, event.currentTarget)}
                >
                  <ThumbnailStrip
                    images={item.images}
                    alt={accessiblePrompt}
                    max={6}
                    moreLabel={(count) => t('history.moreImages', { count })}
                    emptyLabel={t('history.noImages')}
                  />
                  <span className={styles.prompt} title={item.prompt}>
                    {item.prompt}
                  </span>
                  <span className={styles.target}>
                    {firstTarget ? (
                      <>
                        <strong>{firstTarget.provider}</strong>
                        <code title={firstTarget.model}>{firstTarget.model}</code>
                        {targets.length > 1 ? (
                          <small>
                            {t('history.moreTargets', { count: targets.length - 1 })}
                          </small>
                        ) : null}
                      </>
                    ) : (
                      <span aria-hidden="true">—</span>
                    )}
                  </span>
                  <GenerationStatus status={item.status} jobs={item.jobs} compact />
                  <time
                    dateTime={item.updatedAt}
                    title={formatDateTime(item.updatedAt, locale)}
                  >
                    {formatRelativeTime(item.updatedAt, locale)}
                  </time>
                </button>
              );
            })}
          </div>

          {loadState.error ? (
            <p className={styles.groupError} role="alert">
              {t('history.groupLoadError')}
            </p>
          ) : null}

          {group.nextCursor ? (
            <div className={styles.groupFooter}>
              <LoadMoreButton
                label={t('history.loadMore')}
                loadingLabel={t('history.loadingMore')}
                loading={loadState.loading}
                onClick={onLoadMore}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
