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
import {
  getProviderLogoSrc,
  getProviderMarkText,
  getProviderModelCount,
} from './provider-view';

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

export function ProviderMark({
  providerId,
  displayName,
  size = 'default',
}: {
  providerId: string;
  displayName: string;
  size?: 'default' | 'sm' | 'lg';
}) {
  const logoSrc = getProviderLogoSrc(providerId);
  return (
    <span
      className={styles.providerMark}
      data-size={size}
      data-logo={logoSrc ? 'true' : undefined}
      aria-hidden="true"
    >
      {logoSrc ? (
        <img src={logoSrc} alt="" draggable={false} />
      ) : (
        getProviderMarkText(displayName)
      )}
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
    <span className={styles.modelSummary}>
      <b>
        {count.configured
          ? t('provider.modelCount.configured', {
              enabled: count.enabled,
              total: count.total,
            })
          : t('provider.modelCount.unconfigured', { total: count.total })}
      </b>
      {!count.configured ? <small>{t('provider.modelsNeedCredential')}</small> : null}
    </span>
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
      <ul className={styles.directoryList}>
        {configurations.map((configuration) => (
          <li className={styles.directoryRow} key={configuration.providerId}>
            <ProviderMark
              providerId={configuration.providerId}
              displayName={configuration.displayName}
            />
            <div className={styles.providerWho}>
              <div className={styles.providerTitleLine}>
                <strong>{configuration.displayName}</strong>
                <code className={styles.credentialName}>
                  {configuration.credentialName}
                </code>
              </div>
              <div className={styles.providerSubLine}>
                <CredentialSourceLabel
                  source={configuration.source}
                  credentialStorageMode={configuration.credentialStorageMode}
                />
                <span className={styles.sep} aria-hidden="true">
                  ·
                </span>
                <ProviderModelSummary configuration={configuration} />
              </div>
            </div>
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
