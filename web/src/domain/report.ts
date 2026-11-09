import type { CityDetail, LstStats } from '../data/contract';
import { dominantShares } from './hotTenth';
import { distanceM } from './placeName';
import { dominantHeatingFactor, hottestTenth, type PlaceProfile } from './places';
import { insideSamples, sampleTransect, type LonLat, type Profile, type Transect, type TransectSource } from './transect';

/** A section with less than this share of its length on data says nothing worth printing. */
const MIN_INSIDE_SHARE = 0.5;
const MIN_INSIDE_SAMPLES = 3;

/** The section is worth a report: enough of it runs over the city's data. */
export function sectionOnData(profile: Profile): boolean {
  const inside = insideSamples(profile).length;
  return inside >= MIN_INSIDE_SAMPLES && inside / (profile.samples.length || 1) >= MIN_INSIDE_SHARE;
}

/** The section the report prints: the one on screen when it lies on the data, otherwise the default through the hottest place. */
export function reportTransect(source: TransectSource, current: Transect, fallback: Transect): { transect: Transect; profile: Profile } {
  const profile = sampleTransect(source, current);
  if (sectionOnData(profile)) return { transect: current, profile };
  return { transect: fallback, profile: sampleTransect(source, fallback) };
}

export interface KeyFigures {
  mean: number;
  /** The hottest tenth starts here. */
  hot: number;
  /** The coolest tenth ends here. */
  cool: number;
  /** Between the two, °C. */
  spread: number;
}

export const keyFigures = (stats: LstStats): KeyFigures => ({ mean: stats.lstMean, hot: stats.lstP90, cool: stats.lstP10, spread: stats.lstP90 - stats.lstP10 });

export interface HotPlace {
  cell: number;
  point: LonLat;
  lst: number;
  /** The factor that heats this cell most, with its contribution, °C. */
  cause: { key: string; value: number } | null;
}

/**
 * The hottest cells inside the city, at least `minGapM` apart, so five places are five different places
 * and not five neighbouring cells of one roof.
 */
export function hottestPlaces(detail: CityDetail, inside: readonly boolean[], count = 5, minGapM = 1500): HotPlace[] {
  const { lst, lon, lat, shap } = detail.cells;
  const keys = detail.features.map((f) => f.key);
  const order = lst
    .map((t, i) => [t, i] as const)
    .filter(([t, i]) => Number.isFinite(t) && inside[i])
    .sort((a, b) => b[0] - a[0]);
  const picked: HotPlace[] = [];
  for (const [t, i] of order) {
    if (picked.length >= count) break;
    const point: LonLat = [lon[i] ?? 0, lat[i] ?? 0];
    if (picked.some((p) => distanceM(p.point, point) < minGapM)) continue;
    const key = dominantHeatingFactor(keys, (k) => shap[k]?.[i] ?? 0);
    picked.push({ cell: i, point, lst: t, cause: key ? { key, value: shap[key]?.[i] ?? 0 } : null });
  }
  return picked;
}

/** The first `count` items whose names differ: one airport is one place, even when its two runways are both among the hottest. */
export function distinctByName<T>(items: readonly T[], nameOf: (item: T, index: number) => string | null, count: number): { item: T; index: number }[] {
  const seen = new Set<string>();
  const picked: { item: T; index: number }[] = [];
  items.forEach((item, index) => {
    if (picked.length >= count) return;
    const name = nameOf(item, index);
    if (name && seen.has(name)) return;
    if (name) seen.add(name);
    picked.push({ item, index });
  });
  return picked;
}

export interface CauseLine {
  key: string;
  /** Mean contribution over the hottest tenth, °C. */
  value: number;
  /** Share of the hottest tenth where it heats most, 0–1. */
  leads: number;
}

/** Every factor over the hottest tenth: what it adds on average and how often it is the main one. Largest first. */
export function hotTenthCauses(detail: CityDetail, hotspot: PlaceProfile): CauseLine[] {
  const leads = new Map(dominantShares(detail, hottestTenth(detail)).map((s) => [s.key, s.share]));
  return detail.features
    .map((f) => ({ key: f.key, value: hotspot.contributions[f.key] ?? 0, leads: leads.get(f.key) ?? 0 }))
    .sort((a, b) => b.value - a.value);
}
