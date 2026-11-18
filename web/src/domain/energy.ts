import { FLUX_KEYS, type CityDetail, type EnergyMethod, type Fluxes, type SurfaceMaterial } from '../data/contract';
import type { Locale } from '../i18n/locale';
import { ENERGY_TEXTS } from './energy.texts';
import { formats } from './format';
import { hottestTenth } from './places';
import { meanAt, quantile } from './stats';

/** Whole watts per square metre: "640 W/m²". */
export const formatWatts = (value: number, locale: Locale): string => `${formats(locale).formatNumber(value, 0)}${ENERGY_TEXTS[locale].watt}`;

/** Where the net radiation goes, as the bar draws it left to right. */
export const SINKS = ['le', 'h', 'g'] as const;
export type Sink = (typeof SINKS)[number];

export const sinkLabel = (sink: Sink, locale: Locale): string => ENERGY_TEXTS[locale].sinks[sink];

/** The balance of one cell, or null when the data has no energy step. */
export function cellFluxes(detail: CityDetail, index: number): Fluxes | null {
  const columns = detail.cells.energy;
  if (!columns) return null;
  return Object.fromEntries(FLUX_KEYS.map((key) => [key, columns[key][index] ?? Number.NaN])) as Fluxes;
}

/** The mean balance over some cells, whole W/m²; null without energy data or cells. */
export function meanFluxes(detail: CityDetail, members: readonly number[]): Fluxes | null {
  const columns = detail.cells.energy;
  if (!columns || members.length === 0) return null;
  return Object.fromEntries(FLUX_KEYS.map((key) => [key, Math.round(meanAt(columns[key], members))])) as Fluxes;
}

/** The greenest tenth of the city by NDVI: the reference a hot place is compared with. */
export function greenestTenth(detail: CityDetail): number[] {
  const ndvi = detail.cells.values.ndvi;
  if (!ndvi) return [];
  const threshold = quantile(ndvi, 0.9);
  return ndvi.flatMap((v, i) => (v >= threshold ? [i] : []));
}

/** Shares of the net radiation in each sink, adding up to 1. */
export function sinkShares(f: Fluxes): Record<Sink, number> {
  const total = Math.max(1, f.le + f.h + f.g);
  return { le: Math.max(0, f.le) / total, h: Math.max(0, f.h) / total, g: Math.max(0, f.g) / total };
}

/** Evaporative fraction: of what is left after the ground takes its part, how much evaporates. */
export const evaporativeFraction = (f: Fluxes): number => (f.rn - f.g > 0 ? Math.max(0, f.le) / (f.rn - f.g) : 0);

/** One plain sentence about where this place's sunlight goes. */
export function fluxVerdict(f: Fluxes, locale: Locale): string {
  const t = ENERGY_TEXTS[locale].verdict;
  const ef = evaporativeFraction(f);
  if (ef < 0.15) return t.dry;
  if (ef < 0.4) return t.little;
  if (ef < 0.6) return t.even;
  return t.wet;
}

/** How much more this place heats the air than the city's greenest tenth. */
export function greenComparison(here: Fluxes, green: Fluxes, locale: Locale): string {
  const t = ENERGY_TEXTS[locale];
  const ratio = here.h / Math.max(1, green.h);
  if (ratio >= 1.3) return t.greener(formats(locale).formatNumber(ratio, 1), formatWatts(here.h, locale), formatWatts(green.h, locale));
  return t.asGreen(formatWatts(green.h, locale));
}

export type SurfaceKind = 'built' | 'bare' | 'green';

/** What covers most of the cell, from the WorldCover shares; null without them. */
export function dominantSurface(values: Record<string, number>): SurfaceKind | null {
  const built = values.built;
  const bare = values.bare;
  if (built === undefined || bare === undefined) return null;
  const green = Math.max(0, 100 - built - bare);
  if (built >= bare && built >= green) return 'built';
  return bare >= green ? 'bare' : 'green';
}

/** Why the surface keeps or loses its heat into the evening, from the reference table (Oke 1987). */
export function storageLine(kind: SurfaceKind, surfaces: readonly SurfaceMaterial[], locale: Locale): string | null {
  const t = ENERGY_TEXTS[locale].storage;
  const admittanceOf = (key: string): string | null => {
    const surface = surfaces.find((s) => s.key === key);
    return surface ? formats(locale).formatNumber(surface.admittance, 0) : null;
  };
  const asphalt = admittanceOf('asphalt');
  const concrete = admittanceOf('concrete');
  const dry = admittanceOf('dry_soil');
  const wet = admittanceOf('wet_soil');
  if (kind === 'built' && asphalt && concrete && dry) return t.built(asphalt, concrete, dry);
  if (kind === 'bare' && dry && asphalt) return t.bare(dry, asphalt);
  if (kind === 'green' && wet) return t.green(wet);
  return null;
}

/** The simplifications, said once, next to the numbers. */
export function energyCaveat(method: EnergyMethod, locale: Locale): string {
  return ENERGY_TEXTS[locale].caveat(method.localHour, formatWatts(method.solarWm2, locale));
}

export interface EnergyView {
  fluxes: Fluxes;
  verdict: string;
  comparison: string | null;
  storage: string | null;
  caveat: string;
}

/** Everything the "Physics of the place" block says about some cells, or null without energy data. */
export function energyView(detail: CityDetail, fluxes: Fluxes | null, values: Record<string, number>, locale: Locale): EnergyView | null {
  if (!fluxes || !detail.energy) return null;
  const green = meanFluxes(detail, greenestTenth(detail));
  const kind = dominantSurface(values);
  return {
    fluxes,
    verdict: fluxVerdict(fluxes, locale),
    comparison: green ? greenComparison(fluxes, green, locale) : null,
    storage: kind ? storageLine(kind, detail.energy.surfaces, locale) : null,
    caveat: energyCaveat(detail.energy, locale),
  };
}

export interface CityEnergy {
  hot: Fluxes;
  mean: Fluxes;
  green: Fluxes;
}

/** The hottest tenth, the whole city and the greenest tenth side by side; null without energy data. */
export function cityEnergy(detail: CityDetail): CityEnergy | null {
  if (!detail.energy) return null;
  const hot = meanFluxes(detail, hottestTenth(detail));
  const green = meanFluxes(detail, greenestTenth(detail));
  return hot && green ? { hot, mean: detail.energy.mean, green } : null;
}

/** The city in one sentence: how much more the hottest places heat the air than the greenest. */
export function cityEnergyLine(cityName: string, summary: CityEnergy, locale: Locale): string {
  const { hot, green } = summary;
  const { formatPercent } = formats(locale);
  return ENERGY_TEXTS[locale].cityLine(
    cityName,
    formatWatts(hot.h, locale),
    formatWatts(green.h, locale),
    formatPercent(sinkShares(hot).le),
    formatPercent(sinkShares(green).le),
  );
}
