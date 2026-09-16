import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en, { type MessageKey } from './en';
import fa from './fa';
import { applyDocumentLang, detectInitialLang, LANG_STORAGE_KEY, type Lang } from './types';

const catalogs: Record<Lang, Record<MessageKey, string>> = {
  en: en as Record<MessageKey, string>,
  fa,
};

type Vars = Record<string, string | number>;

function format(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : `{${key}}`
  );
}

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, vars?: Vars) => string;
  dir: 'ltr' | 'rtl';
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => detectInitialLang());

  useEffect(() => {
    applyDocumentLang(lang);
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    applyDocumentLang(next);
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: Vars) => {
      const table = catalogs[lang] || catalogs.en;
      const raw = table[key] ?? catalogs.en[key] ?? key;
      return format(raw, vars);
    },
    [lang]
  );

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      setLang,
      t,
      dir: lang === 'fa' ? 'rtl' : 'ltr',
    }),
    [lang, setLang, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
