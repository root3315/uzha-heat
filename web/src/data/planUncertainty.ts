/**
 * How sure "Where to plant first" is, written by `python -m pipeline.plan_check --all`: each place's cooling under
 * models refit on block-bootstrap resamples of the city's cells. Optional: the plan stands without it.
 */
import { isNumber, isObject } from './parse';

export interface PlaceSpread {
  cell: number;
  /** The site's own figure, °C, positive. */
  cooling: number;
  /** The 5th and 95th percentile and the median over the refits, °C, positive. */
  low: number;
  median: number;
  high: number;
}

export interface CitySpread {
  replicates: number;
  places: PlaceSpread[];
}

export type PlanUncertainty = Record<string, CitySpread>;

function parsePlace(value: unknown): PlaceSpread | null {
  if (!isObject(value)) return null;
  const { cell, cooling, low, median, high } = value;
  return isNumber(cell) && isNumber(cooling) && isNumber(low) && isNumber(median) && isNumber(high)
    ? { cell, cooling, low, median, high }
    : null;
}

/** Lenient: anything malformed is dropped rather than breaking the plan. */
export function parsePlanUncertainty(value: unknown): PlanUncertainty {
  if (!isObject(value)) return {};
  const out: PlanUncertainty = {};
  for (const [id, city] of Object.entries(value)) {
    if (!isObject(city) || !isNumber(city.replicates) || !Array.isArray(city.places)) continue;
    out[id] = { replicates: city.replicates, places: city.places.flatMap((p) => parsePlace(p) ?? []) };
  }
  return out;
}

/** The spread for a place of the plan, when the file has that very cell for the city. */
export const spreadFor = (uncertainty: PlanUncertainty | null, cityId: string, cell: number): PlaceSpread | undefined =>
  uncertainty?.[cityId]?.places.find((place) => place.cell === cell);
