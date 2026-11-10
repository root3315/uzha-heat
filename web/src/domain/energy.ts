import { FLUX_KEYS, type CityDetail, type EnergyMethod, type Fluxes, type SurfaceMaterial } from '../data/contract';
import { genitive } from './answers';
import { formatNumber, formatPercent } from './format';
import { hottestTenth } from './places';
import { meanAt, quantile } from './stats';

const NBSP = ' ';
export const WATT = `${NBSP}Вт/м²`;
export const formatWatts = (value: number): string => `${formatNumber(value, 0)}${WATT}`;

/** Where the net radiation goes, as the bar draws it left to right. */
export const SINKS = [
  { key: 'le', label: 'испарение' },
  { key: 'h', label: 'нагрев воздуха' },
  { key: 'g', label: 'в грунт' },
] as const;
export type Sink = (typeof SINKS)[number]['key'];

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
export function fluxVerdict(f: Fluxes): string {
  const ef = evaporativeFraction(f);
  if (ef < 0.15) return 'Здесь почти всё солнце уходит в нагрев: испаряться нечему.';
  if (ef < 0.4) return 'Испаряется мало, большая часть тепла уходит в воздух.';
  if (ef < 0.6) return 'Тепло делится почти поровну: часть уходит на испарение, часть греет воздух.';
  return 'Здесь большая часть солнца уходит на испарение: зелень и влажная почва остужают сами себя.';
}

/** How much more this place heats the air than the city's greenest tenth. */
export function greenComparison(here: Fluxes, green: Fluxes): string {
  const ratio = here.h / Math.max(1, green.h);
  if (ratio >= 1.3) {
    return (
      `Воздух здесь греется в${NBSP}${formatNumber(ratio, 1)} раза сильнее, чем на самых зелёных участках города: ` +
      `${formatWatts(here.h)} против ${formatWatts(green.h)}.`
    );
  }
  return `Почти как на самых зелёных участках города: там на нагрев воздуха уходит ${formatWatts(green.h)}.`;
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

const admittanceOf = (surfaces: readonly SurfaceMaterial[], key: string): string | null => {
  const surface = surfaces.find((s) => s.key === key);
  return surface ? formatNumber(surface.admittance, 0) : null;
};

/** Why the surface keeps or loses its heat into the evening, from the reference table (Oke 1987). */
export function storageLine(kind: SurfaceKind, surfaces: readonly SurfaceMaterial[]): string | null {
  const asphalt = admittanceOf(surfaces, 'asphalt');
  const concrete = admittanceOf(surfaces, 'concrete');
  const dry = admittanceOf(surfaces, 'dry_soil');
  const wet = admittanceOf(surfaces, 'wet_soil');
  if (kind === 'built' && asphalt && concrete && dry) {
    return `Асфальт и бетон набирают тепло вглубь и отдают его вечером: тепловая активность ${asphalt} и ${concrete} против ${dry} у сухого грунта.`;
  }
  if (kind === 'bare' && dry && asphalt) {
    return `Сухой грунт тепло вглубь почти не пускает, тепловая активность ${dry} против ${asphalt} у асфальта: днём он горячий сверху, но вечером остывает быстрее.`;
  }
  if (kind === 'green' && wet) {
    return `Влажная почва запасает тепла больше всех, тепловая активность ${wet}, но днём солнце уходит на испарение, и к вечеру запасать почти нечего.`;
  }
  return null;
}

/** The simplifications, said once, next to the numbers. */
export function energyCaveat(method: EnergyMethod): string {
  return (
    `Оценка по одной модели для ясного дня около ${method.localHour}:00. Солнце, ${formatWatts(method.solarWm2)}, и воздух по ERA5 одни на весь город; ` +
    `сколько уходит на испарение, считаем по температуре участка между самым горячим и самым прохладным местом города.`
  );
}

export interface EnergyView {
  fluxes: Fluxes;
  verdict: string;
  comparison: string | null;
  storage: string | null;
  caveat: string;
}

/** Everything the "Физика участка" block says about some cells, or null without energy data. */
export function energyView(detail: CityDetail, fluxes: Fluxes | null, values: Record<string, number>): EnergyView | null {
  if (!fluxes || !detail.energy) return null;
  const green = meanFluxes(detail, greenestTenth(detail));
  const kind = dominantSurface(values);
  return {
    fluxes,
    verdict: fluxVerdict(fluxes),
    comparison: green ? greenComparison(fluxes, green) : null,
    storage: kind ? storageLine(kind, detail.energy.surfaces) : null,
    caveat: energyCaveat(detail.energy),
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
export function cityEnergyLine(cityName: string, summary: CityEnergy): string {
  const { hot, green } = summary;
  return (
    `Самые горячие участки ${genitive(cityName)} отдают воздуху ${formatWatts(hot.h)}, самые зелёные ${formatWatts(green.h)}: ` +
    `на испарение у первых уходит ${formatPercent(sinkShares(hot).le)} энергии, у вторых ${formatPercent(sinkShares(green).le)}.`
  );
}
