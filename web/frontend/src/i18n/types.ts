export type Lang = 'en' | 'fa';

export const LANG_STORAGE_KEY = 'qbit-lang';

export function detectInitialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === 'en' || saved === 'fa') return saved;
  } catch {
    /* ignore */
  }
  return 'en';
}

export function applyDocumentLang(lang: Lang) {
  const root = document.documentElement;
  root.lang = lang;
  root.dir = lang === 'fa' ? 'rtl' : 'ltr';
  root.dataset.lang = lang;
}
