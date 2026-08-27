'use client';

import * as React from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';

import { useLocale } from '@/components/i18n/locale-provider';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { InlineNotice } from '@/components/ui/inline-notice';
import { Input } from '@/components/ui/input';
import {
  ApiClientError,
  getBrowserWebClientRuntime,
  LatestRequestCoordinator,
  type ProviderConfiguration,
  type ProviderId,
} from '@/lib/web-client';
import { workspaceRoute } from '@/lib/routes';

import { ModelRow, type ModelRowState } from './model-row';
import {
  buildModelGroups,
  filterModelGroups,
  type ModelViewGroup,
  type ModelViewRow,
} from './model-view';
import styles from './models.module.css';

type ModelSnapshot = {
  configurations: ProviderConfiguration[];
  groups: ModelViewGroup[];
};

type ModelsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready' | 'refreshing'; snapshot: ModelSnapshot }
  | { status: 'stale'; snapshot: ModelSnapshot };

function initialRowStates(groups: ModelViewGroup[]): Record<string, ModelRowState> {
  return Object.fromEntries(
    groups.flatMap((group) =>
      group.rows.map((row) => [
        row.key,
        {
          confirmedEnabled: row.enabled,
          displayedEnabled: row.enabled,
          saving: false,
          error: false,
        } satisfies ModelRowState,
      ]),
    ),
  );
}

function hasSnapshot(state: ModelsState): state is Exclude<ModelsState, { status: 'loading' | 'error' }> {
  return 'snapshot' in state;
}

