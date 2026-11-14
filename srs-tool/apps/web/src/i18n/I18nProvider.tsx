import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Language } from '@srs-tool/schemas';
import { api, getAuthToken } from '../api/client';
import { vi, type I18nDictionary } from './locales/vi';
import { en } from './locales/en';

const LOCALE_KEY = 'srs_tool_locale';

interface I18nContextValue {
  locale: Language;
  t: I18nDictionary;
  setLocale: (next: Language) => void;
  toggleLocale: () => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem(LOCALE_KEY);
      return saved === 'en' ? 'en' : 'vi';
    } catch {
      return 'vi';
    }
  });

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Language) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_KEY, next);
    } catch {
      // Ignore storage error
    }
    if (getAuthToken()) {
      api.auth.updateLocale(next).catch(() => {
        // Non-blocking preference sync
      });
    }
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === 'vi' ? 'en' : 'vi');
  }, [locale, setLocale]);

  const t = locale === 'en' ? en : vi;

  return (
    <I18nContext.Provider value={{ locale, t, setLocale, toggleLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
