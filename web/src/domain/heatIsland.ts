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
