'use client';

import * as React from 'react';

import {
  DEFAULT_LOCALE,
  en,
  LOCALE_STORAGE_KEY,
  type Locale,
  type TranslationKey,
  zhCN,
} from '@/lib/i18n';

type TranslationValues = Record<string, string | number>;
type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
};

const LocaleContext = React.createContext<LocaleContextValue | null>(null);

function translate(locale: Locale, key: TranslationKey, values?: TranslationValues) {
  const dictionary = locale === 'en' ? en : zhCN;
  const template = dictionary[key];
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match,
  );
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = React.useState<Locale>(DEFAULT_LOCALE);

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (stored === 'en' || stored === 'zh-CN') setLocaleState(stored);
    } catch {
      // Storage can be unavailable in hardened/private browser contexts.
    }
  }, []);

  React.useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = React.useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    } catch {
      // The in-memory locale still changes when persistence is unavailable.
    }
  }, []);

  const value = React.useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, values) => translate(locale, key, values),
    }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = React.useContext(LocaleContext);
  if (!context) throw new Error('useLocale must be used inside LocaleProvider');
  return context;
}
