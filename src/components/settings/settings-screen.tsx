'use client';

import * as React from 'react';

import { useLocale } from '@/components/i18n/locale-provider';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { InlineNotice } from '@/components/ui/inline-notice';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  getDesktopBridge,
  type DesktopRuntimeInfo,
} from '@/lib/desktop-bridge';
import {
  getBrowserWebClientRuntime,
  type AppSettingsView,
} from '@/lib/web-client';

import { formatBytes } from './format-bytes';
import styles from './settings.module.css';

const MAX_RETENTION_DAYS = 36_500;

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error('Settings request failed');
}

export function SettingsScreen({ projectId }: { projectId: string }) {
  const { locale, t } = useLocale();
  const client = React.useMemo(() => getBrowserWebClientRuntime().client, []);
  const desktopBridge = React.useMemo(() => getDesktopBridge(), []);
  const [view, setView] = React.useState<AppSettingsView | null>(null);
  const [autoCleanup, setAutoCleanup] = React.useState(false);
  const [days, setDays] = React.useState('7');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [desktopInfo, setDesktopInfo] = React.useState<DesktopRuntimeInfo | null>(null);
  const [desktopBusy, setDesktopBusy] = React.useState(false);
  const [desktopError, setDesktopError] = React.useState<Error | null>(null);

  const applyView = React.useCallback((nextView: AppSettingsView) => {
    setView(nextView);
    const configuredDays = nextView.settings.imageRetentionDays;
    setAutoCleanup(configuredDays !== null);
    if (configuredDays !== null) setDays(String(configuredDays));
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      applyView(await client.getAppSettings());
    } catch (cause) {
      setError(toError(cause));
    } finally {
      setLoading(false);
    }
  }, [applyView, client]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!desktopBridge) return;
    let active = true;
    void desktopBridge
      .getRuntimeInfo()
      .then((info) => {
        if (active) setDesktopInfo(info);
      })
      .catch((cause) => {
        if (active) setDesktopError(toError(cause));
      });
    return () => {
      active = false;
    };
  }, [desktopBridge]);

  async function runDesktopAction(
    action: () => Promise<DesktopRuntimeInfo | void>,
  ) {
    setDesktopBusy(true);
    setDesktopError(null);
    try {
      const result = await action();
      if (result) setDesktopInfo(result);
    } catch (cause) {
      setDesktopError(toError(cause));
    } finally {
      setDesktopBusy(false);
    }
  }

  const saveRetention = async () => {
    const parsedDays = Number(days);
    if (
      autoCleanup &&
      (!Number.isSafeInteger(parsedDays) || parsedDays < 1 || parsedDays > MAX_RETENTION_DAYS)
    ) {
      setError(new Error(`1–${MAX_RETENTION_DAYS}`));
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      applyView(
        await client.updateAppSettings({
          imageRetentionDays: autoCleanup ? parsedDays : null,
        }),
      );
      setSaved(true);
    } catch (cause) {
      setError(toError(cause));
    } finally {
      setSaving(false);
    }
  };

  const exportHref = `/api/projects/${encodeURIComponent(projectId)}/export`;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={t('settings.eyebrow')}
        title={t('settings.title')}
        description={t('settings.description')}
      />

      {loading ? <p className={styles.loading}>{t('common.loading')}</p> : null}

      {error ? (
        <InlineNotice
          variant="error"
          title={saving ? t('settings.retention.saveError') : t('settings.retention.loadError')}
          action={!saving ? <Button type="button" variant="secondary" onClick={() => void load()}>{t('common.retry')}</Button> : undefined}
        >
          <p>{error.message}</p>
        </InlineNotice>
      ) : null}

      {desktopError ? (
        <InlineNotice
          variant="error"
          title={t('settings.desktop.actionError')}
        >
          <p>{desktopError.message}</p>
        </InlineNotice>
      ) : null}

      {view ? (
        <div className={styles.sections}>
          <section className={styles.section} aria-labelledby="retention-title">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>{t('settings.data.title')}</p>
                <h2 id="retention-title">{t('settings.retention.title')}</h2>
                <p>{t('settings.retention.description')}</p>
              </div>
              <Switch
                checked={autoCleanup}
                onCheckedChange={(checked) => {
                  setAutoCleanup(checked);
                  setSaved(false);
                }}
                aria-label={t('settings.retention.enabled')}
              />
            </div>

            {autoCleanup ? (
              <div className={styles.retentionControl}>
                <label htmlFor="retention-days">{t('settings.retention.daysLabel')}</label>
                <div className={styles.numberInput}>
                  <Input
                    id="retention-days"
                    type="number"
                    min={1}
                    max={MAX_RETENTION_DAYS}
                    value={days}
                    onChange={(event) => {
                      setDays(event.target.value);
                      setSaved(false);
                    }}
                  />
                  <span>{t('settings.retention.daysUnit')}</span>
                </div>
                <p>{t('settings.retention.daysHint')}</p>
              </div>
            ) : (
              <p className={styles.never}>{t('settings.retention.never')}</p>
            )}

            <div className={styles.sectionActions}>
              <Button type="button" onClick={() => void saveRetention()} disabled={saving}>
                {saving ? t('settings.retention.saving') : t('settings.retention.save')}
              </Button>
              {saved ? <span className={styles.saved} role="status">{t('settings.retention.saved')}</span> : null}
            </div>
          </section>

          <section className={styles.section} aria-labelledby="storage-title">
            <div className={styles.sectionHeading}>
              <div>
                <h2 id="storage-title">{t('settings.storage.title')}</h2>
                <p>{t('settings.storage.scope')}</p>
              </div>
              <strong>{formatBytes(view.localData.mediaBytes, locale)}</strong>
            </div>
            <dl className={styles.storageGrid}>
              <div><dt>{t('settings.storage.media')}</dt><dd>{formatBytes(view.localData.mediaBytes, locale)}</dd></div>
              <div><dt>{t('settings.storage.database')}</dt><dd>{formatBytes(view.localData.databaseBytes, locale)}</dd></div>
              <div><dt>{t('settings.storage.logs')}</dt><dd>{formatBytes(view.localData.logBytes, locale)}</dd></div>
              <div><dt>{t('settings.storage.total')}</dt><dd>{formatBytes(view.localData.totalBytes, locale)}</dd></div>
            </dl>
          </section>

          <section className={styles.section} aria-labelledby="download-title">
            <h2 id="download-title">{t('settings.download.title')}</h2>
            {desktopInfo && desktopBridge ? (
              <>
                <p>{t('settings.download.desktopManaged')}</p>
                <code className={styles.pathValue}>{desktopInfo.downloadDirectory}</code>
                <div className={styles.sectionActions}>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={desktopBusy}
                    onClick={() =>
                      void runDesktopAction(() =>
                        desktopBridge.chooseDownloadDirectory(),
                      )
                    }
                  >
                    {t('settings.download.choose')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={
                      desktopBusy ||
                      desktopInfo.downloadDirectory ===
                        desktopInfo.defaultDownloadDirectory
                    }
                    onClick={() =>
                      void runDesktopAction(() =>
                        desktopBridge.resetDownloadDirectory(),
                      )
                    }
                  >
                    {t('settings.download.reset')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p>{t('settings.download.browserManaged')}</p>
                <p className={styles.muted}>{t('settings.download.desktopOnly')}</p>
              </>
            )}
          </section>

          <section className={styles.section} aria-labelledby="directory-title">
            <h2 id="directory-title">{t('settings.dataDirectory.title')}</h2>
            <p>
              {desktopInfo
                ? t('settings.dataDirectory.desktopDescription')
                : t('settings.dataDirectory.description')}
            </p>
            {desktopInfo ? (
              <code className={styles.pathValue}>{desktopInfo.dataDirectory}</code>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              disabled={!desktopBridge || !desktopInfo || desktopBusy}
              title={!desktopBridge ? t('settings.dataDirectory.desktopOnly') : undefined}
              onClick={() =>
                desktopBridge
                  ? void runDesktopAction(() => desktopBridge.openDataDirectory())
                  : undefined
              }
            >
              {t('settings.dataDirectory.open')}
            </Button>
          </section>

          <section className={styles.section} aria-labelledby="export-title">
            <h2 id="export-title">{t('settings.export.title')}</h2>
            <p>{t('settings.export.description')}</p>
            <Button asChild type="button">
              <a href={exportHref}>{t('settings.export.action')}</a>
            </Button>
          </section>

          <section className={styles.section} aria-labelledby="about-title">
            <h2 id="about-title">{t('settings.about.title')}</h2>
            <p>{t('settings.about.version', { version: view.app.version })}</p>
            <p>{t('settings.about.license', { license: view.app.license })}</p>
            <a
              className={styles.licenseLink}
              href="https://www.apache.org/licenses/LICENSE-2.0"
              target="_blank"
              rel="noreferrer"
            >
              {t('settings.about.licenseLink')}
            </a>
          </section>
        </div>
      ) : null}
    </div>
  );
}
