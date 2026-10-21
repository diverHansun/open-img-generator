'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Image as ImageIcon, Plus } from 'lucide-react';

import { useLocale } from '@/components/i18n/locale-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { workspaceRoute } from '@/lib/routes';
import {
  getBrowserWebClientRuntime,
  LatestRequestCoordinator,
  type ProjectSummary,
} from '@/lib/web-client';

import styles from './home-screen.module.css';

export function HomeScreen() {
  const client = React.useMemo(() => getBrowserWebClientRuntime().client, []);
  const coordinator = React.useMemo(() => new LatestRequestCoordinator(), []);
  const router = useRouter();
  const { locale, t } = useLocale();
  const [summaries, setSummaries] = React.useState<ProjectSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<Error | null>(null);
  const [title, setTitle] = React.useState('');
  const [createError, setCreateError] = React.useState('');
  const [creating, setCreating] = React.useState(false);

  const loadSummaries = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await coordinator.run((signal) =>
        client.listProjectSummaries({ signal }),
      );
      if (result.state === 'current') setSummaries(result.value);
    } catch (cause) {
      setLoadError(
        cause instanceof Error ? cause : new Error('Unknown project summary request error'),
      );
    } finally {
      setLoading(false);
    }
  }, [client, coordinator]);

  React.useEffect(() => {
    void loadSummaries();
    return () => coordinator.cancel();
  }, [coordinator, loadSummaries]);

  async function createWorkspace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle || creating) return;
    setCreating(true);
    setCreateError('');
    try {
      const project = await client.createProject(nextTitle);
      router.push(workspaceRoute(project.id, 'generate'));
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : t('home.createError'));
      setCreating(false);
    }
  }

  const formatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'zh-CN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [locale],
  );

  return (
    <div className={styles.page}>
      <p className={styles.leadNote}>{t('home.description')}</p>

      <section className={styles.createCard} aria-labelledby="create-workspace-title">
        <div className={styles.createHead}>
          <h1 id="create-workspace-title">{t('home.createTitle')}</h1>
          <span>{t('home.createDescription')}</span>
        </div>
        <form className={styles.createForm} onSubmit={createWorkspace}>
          <label className="sr-only" htmlFor="workspace-title">
            {t('home.nameLabel')}
          </label>
          <div className={styles.createRow}>
            <Input
              id="workspace-title"
              value={title}
              placeholder={t('home.namePlaceholder')}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={160}
            />
            <Button type="submit" disabled={!title.trim() || creating}>
              <Plus aria-hidden="true" />
              {creating ? t('home.creating') : t('home.create')}
            </Button>
          </div>
          {createError ? <p className={styles.error}>{createError}</p> : null}
        </form>
      </section>

      <section className={styles.recent} aria-labelledby="recent-workspaces-title">
        <div className={styles.rowHead}>
          <h2 id="recent-workspaces-title">{t('home.recent')}</h2>
          {!loading ? <span className={styles.countBadge}>{summaries.length}</span> : null}
        </div>

        {loading ? (
          <div
            className={styles.loadingRows}
            role="status"
            aria-label={t('common.loading')}
          >
            <span />
            <span />
            <span />
          </div>
        ) : loadError ? (
          <div className={styles.inlineState}>
            <div>
              <strong>{t('home.loadError')}</strong>
              <small>{loadError.message}</small>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => void loadSummaries()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : summaries.length === 0 ? (
          <div className={styles.emptyCard}>
            <p className={styles.empty}>{t('home.empty')}</p>
          </div>
        ) : (
          <div className={styles.workspaceList}>
            {summaries.map((summary) => (
              <Link
                key={summary.project.id}
                className={styles.workspaceRow}
                href={workspaceRoute(summary.project.id, 'generate')}
              >
                <div className={styles.cover}>
                  {summary.coverImageUrl ? (
                    // The API owns these same-origin image URLs; dimensions are stabilized by CSS.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={summary.coverImageUrl} alt="" />
                  ) : (
                    <ImageIcon aria-hidden="true" />
                  )}
                </div>
                <div className={styles.workspaceCopy}>
                  <h3>{summary.project.title}</h3>
                  <p>
                    {t('home.updated', {
                      time: formatter.format(new Date(summary.lastActivityAt)),
                    })}
                  </p>
                </div>
                <div className={styles.counts}>
                  <span>{t('home.sessions', { count: summary.sessionCount })}</span>
                  <span>{t('home.generations', { count: summary.generationCount })}</span>
                  <span>{t('home.images', { count: summary.imageCount })}</span>
                </div>
                <ChevronRight className={styles.rowArrow} aria-hidden="true" />
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