export function ModelsScreen({ projectId }: { projectId: string }) {
  const client = React.useMemo(() => getBrowserWebClientRuntime().client, []);
  const coordinator = React.useMemo(() => new LatestRequestCoordinator(), []);
  const { t } = useLocale();
  const mountedRef = React.useRef(false);
  const inFlightRowsRef = React.useRef(new Set<string>());
  const pendingRevalidationRef = React.useRef(false);
  const [state, setState] = React.useState<ModelsState>({ status: 'loading' });
  const [rowStates, setRowStates] = React.useState<Record<string, ModelRowState>>({});
  const [query, setQuery] = React.useState('');
  const [providerFilter, setProviderFilter] = React.useState<ProviderId | 'all'>('all');
  const [expandedRows, setExpandedRows] = React.useState<Set<string>>(() => new Set());

  const loadModels = React.useCallback(
    async (background: boolean) => {
      setState((current) => {
        if (background && hasSnapshot(current)) {
          return { status: 'refreshing', snapshot: current.snapshot };
        }
        return { status: 'loading' };
      });

      try {
        const result = await coordinator.run(async (signal) => {
          const [configurations, preferenceResult] = await Promise.all([
            client.listProviderConfigurations({ signal }),
            client.listModelPreferences({ signal }),
          ]);
          return { configurations, preferences: preferenceResult.items };
        });
        if (result.state !== 'current' || !mountedRef.current) return;

        const groups = buildModelGroups(result.value.configurations, result.value.preferences);
        const snapshot = { configurations: result.value.configurations, groups };
        setRowStates(initialRowStates(groups));
        setProviderFilter((current) =>
          current === 'all' || groups.some((group) => group.providerId === current)
            ? current
            : 'all',
        );
        setState({ status: 'ready', snapshot });
      } catch {
        if (!mountedRef.current) return;
        setState((current) =>
          hasSnapshot(current) ? { status: 'stale', snapshot: current.snapshot } : { status: 'error' },
        );
      }
    },
    [client, coordinator],
  );

  React.useEffect(() => {
    mountedRef.current = true;
    void loadModels(false);
    return () => {
      mountedRef.current = false;
      coordinator.cancel();
    };
  }, [coordinator, loadModels]);

  React.useEffect(() => {
    function revalidateWhenVisible() {
      if (document.visibilityState !== 'visible') return;
      if (inFlightRowsRef.current.size > 0) {
        pendingRevalidationRef.current = true;
        return;
      }
      void loadModels(true);
    }
    document.addEventListener('visibilitychange', revalidateWhenVisible);
    return () => document.removeEventListener('visibilitychange', revalidateWhenVisible);
  }, [loadModels]);

  async function changeModelPreference(row: ModelViewRow, enabled: boolean) {
    const current = rowStates[row.key];
    if (!current || current.saving || inFlightRowsRef.current.has(row.key)) return;

    // A list GET started before this write may have already read the old
    // preference. Cancel it so it cannot overwrite the confirmed row state.
    coordinator.cancel();
    setState((currentState) =>
      hasSnapshot(currentState)
        ? { status: 'ready', snapshot: currentState.snapshot }
        : currentState,
    );
    inFlightRowsRef.current.add(row.key);
    setRowStates((all) => ({
      ...all,
      [row.key]: {
        ...current,
        displayedEnabled: enabled,
        saving: true,
        error: false,
      },
    }));

    try {
      const confirmed = await client.upsertModelPreference({
        provider: row.providerId,
        model: row.capability.model,
        enabled,
      });
      if (!mountedRef.current) return;
      setRowStates((all) => ({
        ...all,
        [row.key]: {
          confirmedEnabled: confirmed.enabled,
          displayedEnabled: confirmed.enabled,
          saving: false,
          error: false,
        },
      }));
    } catch (cause) {
      if (!mountedRef.current) return;
      if (cause instanceof ApiClientError && cause.status === 400) {
        pendingRevalidationRef.current = true;
      }
      setRowStates((all) => ({
        ...all,
        [row.key]: {
          confirmedEnabled: current.confirmedEnabled,
          displayedEnabled: current.confirmedEnabled,
          saving: false,
          error: true,
        },
      }));
    } finally {
      inFlightRowsRef.current.delete(row.key);
      if (
        mountedRef.current &&
        inFlightRowsRef.current.size === 0 &&
        pendingRevalidationRef.current
      ) {
        pendingRevalidationRef.current = false;
        void loadModels(true);
      }
    }
  }

  const snapshot = hasSnapshot(state) ? state.snapshot : null;
  const filteredGroups = React.useMemo(
    () => (snapshot ? filterModelGroups(snapshot.groups, query, providerFilter) : []),
    [providerFilter, query, snapshot],
  );
  const unconfiguredCount =
    snapshot?.configurations.filter((configuration) => !configuration.configured).length ?? 0;
  const totalModels = snapshot?.groups.reduce((sum, group) => sum + group.rows.length, 0) ?? 0;
  const enabledModels =
    snapshot?.groups.reduce(
      (sum, group) =>
        sum +
        group.rows.filter(
          (row) => rowStates[row.key]?.displayedEnabled ?? row.enabled,
        ).length,
      0,
    ) ?? 0;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={t('models.eyebrow')}
        title={t('models.title')}
        description={t('models.description')}
        actions={
          <div className={styles.toolbar}>
            <label className={styles.searchField}>
              <span className="sr-only">{t('models.searchLabel')}</span>
              <Search aria-hidden="true" />
              <Input
                value={query}
                disabled={!snapshot}
                placeholder={t('models.searchPlaceholder')}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className={styles.filterField}>
              <span className="sr-only">{t('models.providerFilterLabel')}</span>
              <select
                value={providerFilter}
                disabled={!snapshot}
                aria-label={t('models.providerFilterLabel')}
                onChange={(event) => setProviderFilter(event.target.value as ProviderId | 'all')}
              >
                <option value="all">{t('models.allProviders')}</option>
                {snapshot?.groups.map((group) => (
                  <option value={group.providerId} key={group.providerId}>
                    {group.providerName}
                  </option>
                ))}
              </select>
            </label>
          </div>
        }
      />

      {state.status === 'loading' ? <ModelsLoading /> : null}

      {state.status === 'error' ? (
        <InlineNotice
          variant="error"
          title={t('models.loadError')}
          action={
            <Button type="button" variant="secondary" onClick={() => void loadModels(false)}>
              {t('common.retry')}
            </Button>
          }
        >
          <p>{t('models.loadErrorDetail')}</p>
        </InlineNotice>
      ) : null}

      {state.status === 'stale' ? (
        <InlineNotice
          variant="warning"
          title={t('models.staleWarning')}
          action={
            <Button type="button" variant="secondary" onClick={() => void loadModels(true)}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : null}

      {state.status === 'refreshing' ? (
        <p className="sr-only" role="status" aria-live="polite">
          {t('models.updating')}
        </p>
      ) : null}

      {snapshot ? (
        <>
          {unconfiguredCount > 0 && snapshot.groups.length > 0 ? (
            <div className={styles.configurationHint}>
              <span>{t('models.unconfiguredHint')}</span>
              <Link href={workspaceRoute(projectId, 'providers')}>
                {t('models.configureProviders')}
              </Link>
            </div>
          ) : null}

          {snapshot.groups.length === 0 ? (
            <section className={styles.emptyState}>
              <h2>{t('models.noConfiguredTitle')}</h2>
              <p>{t('models.noConfiguredDescription')}</p>
              <Button asChild>
                <Link href={workspaceRoute(projectId, 'providers')}>
                  {t('models.configureProviders')}
                </Link>
              </Button>
            </section>
          ) : filteredGroups.length === 0 ? (
            <section className={styles.emptyState}>
              <h2>{t('models.noResultsTitle')}</h2>
              <p>{t('models.noResultsDescription')}</p>
            </section>
          ) : (
            <div className={styles.groups}>
              {filteredGroups.map((group) => {
                const enabledCount = group.rows.filter(
                  (row) => rowStates[row.key]?.displayedEnabled ?? row.enabled,
                ).length;
                return (
                  <section className={styles.group} key={group.providerId}>
                    <header className={styles.groupHeader}>
                      <h2>{group.providerName}</h2>
                      <span>
                        {t('models.groupCount', {
                          enabled: enabledCount,
                          total: group.rows.length,
                        })}
                      </span>
                    </header>
                    <ul className={styles.modelList}>
                      {group.rows.map((row) => (
                        <ModelRow
                          key={row.key}
                          row={row}
                          state={
                            rowStates[row.key] ?? {
                              confirmedEnabled: row.enabled,
                              displayedEnabled: row.enabled,
                              saving: false,
                              error: false,
                            }
                          }
                          expanded={expandedRows.has(row.key)}
                          onExpandedChange={(expanded) =>
                            setExpandedRows((current) => {
                              const next = new Set(current);
                              if (expanded) next.add(row.key);
                              else next.delete(row.key);
                              return next;
                            })
                          }
                          onEnabledChange={(enabled) => void changeModelPreference(row, enabled)}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}
              <p className={styles.totalSummary}>
                {t('models.totalEnabled', { enabled: enabledModels, total: totalModels })}
              </p>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function ModelsLoading() {
  const { t } = useLocale();
  return (
    <div className={styles.loading} role="status" aria-label={t('common.loading')}>
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}
