import type { LonLat } from '../data/contract';
import { pointInGeometry, quantile, type AreaGeometry } from './stats';

/** Which cells lie inside the city outline. Without an outline every cell counts as inside. */
export function insideMask(lon: readonly number[], lat: readonly number[], outline: AreaGeometry | null): boolean[] {
  return lon.map((x, i) => (outline ? pointInGeometry([x, lat[i] ?? 0] as LonLat, outline) : true));
}

export interface HeatIsland {
  /** Median surface temperature of the cells inside the city outline, °C. */
  inside: number;
  /** Median of the cells in the ring around it, °C. */
  outside: number;
  /** inside − outside: positive when the city is hotter than its surroundings. */
  intensity: number;
  insideCount: number;
  outsideCount: number;
}

/** Fewer cells than this on either side and the comparison is not worth stating. */
const MIN_CELLS = 30;

/**
 * Surface urban heat island intensity: median LST inside the outline minus median LST of the margin around it.
 * Medians, so a few runways or a reservoir do not move it. Null when one side is too small to compare.
 */
export function heatIslandIntensity(lst: readonly number[], inside: readonly boolean[]): HeatIsland | null {
  const within: number[] = [];
  const around: number[] = [];
  lst.forEach((t, i) => {
    if (!Number.isFinite(t)) return;
    (inside[i] ? within : around).push(t);
  });
  if (within.length < MIN_CELLS || around.length < MIN_CELLS) return null;
  const insideMedian = quantile(within, 0.5);
  const outsideMedian = quantile(around, 0.5);
  return {
    inside: insideMedian,
    outside: outsideMedian,
    intensity: insideMedian - outsideMedian,
    insideCount: within.length,
    outsideCount: around.length,
  };
}

/**
 * The reference area by the rule of the team's theory notes (Eq. 2 and 47): cells of the ring at the city's height, not
 * dominated by water, irrigation or bare ground. Each rule is a stated threshold; the share it removes is reported.
 */
export const REFERENCE_RULES = [
  { id: 'water', test: (v: FactorRow) => (v.water_dist ?? Infinity) < 200 },
  { id: 'irrigated', test: (v: FactorRow) => (v.ndvi ?? 0) > 0.45 && (v.built ?? 0) < 10 },
  { id: 'bare', test: (v: FactorRow) => (v.bare ?? 0) > 50 },
  { id: 'height', test: (v: FactorRow, cityHeight: number) => Math.abs((v.elevation ?? cityHeight) - cityHeight) > 50 },
] as const;

export type ReferenceRuleId = (typeof REFERENCE_RULES)[number]['id'];
type FactorRow = Partial<Record<string, number>>;

export interface ReferenceIsland {
  /** City median minus the median of the ring cells the rules keep. */
  island: HeatIsland | null;
  /** Per rule: ring cells it removes, and the island with only that rule applied. */
  rules: { id: ReferenceRuleId; removed: number; island: HeatIsland | null }[];
}

/** The heat island against the ring with all rules applied, and with each rule alone, so the reader sees what moves it. */
export function referenceIsland(lst: readonly number[], values: Record<string, readonly number[]>, inside: readonly boolean[]): ReferenceIsland {
  const row = (i: number): FactorRow => Object.fromEntries(Object.entries(values).map(([key, column]) => [key, column[i]]));
  const heights = (values.elevation ?? []).filter((h, i) => inside[i] && Number.isFinite(h));
  const cityHeight = heights.length ? quantile(heights, 0.5) : 0;
  const removedBy = REFERENCE_RULES.map((rule) => lst.map((_, i) => !inside[i] && rule.test(row(i), cityHeight)));
  // A cell dropped from the ring is left out of the comparison altogether: neither city nor reference.
  const islandWithout = (drop: (i: number) => boolean) => {
    const kept = lst.map((t, i) => (drop(i) ? Number.NaN : t));
    return heatIslandIntensity(kept, inside);
  };
  return {
    island: islandWithout((i) => removedBy.some((mask) => mask[i])),
    rules: REFERENCE_RULES.map((rule, r) => ({
      id: rule.id,
      removed: removedBy[r]?.filter(Boolean).length ?? 0,
      island: islandWithout((i) => removedBy[r]?.[i] ?? false),
    })),
  };
}
