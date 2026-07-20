'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, KeyRound } from 'lucide-react';

import { CapabilityList } from '@/components/capabilities/capability-list';
import { useLocale } from '@/components/i18n/locale-provider';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { InlineNotice } from '@/components/ui/inline-notice';
import { PasswordField } from '@/components/ui/password-field';
import type { TranslationKey } from '@/lib/i18n';
import { workspaceRoute } from '@/lib/routes';
import {
  ApiClientError,
  getBrowserWebClientRuntime,
  LatestRequestCoordinator,
  saveProviderCredentialDraft,
  type CredentialSource,
  type ProviderConfiguration,
} from '@/lib/web-client';

import {
  CredentialSourceLabel,
  ProviderApplicationLink,
  ProviderMark,
} from './provider-presentation';
import { findProviderConfiguration } from './provider-view';
import styles from './provider-detail.module.css';

type DetailState =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'not-found' }
  | { status: 'ready'; configuration: ProviderConfiguration };

type SubmissionState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'success'; kind: 'saved' | 'cleared' }
  | { status: 'error'; message: TranslationKey };

function sourceTranslationKey(source: CredentialSource): TranslationKey {
  if (source === 'env') return 'provider.source.env';
  if (source === 'user-config') return 'provider.source.userConfig';
  return 'provider.source.none';
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error('Provider request failed');
}

function mutationErrorKey(
  cause: unknown,
  clearing: boolean,
): TranslationKey {
  if (cause instanceof ApiClientError) {
    if (cause.code === 'CREDENTIAL_MANAGED_BY_ENV') {
      return 'providerDetail.envConflict';
    }
    if (cause.code === 'CONFIGURATION_UNAVAILABLE') {
      return 'providerDetail.storageUnavailable';
    }
    if (cause.code === 'VALIDATION_ERROR') {
      return 'providerDetail.invalidValue';
    }
  }
  return clearing
    ? 'providerDetail.clearError'
    : 'providerDetail.saveError';
}

