import type { FeatureMeta } from '../data/contract';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locale';
import { CAUSE_WORDS, type CauseWords, type FactorKey } from './causes.texts';
import { featureLabel, featureUnit } from './dataTexts';
import { formats } from './format';

export type { CauseWords } from './causes.texts';

/** Words for any factor; keys outside the fixed vocabulary fall back to the label from the data. */
export function causeWords(feature: Pick<FeatureMeta, 'key' | 'label' | 'unit'>, locale: Locale): CauseWords {
  const known = (CAUSE_WORDS[locale] as Partial<Record<string, CauseWords>>)[feature.key as FactorKey];
  if (known) return known;
  const name = featureLabel(feature, locale);
  const label = name.toLowerCase();
  return {
    heats: label,
    cools: label,
    heatsShort: label,
    coolsShort: label,
    there: label,
    better: null,
    measure: (v) => `${name} ${formats(locale).formatNumber(v, 2)} ${featureUnit(feature, locale)}`.trim(),
  };
}

/** Which way cools a factor, the same in every language. */
export const betterDirection = (feature: Pick<FeatureMeta, 'key' | 'label' | 'unit'>): CauseWords['better'] => causeWords(feature, DEFAULT_LOCALE).better;

/** "мало зелени" when the factor heats, "зелень" when it cools. */
export function causeLabel(words: CauseWords, value: number): string {
  return value >= 0 ? words.heatsShort : words.coolsShort;
}

/** Russian subject phrase with a verb that agrees with it: "даёт нехватка зелени", "охлаждают светлые покрытия". */
export function causeClause(words: CauseWords, value: number, verbs: { one: string; many: string }): string {
  return `${words.plural ? verbs.many : verbs.one} ${value >= 0 ? words.heats : words.cools}`;
}

/** The subject alone, for languages where the verb does not move: "lack of greenery", "tree shade". */
export const causeSubject = (words: CauseWords, value: number): string => (value >= 0 ? words.heats : words.cools);
