import type { CityDetail, FeatureMeta } from '../data/contract';
import { mean, meanAt, pointInGeometry } from './stats';

/** Everything the panel needs to describe one place: a single cell or the city's hottest tenth. */
export interface PlaceProfile {
  kind: 'cell' | 'hotspot';
  /** Cell index for a single cell. */
  cell?: number;
  lst: number;
  cellCount: number;
  values: Record<string, number>;
  contributions: Record<string, number>;
}

export type FactorMeans = Record<string, number>;

export function cityFactorMeans(detail: CityDetail): FactorMeans {
  return Object.fromEntries(detail.features.map((f) => [f.key, mean(detail.cells.values[f.key] ?? [])]));
}

function columnAt(columns: Record<string, number[]>, features: FeatureMeta[], index: number): Record<string, number> {
  return Object.fromEntries(features.map((f) => [f.key, columns[f.key]?.[index] ?? 0]));
}

function averageColumns(columns: Record<string, number[]>, features: FeatureMeta[], members: readonly number[]): Record<string, number> {
  return Object.fromEntries(features.map((f) => [f.key, meanAt(columns[f.key] ?? [], members)]));
}

export function cellProfile(detail: CityDetail, index: number): PlaceProfile {
  const { cells, features } = detail;
  return {
    kind: 'cell',
    cell: index,
    lst: cells.lst[index] ?? Number.NaN,
    cellCount: 1,
    values: columnAt(cells.values, features, index),
    contributions: columnAt(cells.shap, features, index),
  };
}

export function hottestTenth(detail: CityDetail): number[] {
  return detail.cells.lst.flatMap((t, i) => (t >= detail.stats.lstP90 ? [i] : []));
}

/** Averages over the hottest tenth of the city: the subject of the city-wide answer. */
export function hotspotProfile(detail: CityDetail): PlaceProfile {
  const { cells, features } = detail;
  const members = hottestTenth(detail);
  return {
    kind: 'hotspot',
    lst: meanAt(cells.lst, members),
    cellCount: members.length,
    values: averageColumns(cells.values, features, members),
    contributions: averageColumns(cells.shap, features, members),
  };
}

/** Factor with the largest positive contribution, or null when nothing heats the place. */
export function dominantHeatingFactor(keys: readonly string[], contributionOf: (key: string) => number): string | null {
  let best: string | null = null;
  let bestValue = 0;
  for (const key of keys) {
    const value = contributionOf(key);
    if (value > bestValue) {
      best = key;
      bestValue = value;
    }
  }
  return best;
}

export function dominantFactorPerCell(detail: CityDetail): (string | null)[] {
  const keys = detail.features.map((f) => f.key);
  const { shap } = detail.cells;
  return detail.cells.lst.map((_, i) => dominantHeatingFactor(keys, (key) => shap[key]?.[i] ?? 0));
}

/** Name of the district (from the data) that contains the point, if the data has districts. */
export function districtAt(detail: CityDetail, point: [number, number]): string | null {
  return detail.districts.find((district) => pointInGeometry(point, district.geometry))?.name ?? null;
}
