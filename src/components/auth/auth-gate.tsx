'use client';

import * as React from 'react';
import { KeyRound } from 'lucide-react';

import { useLocale } from '@/components/i18n/locale-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createApiClient, resolveAuthGate } from '@/lib/web-client';

import styles from './auth-gate.module.css';

type GateState = 'checking' | 'authenticated' | 'unauthenticated' | 'unavailable';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const client = React.useMemo(() => createApiClient(), []);
  const { t } = useLocale();
  const [state, setState] = React.useState<GateState>('checking');
  const [token, setToken] = React.useState('');
  const [error, setError] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const checkAccess = React.useCallback(async () => {
    setState('checking');
    const result = await resolveAuthGate(client);
    if (result.state === 'authenticated') setState('authenticated');
    else if (result.state === 'unauthenticated') setState('unauthenticated');
    else {
      setError(result.error.message);
      setState('unavailable');
    }
  }, [client]);

  React.useEffect(() => {
    void checkAccess();
  }, [checkAccess]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await client.login(token.trim());
      setToken('');
      setState('authenticated');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('auth.unavailable'));
    } finally {
      setSubmitting(false);
    }
  }

  if (state === 'authenticated') return children;

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-live="polite">
        <KeyRound aria-hidden="true" />
        {state === 'checking' ? (
          <>
            <h1>{t('auth.checking')}</h1>
            <div className={styles.progress} />
          </>
        ) : state === 'unauthenticated' ? (
          <>
            <div>
              <h1>{t('auth.title')}</h1>
              <p>{t('auth.description')}</p>
            </div>
            <form onSubmit={submit} className={styles.form}>
              <label htmlFor="app-auth-token">{t('auth.token')}</label>
              <Input
                id="app-auth-token"
                type="password"
                autoComplete="current-password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
              {error ? <p className={styles.error}>{error}</p> : null}
              <Button type="submit" disabled={!token.trim() || submitting}>
                {submitting ? t('common.loading') : t('auth.submit')}
              </Button>
            </form>
          </>
        ) : (
          <>
            <div>
              <h1>{t('auth.unavailable')}</h1>
              {error ? <p className={styles.error}>{error}</p> : null}
            </div>
            <Button type="button" variant="secondary" onClick={() => void checkAccess()}>
              {t('common.retry')}
            </Button>
          </>
        )}
      </section>
    </main>
  );
}
