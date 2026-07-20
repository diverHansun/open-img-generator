'use client';

import Link from 'next/link';

import { LocaleSwitcher } from '@/components/i18n/locale-switcher';
import { useLocale } from '@/components/i18n/locale-provider';

import styles from './home-shell.module.css';

export function HomeShell({ children }: { children: React.ReactNode }) {
  const { t } = useLocale();
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">
        {t('common.skipMain')}
      </a>
      <header className={styles.brandBar}>
        <Link className={styles.brand} href="/" aria-label="Open Image Generator">
          <span aria-hidden="true">OI</span>
          {t('brand.name')}
        </Link>
        <LocaleSwitcher />
      </header>
      <main id="main-content" className={styles.main}>
        {children}
      </main>
    </div>
  );
}
