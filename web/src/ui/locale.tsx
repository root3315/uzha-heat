import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { formats, type Formats } from '../domain/format';
import { readSharedView, withLocale } from '../domain/shareLink';
import { DEFAULT_LOCALE, isLocale, type Locale, type Texts } from '../i18n/locale';
import { useRoute } from './routing';

const STORAGE_KEY = 'uzha.lang';

function storedLocale(): Locale | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

function storeLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* private mode: the choice lasts as long as the page */
  }
}

/** The language the page opens in: the address says it first, then the reader's last choice, then English. */
export const initialLocale = (): Locale => readSharedView(window.location.search).locale ?? storedLocale() ?? DEFAULT_LOCALE;

interface LocaleState {
  locale: Locale;
  setLocale(locale: Locale): void;
}

const LocaleContext = createContext<LocaleState>({ locale: DEFAULT_LOCALE, setLocale: () => undefined });

/** Holds the language; keeps `<html lang>`, the saved choice and `?lang=` in the address in step with it. */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState(initialLocale);
  const route = useRoute();
  const state = useMemo(() => ({ locale, setLocale: (next: Locale) => (storeLocale(next), setLocale(next)) }), [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Every page change may drop the query; put the language back without a new history entry.
  useEffect(() => {
    const { pathname, search, hash } = window.location;
    const next = withLocale(search, locale);
    if (next !== search) window.history.replaceState(window.history.state, '', `${pathname}${next}${hash}`);
  }, [locale, route]);

  return <LocaleContext.Provider value={state}>{children}</LocaleContext.Provider>;
}

export const useLocale = (): Locale => useContext(LocaleContext).locale;
export const useSetLocale = (): ((locale: Locale) => void) => useContext(LocaleContext).setLocale;

/** This part's texts in the reader's language. */
export function useTexts<T>(dictionary: Texts<T>): T {
  return dictionary[useLocale()];
}

/** Number formats in the reader's language. */
export const useFormats = (): Formats => formats(useLocale());
