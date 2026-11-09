import type { FeatureMeta } from '../data/contract';

const MINUS = '−';
const NBSP = ' ';

const formatters = new Map<number, Intl.NumberFormat>();

function formatter(digits: number): Intl.NumberFormat {
  let f = formatters.get(digits);
  if (!f) {
    f = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    formatters.set(digits, f);
  }
  return f;
}

/** Russian number format (decimal comma) with a true minus sign. */
export function formatNumber(value: number, digits = 1): string {
  const text = formatter(digits).format(Math.abs(value));
  const isZero = Number(Math.abs(value).toFixed(digits)) === 0;
  return value < 0 && !isZero ? `${MINUS}${text}` : text;
}

export function formatSigned(value: number, digits = 1): string {
  const isZero = Number(Math.abs(value).toFixed(digits)) === 0;
  if (isZero) return formatNumber(0, digits);
  return value > 0 ? `+${formatNumber(value, digits)}` : formatNumber(value, digits);
}

/** Temperature as the app writes it: "47,9°". */
export const formatDeg = (value: number, digits = 1): string => `${formatNumber(value, digits)}°`;
/** Temperature difference with its sign: "+4,6°", "−1,2°". */
export const formatDegSigned = (value: number, digits = 1): string => `${formatSigned(value, digits)}°`;
export const formatPercent = (share: number): string => `${formatNumber(share * 100, 0)}${NBSP}%`;
/** A difference of two percentages, in percentage points: "+17 п.п.". */
export const formatPoints = (difference: number): string => `${formatSigned(difference, 0)}${NBSP}п.п.`;
export const formatKm = (metres: number): string => `${formatNumber(metres / 1000, 1)}${NBSP}км`;

/** Russian plural: forms for 1, 2–4 and 5+ ("причина", "причины", "причин"). */
export function plural(n: number, [one, few, many]: readonly [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Formats a factor value according to its unit from the contract (unit-driven, not key-driven). */
export function formatFactorValue(feature: Pick<FeatureMeta, 'unit'>, value: number): string {
  const unit = feature.unit;
  if (unit.includes('%')) return `${formatNumber(value, 0)}${NBSP}%`;
  if (unit === 'м') {
    return value >= 1000 ? `${formatNumber(value / 1000, 1)}${NBSP}км` : `${formatNumber(Math.round(value / 10) * 10, 0)}${NBSP}м`;
  }
  if (unit.includes('NDVI') || unit.includes('0–1') || unit.includes('albedo')) return formatNumber(value, 2);
  if (unit.includes('км/км²') || unit.includes('шт/га')) return `${formatNumber(value, 1)}${NBSP}${unit}`;
  return `${formatNumber(value, Math.abs(value) >= 100 ? 0 : 2)}${NBSP}${unit}`;
}
