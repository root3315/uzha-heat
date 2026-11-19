import type { FeatureMeta } from '../data/contract';
import type { Locale } from '../i18n/locale';
import { plural } from '../i18n/plural';

const MINUS = '−';
const NBSP = ' ';

const INTL_LOCALE: Record<Locale, string> = { en: 'en-US', ru: 'ru-RU' };

/** Units as the data writes them (in Russian), and in English. */
const UNITS_EN: Record<string, string> = {
  м: 'm',
  км: 'km',
  'м³/га': 'm³/ha',
  'км/км²': 'km/km²',
  'шт/га': 'per ha',
  '% площади': '% of area',
};

/** A unit from the data in the reader's language; one it does not know stays as written. */
export const unitText = (unit: string, locale: Locale): string => (locale === 'en' ? (UNITS_EN[unit] ?? unit) : unit);

/** Number formatting in one language: "43.6°", "1,234" in English; "43,6°", "1 234" in Russian. A true minus sign in both. */
export interface Formats {
  formatNumber(value: number, digits?: number): string;
  formatSigned(value: number, digits?: number): string;
  /** Temperature as the app writes it: "47.9°". */
  formatDeg(value: number, digits?: number): string;
  /** A temperature with its unit, where a reader may take a bare degree for air: "47.9 °C". */
  formatTemp(value: number, digits?: number): string;
  /** Temperature difference with its sign: "+4.6°", "−1.2°". */
  formatDegSigned(value: number, digits?: number): string;
  formatPercent(share: number): string;
  /** A difference of two percentages, in percentage points: "+17 points". */
  formatPoints(difference: number): string;
  formatKm(metres: number): string;
  /** A factor value according to its unit from the contract (unit-driven, not key-driven). */
  formatFactorValue(feature: Pick<FeatureMeta, 'unit'>, value: number): string;
}

function makeFormats(locale: Locale): Formats {
  const intl = new Map<number, Intl.NumberFormat>();
  const formatter = (digits: number) => {
    let f = intl.get(digits);
    if (!f) {
      f = new Intl.NumberFormat(INTL_LOCALE[locale], { minimumFractionDigits: digits, maximumFractionDigits: digits });
      intl.set(digits, f);
    }
    return f;
  };
  const percentSign = locale === 'en' ? '%' : `${NBSP}%`;
  const points = (difference: number) =>
    plural(locale, Math.abs(Math.round(difference)), { en: ['point', 'points'], ru: ['пункт', 'пункта', 'пунктов'] });
  const unit = (u: string) => unitText(u, locale);

  const formatNumber = (value: number, digits = 1): string => {
    const text = formatter(digits).format(Math.abs(value));
    const isZero = Number(Math.abs(value).toFixed(digits)) === 0;
    return value < 0 && !isZero ? `${MINUS}${text}` : text;
  };
  const formatSigned = (value: number, digits = 1): string => {
    const isZero = Number(Math.abs(value).toFixed(digits)) === 0;
    if (isZero) return formatNumber(0, digits);
    return value > 0 ? `+${formatNumber(value, digits)}` : formatNumber(value, digits);
  };
  const formatKm = (metres: number): string => `${formatNumber(metres / 1000, 1)}${NBSP}${unit('км')}`;

  const formatFactorValue = (feature: Pick<FeatureMeta, 'unit'>, value: number): string => {
    const u = feature.unit;
    if (u.includes('%')) return `${formatNumber(value, 0)}${percentSign}`;
    if (u === 'м') {
      if (value >= 1000) return formatKm(value);
      // Building heights are a few metres, distances to water hundreds: round each to what it can say.
      const rounded = value >= 100 ? Math.round(value / 10) * 10 : value;
      return `${formatNumber(rounded, 0)}${NBSP}${unit('м')}`;
    }
    if (u === 'м³/га') return `${formatNumber(Math.round(value / 100) * 100, 0)}${NBSP}${unit(u)}`;
    if (u.includes('NDVI') || u.includes('0–1') || u.includes('albedo')) return formatNumber(value, 2);
    if (u.includes('км/км²') || u.includes('шт/га')) return `${formatNumber(value, 1)}${NBSP}${unit(u)}`;
    return `${formatNumber(value, Math.abs(value) >= 100 ? 0 : 2)}${NBSP}${unit(u)}`;
  };

  return {
    formatNumber,
    formatSigned,
    formatDeg: (value, digits = 1) => `${formatNumber(value, digits)}°`,
    formatTemp: (value, digits = 1) => `${formatNumber(value, digits)}${NBSP}°C`,
    formatDegSigned: (value, digits = 1) => `${formatSigned(value, digits)}°`,
    formatPercent: (share) => `${formatNumber(share * 100, 0)}${percentSign}`,
    formatPoints: (difference) => `${formatSigned(difference, 0)}${NBSP}${points(difference)}`,
    formatKm,
    formatFactorValue,
  };
}

const cache = new Map<Locale, Formats>();

/** The number formats of a language; made once per language. */
export function formats(locale: Locale): Formats {
  let f = cache.get(locale);
  if (!f) {
    f = makeFormats(locale);
    cache.set(locale, f);
  }
  return f;
}
