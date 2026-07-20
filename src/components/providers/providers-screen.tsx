'use client';

import * as React from 'react';

import { useLocale } from '@/components/i18n/locale-provider';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { InlineNotice } from '@/components/ui/inline-notice';
import {
  ApiClientError,
  getBrowserWebClientRuntime,
  LatestRequestCoordinator,
  type ProviderConfiguration,
} from '@/lib/web-client';

import { ProviderDirectory } from './provider-presentation';
import styles from './providers.module.css';

type ProvidersState =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | {
      status: 'ready' | 'refreshing';
      configurations: ProviderConfiguration[];
    }
  | {
      status: 'stale';
      configurations: ProviderConfiguration[];
      error: Error;
    };

function hasConfigurations(
  state: ProvidersState,
): state is Extract<ProvidersState, { configurations: ProviderConfiguration[] }> {
  return 'configurations' in state;
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error('Provider request failed');
}

function isStorageUnavailable(error: Error): boolean {
  return (
    error instanceof ApiClientError &&
    error.code === 'CONFIGURATION_UNAVAILABLE'
  );
}

export function ProvidersScreen({ projectId }: { projectId: string }) {
  const { t } = useLocale();
  const client = React.useMemo(() => getBrowserWebClientRuntime().client, []);
  const coordinator = React.useMemo(() => new LatestRequestCoordinator(), []);
  const mountedRef = React.useRef(false);
  const [state, setState] = React.useState<ProvidersState>({ status: 'loading' });

  const loadConfigurations = React.useCallback(
    async (background: boolean) => {
      setState((current) =>
        background && hasConfigurations(current)
          ? { status: 'refreshing', configurations: current.configurations }
          : { status: 'loading' },
      );
      try {
        const result = await coordinator.run((signal) =>
          client.listProviderConfigurations({ signal }),
        );
        if (result.state !== 'current' || !mountedRef.current) return;
        setState({ status: 'ready', configurations: result.value });
      } catch (cause) {
        if (!mountedRef.current) return;
        const error = toError(cause);
        setState((current) =>
          hasConfigurations(current)
            ? {
                status: 'stale',
                configurations: current.configurations,
                error,
              }
            : { status: 'error', error },
        );
      }
    },
    [client, coordinator],
  );

  React.useEffect(() => {
    mountedRef.current = true;
    void loadConfigurations(false);
    return () => {
      mountedRef.current = false;
      coordinator.cancel();
    };
  }, [coordinator, loadConfigurations]);

  React.useEffect(() => {
    function revalidateWhenVisible() {
      if (document.visibilityState === 'visible') {
        void loadConfigurations(true);
      }
    }
    document.addEventListener('visibilitychange', revalidateWhenVisible);
    return () =>
      document.removeEventListener('visibilitychange', revalidateWhenVisible);
  }, [loadConfigurations]);

  const configurations = hasConfigurations(state)
    ? state.configurations
    : null;
  const stateError = 'error' in state ? state.error : null;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={t('providers.eyebrow')}
        title={t('providers.title')}
        description={t('providers.description')}
      />

      {state.status === 'loading' ? <ProviderDirectoryLoading /> : null}

      {state.status === 'error' ? (
        <InlineNotice
          variant="error"
          title={t('providers.loadErrorTitle')}
          action={
            <Button
              type="button"
              variant="secondary"
              onClick={() => void loadConfigurations(false)}
            >
              {t('common.retry')}
            </Button>
          }
        >
          <p>
            {stateError && isStorageUnavailable(stateError)
              ? t('providers.storageUnavailable')
              : t('providers.loadErrorDescription')}
          </p>
        </InlineNotice>
      ) : null}

      {state.status === 'stale' ? (
        <InlineNotice
          variant="warning"
          title={t('providers.staleWarning')}
          action={
            <Button
              type="button"
              variant="secondary"
              onClick={() => void loadConfigurations(true)}
            >
              {t('common.retry')}
            </Button>
          }
        >
          {stateError && isStorageUnavailable(stateError) ? (
            <p>{t('providers.storageUnavailable')}</p>
          ) : null}
        </InlineNotice>
      ) : null}

      {state.status === 'refreshing' ? (
        <p className="sr-only" role="status" aria-live="polite">
          {t('providers.updating')}
        </p>
      ) : null}

      {configurations ? (
        configurations.length > 0 ? (
          <ProviderDirectory
            projectId={projectId}
            configurations={configurations}
            busy={state.status === 'refreshing'}
          />
        ) : (
          <section className={styles.emptyState}>
            <h2>{t('providers.emptyTitle')}</h2>
            <p>{t('providers.emptyDescription')}</p>
          </section>
        )
      ) : null}

      <p className={styles.securityNote}>{t('providers.securityNote')}</p>
    </div>
  );
}

function ProviderDirectoryLoading() {
  const { t } = useLocale();
  return (
    <div
      className={styles.loadingDirectory}
      aria-label={t('providers.loadingDirectory')}
      role="status"
    >
      {Array.from({ length: 7 }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}
