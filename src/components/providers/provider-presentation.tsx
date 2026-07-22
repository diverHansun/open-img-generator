'use client';

import Link from 'next/link';
import { ChevronRight, ExternalLink } from 'lucide-react';

import { useLocale } from '@/components/i18n/locale-provider';
import { providerDetailRoute } from '@/lib/routes';
import type {
  CredentialSource,
  ProviderConfiguration,
} from '@/lib/web-client';

import styles from './providers.module.css';
import { getProviderMarkText, getProviderModelCount } from './provider-view';

function sourceTranslationKey(
  source: CredentialSource,
  credentialStorageMode: ProviderConfiguration['credentialStorageMode'],
) {
  if (source === 'env') return 'provider.source.env' as const;
  if (
    source === 'user-config' &&
    credentialStorageMode === 'session-memory'
  ) {
    return 'provider.source.sessionMemory' as const;
  }
  if (source === 'user-config') return 'provider.source.userConfig' as const;
  return 'provider.source.none' as const;
}

export function CredentialSourceLabel({
  source,
  credentialStorageMode,
}: {
  source: CredentialSource;
  credentialStorageMode: ProviderConfiguration['credentialStorageMode'];
}) {
  const { t } = useLocale();
  return (
    <span className={styles.sourceLabel} data-source={source}>
      <span aria-hidden="true" />
      {t(sourceTranslationKey(source, credentialStorageMode))}
    </span>
  );
}

export function ProviderMark({ displayName }: { displayName: string }) {
  return (
    <span className={styles.providerMark} aria-hidden="true">
      {getProviderMarkText(displayName)}
    </span>
  );
}

export function ProviderApplicationLink({
  configuration,
  compact = false,
}: {
  configuration: ProviderConfiguration;
  compact?: boolean;
}) {
  const { t } = useLocale();
  return (
    <a
      className={compact ? styles.compactApplicationLink : styles.applicationLink}
      href={configuration.keyApplyUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('provider.applicationKeyAria', {
        provider: configuration.displayName,
      })}
    >
      <span>{t('provider.applicationKey')}</span>
      <ExternalLink aria-hidden="true" />
    </a>
  );
}

function ProviderModelSummary({
  configuration,
}: {
  configuration: ProviderConfiguration;
}) {
  const { t } = useLocale();
  const count = getProviderModelCount(configuration);
  return (
    <div className={styles.modelSummary}>
      <span>
        {count.configured
          ? t('provider.modelCount.configured', {
              enabled: count.enabled,
              total: count.total,
            })
          : t('provider.modelCount.unconfigured', { total: count.total })}
      </span>
      {!count.configured ? <small>{t('provider.modelsNeedCredential')}</small> : null}
    </div>
  );
}

export function ProviderDirectory({
  projectId,
  configurations,
  busy = false,
}: {
  projectId: string;
  configurations: ProviderConfiguration[];
  busy?: boolean;
}) {
  const { t } = useLocale();
  return (
    <div className={styles.directory} aria-busy={busy}>
      <div className={styles.directoryHeader} aria-hidden="true">
        <span>{t('providers.column.provider')}</span>
        <span>{t('providers.column.credential')}</span>
        <span>{t('providers.column.configuration')}</span>
        <span>{t('providers.column.models')}</span>
        <span>{t('providers.column.actions')}</span>
      </div>
      <ul className={styles.directoryList}>
        {configurations.map((configuration) => (
          <li className={styles.directoryRow} key={configuration.providerId}>
            <div className={styles.providerIdentity}>
              <ProviderMark displayName={configuration.displayName} />
              <strong>{configuration.displayName}</strong>
            </div>
            <code className={styles.credentialName}>{configuration.credentialName}</code>
            <CredentialSourceLabel
              source={configuration.source}
              credentialStorageMode={configuration.credentialStorageMode}
            />
            <ProviderModelSummary configuration={configuration} />
            <div className={styles.rowActions}>
              <ProviderApplicationLink configuration={configuration} compact />
              <Link
                className={styles.detailLink}
                href={providerDetailRoute(projectId, configuration.providerId)}
                aria-label={t('providers.detailsAria', {
                  provider: configuration.displayName,
                })}
              >
                <span>{t('providers.details')}</span>
                <ChevronRight aria-hidden="true" />
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