export function ProviderDetailScreen({
  projectId,
  providerId,
}: {
  projectId: string;
  providerId: string;
}) {
  const { t } = useLocale();
  const client = React.useMemo(() => getBrowserWebClientRuntime().client, []);
  const coordinator = React.useMemo(() => new LatestRequestCoordinator(), []);
  const mountedRef = React.useRef(false);
  const mutationTokenRef = React.useRef(0);
  const mutationInFlightRef = React.useRef(false);
  const helpId = React.useId();
  const errorId = React.useId();
  const [state, setState] = React.useState<DetailState>({ status: 'loading' });
  const [draft, setDraft] = React.useState('');
  const [visible, setVisible] = React.useState(false);
  const [submission, setSubmission] = React.useState<SubmissionState>({
    status: 'idle',
  });

  const loadConfiguration = React.useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const result = await coordinator.run((signal) =>
        client.listProviderConfigurations({ signal }),
      );
      if (result.state !== 'current' || !mountedRef.current) return;
      const configuration = findProviderConfiguration(result.value, providerId);
      setState(
        configuration
          ? { status: 'ready', configuration }
          : { status: 'not-found' },
      );
    } catch (cause) {
      if (!mountedRef.current) return;
      setState({ status: 'error', error: toError(cause) });
    }
  }, [client, coordinator, providerId]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      mutationTokenRef.current += 1;
      mutationInFlightRef.current = false;
      coordinator.cancel();
    };
  }, [coordinator]);

  React.useEffect(() => {
    mutationTokenRef.current += 1;
    mutationInFlightRef.current = false;
    setDraft('');
    setVisible(false);
    setSubmission({ status: 'idle' });
    void loadConfiguration();
    return () => coordinator.cancel();
  }, [coordinator, loadConfiguration]);

  async function submitCredential(
    event: React.FormEvent<HTMLFormElement>,
    configuration: ProviderConfiguration,
  ) {
    event.preventDefault();
    if (submission.status === 'saving' || mutationInFlightRef.current) return;

    const normalizedLength = draft.trim().length;
    if (normalizedLength > 16 * 1024) {
      setSubmission({ status: 'error', message: 'providerDetail.invalidValue' });
      return;
    }

    const clearing =
      configuration.source === 'user-config' && normalizedLength === 0;
    const token = mutationTokenRef.current + 1;
    mutationTokenRef.current = token;
    mutationInFlightRef.current = true;
    setSubmission({ status: 'saving' });

    try {
      const result = await saveProviderCredentialDraft(
        client,
        configuration,
        draft,
      );
      if (!mountedRef.current || mutationTokenRef.current !== token) return;
      if (result.kind === 'validation-error') {
        setSubmission({
          status: 'error',
          message:
            result.code === 'CREDENTIAL_MANAGED_BY_ENV'
              ? 'providerDetail.envConflict'
              : 'providerDetail.required',
        });
        return;
      }

      setState({ status: 'ready', configuration: result.configuration });
      setDraft('');
      setVisible(false);
      setSubmission({ status: 'success', kind: result.kind });
    } catch (cause) {
      if (!mountedRef.current || mutationTokenRef.current !== token) return;
      setSubmission({
        status: 'error',
        message: mutationErrorKey(cause, clearing),
      });
    } finally {
      if (mutationTokenRef.current === token) {
        mutationInFlightRef.current = false;
      }
    }
  }

  const backHref = workspaceRoute(projectId, 'providers');
  const loadError = state.status === 'error' ? state.error : null;
  const configuration = state.status === 'ready' ? state.configuration : null;

  return (
    <div className={styles.page}>
      <Link className={styles.backLink} href={backHref}>
        <ArrowLeft aria-hidden="true" />
        {t('providerDetail.back')}
      </Link>

      {state.status === 'loading' ? <ProviderDetailLoading /> : null}

      {state.status === 'error' ? (
        <>
          <PageHeader
            eyebrow={t('providerDetail.eyebrow')}
            title={t('providerDetail.title')}
            description={t('providerDetail.description')}
          />
          <InlineNotice
            variant="error"
            title={t('providerDetail.loadErrorTitle')}
            action={
              <Button
                type="button"
                variant="secondary"
                onClick={() => void loadConfiguration()}
              >
                {t('common.retry')}
              </Button>
            }
          >
            <p>
              {loadError instanceof ApiClientError &&
              loadError.code === 'CONFIGURATION_UNAVAILABLE'
                ? t('providerDetail.storageUnavailable')
                : t('providerDetail.loadErrorDescription')}
            </p>
          </InlineNotice>
        </>
      ) : null}

      {state.status === 'not-found' ? (
        <>
          <PageHeader
            eyebrow={t('providerDetail.eyebrow')}
            title={t('providerDetail.notFoundTitle')}
            description={t('providerDetail.notFoundDescription')}
          />
          <Button asChild variant="secondary">
            <Link href={backHref}>{t('providerDetail.back')}</Link>
          </Button>
        </>
      ) : null}

      {configuration ? (
        <>
          <div className={styles.detailHeader}>
            <ProviderMark displayName={configuration.displayName} />
            <PageHeader
              eyebrow={t('providerDetail.eyebrow')}
              title={configuration.displayName}
              description={t('providerDetail.configurationSummary', {
                credential: configuration.credentialName,
                source: t(sourceTranslationKey(configuration.source)),
              })}
              actions={<CredentialSourceLabel source={configuration.source} />}
            />
          </div>

          <section className={styles.configurationSection}>
            <header className={styles.sectionHeader}>
              <div>
                <p>{t('providerDetail.configurationTitle')}</p>
                <h2>
                  {configuration.source === 'env'
                    ? t('providerDetail.environmentManagedTitle')
                    : configuration.source === 'user-config'
                      ? t('providerDetail.localCredentialTitle')
                      : t('providerDetail.notConfiguredTitle')}
                </h2>
              </div>
              <KeyRound aria-hidden="true" />
            </header>

            {configuration.source === 'env' ? (
              <div className={styles.environmentState}>
                <p>
                  {t('providerDetail.environmentManagedDescription', {
                    credential: configuration.credentialName,
                  })}
                </p>
                <ProviderApplicationLink configuration={configuration} />
                <small>{t('providerDetail.environmentLinkHint')}</small>
              </div>
            ) : (
              <form
                className={styles.credentialForm}
                aria-busy={submission.status === 'saving'}
                onSubmit={(event) =>
                  void submitCredential(event, configuration)
                }
              >
                <p className={styles.formIntroduction}>
                  {configuration.source === 'user-config'
                    ? t('providerDetail.localConfiguredDescription')
                    : t('providerDetail.notConfiguredDescription')}
                </p>
                <label htmlFor="provider-credential">
                  {t('providerDetail.secretLabel', {
                    credential: configuration.credentialName,
                  })}
                </label>
                <PasswordField
                  id="provider-credential"
                  value={draft}
                  visible={visible}
                  disabled={submission.status === 'saving'}
                  autoComplete="new-password"
                  spellCheck={false}
                  maxLength={16 * 1024 + 1}
                  placeholder={t('providerDetail.secretPlaceholder')}
                  showLabel={t('providerDetail.showInput')}
                  hideLabel={t('providerDetail.hideInput')}
                  aria-describedby={
                    submission.status === 'error'
                      ? helpId + ' ' + errorId
                      : helpId
                  }
                  aria-invalid={submission.status === 'error'}
                  onVisibleChange={setVisible}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    if (submission.status !== 'saving') {
                      setSubmission({ status: 'idle' });
                    }
                  }}
                />
                <div className={styles.formHelp} id={helpId}>
                  <span>{t('providerDetail.secretNeverReturned')}</span>
                  {configuration.source === 'user-config' ? (
                    <span>{t('providerDetail.clearHint')}</span>
                  ) : null}
                </div>
                {submission.status === 'error' ? (
                  <p className={styles.formError} id={errorId} role="alert">
                    {t(submission.message)}
                  </p>
                ) : null}
                <div className={styles.formActions}>
                  <ProviderApplicationLink configuration={configuration} />
                  <Button
                    type="submit"
                    disabled={submission.status === 'saving'}
                  >
                    {submission.status === 'saving'
                      ? t('providerDetail.saving')
                      : t('providerDetail.save')}
                  </Button>
                </div>
                {submission.status === 'success' ? (
                  <div aria-live="polite">
                    <InlineNotice
                      variant="success"
                      title={
                        submission.kind === 'cleared'
                          ? t('providerDetail.cleared')
                          : t('providerDetail.saved')
                      }
                    />
                  </div>
                ) : null}
              </form>
            )}
          </section>

          <section className={styles.capabilitiesSection}>
            <header className={styles.capabilitiesHeader}>
              <h2>{t('providerDetail.capabilitiesTitle')}</h2>
              <span>
                {t('providerDetail.modelSummary', {
                  count: configuration.models.length,
                })}
              </span>
            </header>
            {configuration.models.length > 0 ? (
              <div className={styles.modelList}>
                {configuration.models.map((capability) => (
                  <article className={styles.model} key={capability.model}>
                    <header>
                      <h3>{capability.displayName}</h3>
                      <code>{capability.model}</code>
                    </header>
                    <CapabilityList capability={capability} />
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.emptyModels}>
                <h3>{t('providerDetail.noModelsTitle')}</h3>
                <p>{t('providerDetail.noModelsDescription')}</p>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function ProviderDetailLoading() {
  const { t } = useLocale();
  return (
    <div className={styles.detailLoading} role="status">
      <span className="sr-only">{t('common.loading')}</span>
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}
