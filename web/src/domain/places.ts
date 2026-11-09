import type { CityDetail, FeatureMeta } from '../data/contract';
import { geometryBounds, mean, meanAt, pointInGeometry } from './stats';

export type Selection = { kind: 'cell'; index: number } | { kind: 'district'; index: number };
export type PlaceKind = Selection['kind'] | 'hotspot';

/** Everything the panel, waterfall and recommendations need to describe one place. */
export interface PlaceProfile {
  kind: PlaceKind;
  title: string;
  /** Cell centre, [lon, lat]; only for single cells. */
  center?: [number, number];
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

export function cellProfile(detail: CityDetail, index: number): PlaceProfile {
  const { cells, features } = detail;
  return {
    kind: 'cell',
    title: `Участок ${detail.grid.cellSizeM} × ${detail.grid.cellSizeM} м`,
    center: [cells.lon[index] ?? 0, cells.lat[index] ?? 0],
    lst: cells.lst[index] ?? Number.NaN,
    cellCount: 1,
    values: columnAt(cells.values, features, index),
    contributions: columnAt(cells.shap, features, index),
  };
}

const districtMembership = new WeakMap<CityDetail, number[][]>();

function computeDistrictMembership(detail: CityDetail): number[][] {
  const { lon, lat } = detail.cells;
  return detail.districts.map((district) => {
    const [w, s, e, n] = geometryBounds(district.geometry);
    const members: number[] = [];
    for (let i = 0; i < lon.length; i++) {
      const x = lon[i] ?? 0;
      const y = lat[i] ?? 0;
      if (x < w || x > e || y < s || y > n) continue;
      if (pointInGeometry([x, y], district.geometry)) members.push(i);
    }
    return members;
  });
}

/** Cell indices inside the district; membership is computed once per city and reused. */
export function cellsInDistrict(detail: CityDetail, districtIndex: number): number[] {
  let membership = districtMembership.get(detail);
  if (!membership) {
    membership = computeDistrictMembership(detail);
    districtMembership.set(detail, membership);
  }
  return membership[districtIndex] ?? [];
}

function averageColumns(columns: Record<string, number[]>, features: FeatureMeta[], members: number[]): Record<string, number> {
  return Object.fromEntries(features.map((f) => [f.key, meanAt(columns[f.key] ?? [], members)]));
}

export function districtProfile(detail: CityDetail, districtIndex: number, members: number[]): PlaceProfile {
  const district = detail.districts[districtIndex];
  if (!district) throw new Error(`Нет района с индексом ${districtIndex}`);
  const { cells, features } = detail;
  const computedShap = averageColumns(cells.shap, features, members);
  return {
    kind: 'district',
    title: district.name,
    lst: district.lstMean,
    cellCount: district.cellCount,
    values: averageColumns(cells.values, features, members),
    contributions: Object.fromEntries(features.map((f) => [f.key, district.shapMean[f.key] ?? computedShap[f.key] ?? 0])),
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

/** Averages over the hottest tenth of the city: the default subject for city-wide recommendations. */
export function hotspotProfile(detail: CityDetail): PlaceProfile {
  const { cells, features, stats } = detail;
  const members = cells.lst.flatMap((t, i) => (t >= stats.lstP90 ? [i] : []));
  return {
    kind: 'hotspot',
    title: 'Самые горячие 10 % города',
    lst: meanAt(cells.lst, members),
    cellCount: members.length,
    values: averageColumns(cells.values, features, members),
    contributions: averageColumns(cells.shap, features, members),
  };
}
