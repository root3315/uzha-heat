import { quantile } from './stats';

/** [position 0–1, hex] */
export type Ramp = ReadonlyArray<readonly [number, string]>;
/** [data value, hex] */
export type ColorStops = Array<[number, string]>;

/**
 * Surface temperature: cool sage at the bottom (parks, water) through straw and ochre to
 * brick and a deep oxblood — lightness falls monotonically from the ochre stop onward.
 */
export const HEAT_RAMP: Ramp = [
  [0, '#cfdfd9'],
  [0.16, '#ebe3bd'],
  [0.32, '#e9c882'],
  [0.48, '#e0a259'],
  [0.63, '#cf7a3c'],
  [0.77, '#b0502d'],
  [0.89, '#823027'],
  [1, '#491820'],
];

/** Contribution, °C: cooling (deep teal) ↔ neutral paper ↔ heating (brick). */
export const DIVERGING_RAMP: Ramp = [
  [0, '#1d5a73'],
  [0.25, '#7eaab8'],
  [0.5, '#ecebe4'],
  [0.75, '#e0a26f'],
  [1, '#9b3723'],
];

/** Categorical colours for "dominant cause"; unknown keys fall back to the spare palette. */
const FACTOR_COLORS: Record<string, string> = {
  ndvi: '#6f9a4c',
  tree: '#2f5e4f',
  built: '#a8473a',
  bare: '#d0a85a',
  albedo: '#7d8aa0',
  roads: '#3a3836',
  buildings: '#c47f5e',
  water_dist: '#3b7ea6',
  elevation: '#9a9488',
};
const SPARE_COLORS = ['#5b7a8c', '#8c6d4f', '#4f6b4f', '#b5835a'];
export const NO_HEATING_COLOR = '#e4e2da';

export function factorColor(key: string, index: number): string {
  return FACTOR_COLORS[key] ?? SPARE_COLORS[index % SPARE_COLORS.length] ?? '#888888';
}

export function rampToStops(ramp: Ramp, min: number, max: number): ColorStops {
  return ramp.map(([t, color]) => [min + t * (max - min), color]);
}

/** Temperature domain robust to outliers: a little beyond P2…P98. */
export function heatDomain(lst: readonly number[]): [number, number] {
  const lo = quantile(lst, 0.02);
  const hi = quantile(lst, 0.98);
  return [Math.floor(lo), Math.ceil(hi)];
}

/** Symmetric domain for a contribution field, so 0 °C is always the neutral midpoint. */
export function divergingDomain(values: readonly number[]): number {
  const absolute = values.map(Math.abs);
  return Math.max(0.5, Math.ceil(quantile(absolute, 0.98) * 2) / 2);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

export function colorAt(stops: ColorStops, value: number): string {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) return '#000000';
  if (value <= first[0]) return first[1];
  if (value >= last[0]) return last[1];
  for (let k = 1; k < stops.length; k++) {
    const [v1, c1] = stops[k] ?? last;
    const [v0, c0] = stops[k - 1] ?? first;
    if (value <= v1) {
      const t = (value - v0) / (v1 - v0);
      const a = hexToRgb(c0);
      const b = hexToRgb(c1);
      return rgbToHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return last[1];
}

/** CSS linear-gradient for legends, built from the same ramp the map uses. */
export function rampGradient(ramp: Ramp): string {
  return `linear-gradient(to right, ${ramp.map(([t, c]) => `${c} ${(t * 100).toFixed(0)}%`).join(', ')})`;
}
