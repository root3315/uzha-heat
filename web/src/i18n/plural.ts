import type { Locale } from './locale';

/** English noun forms: for 1 and for everything else ("place", "places"). */
export type EnForms = readonly [one: string, other: string];
/** Russian noun forms: for 1, for 2–4 and for 5+ ("причина", "причины", "причин"). */
export type RuForms = readonly [one: string, few: string, many: string];

export function pluralEn(n: number, [one, other]: EnForms): string {
  return Math.abs(n) === 1 ? one : other;
}

export function pluralRu(n: number, [one, few, many]: RuForms): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** The noun form for `n` in the given language. */
export function plural(locale: Locale, n: number, forms: { en: EnForms; ru: RuForms }): string {
  return locale === 'en' ? pluralEn(n, forms.en) : pluralRu(n, forms.ru);
}
