'use client';

import { useLocale } from './locale-provider';
import styles from './locale-switcher.module.css';

export function LocaleSwitcher() {
  const { locale, setLocale, t } = useLocale();
  return (
    <div className={styles.switcher} role="group" aria-label={t('locale.label')}>
      <button
        type="button"
        aria-pressed={locale === 'zh-CN'}
        onClick={() => setLocale('zh-CN')}
      >
        中文
      </button>
      <span aria-hidden="true">/</span>
      <button type="button" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>
        EN
      </button>
    </div>
  );
}
