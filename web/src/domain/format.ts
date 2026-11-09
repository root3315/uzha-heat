import type { FeatureMeta } from '../data/contract';

const MINUS = '−';
const NBSP = ' ';
const THIN_NBSP = ' ';

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

export const formatTemp = (value: number, digits = 1): string => `${formatNumber(value, digits)}${THIN_NBSP}°C`;

export const formatTempDelta = (value: number, digits = 1): string => `${formatSigned(value, digits)}${THIN_NBSP}°C`;

export const formatPercent = (share: number): string => `${formatNumber(share * 100, 0)}${NBSP}%`;

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
