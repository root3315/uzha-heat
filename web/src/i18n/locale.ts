/** The languages the app is written in. English is the default: the page opens in it unless asked otherwise. */
export type Locale = 'en' | 'ru';

export const LOCALES: readonly Locale[] = ['en', 'ru'];
export const DEFAULT_LOCALE: Locale = 'en';

export const isLocale = (value: unknown): value is Locale => value === 'en' || value === 'ru';

/** Texts of one part of the app in every language. */
export type Texts<T> = Readonly<Record<Locale, T>>;

/**
 * One dictionary in both languages. English sets the shape: a key missing from the Russian, or one the English
 * does not have, is a type error. Dictionaries live in `*.texts.ts` files, where a test checks the keys match.
 */
export function texts<T>(en: T, ru: NoInfer<T>): Texts<T> {
  return { en, ru };
}
