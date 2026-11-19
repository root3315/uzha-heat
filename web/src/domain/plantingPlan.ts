/**
 * "Where to plant first": the whole city run through the "what if" model at once. Every inhabited cell inside the outline
 * gets a realistic planting (more crowns, more greenery), and places are ranked by degrees of cooling times the people there.
 */
import type { CityDetail, LonLat, TreeModel } from '../data/contract';
import { distanceM } from './placeName';
import { cityRanges, whatIf, type FactorValues } from './whatIf';

/**
 * What one planting adds to a 200 m cell: a fifth of it under crowns (street rows and a yard or two), and the
 * greenery that comes with them. Never past the city's 95th percentile, the same end the sliders have; the crowns
 * take the place of bare ground, then of built-up (`balanceCover`), so the cell's shares stay possible.
 */
export const PLANTING: Readonly<Record<string, number>> = { tree: 20, ndvi: 0.1 };

/** Cooling below this, °C, is no reason to put a place on the list. */
const MIN_COOLING = 0.1;

export interface PlantingPlace {
  cell: number;
  point: LonLat;
  /** How much the model cools the surface here, °C, positive. */
  cooling: number;
  /** People living in this 200 m cell. */
  people: number;
}

const valuesAt = (columns: Record<string, readonly number[]>, cell: number): FactorValues =>
  Object.fromEntries(Object.entries(columns).map(([key, column]) => [key, column[cell] ?? Number.NaN]));

/**
 * The `count` places where greening cools the most people the most: inhabited cells inside the outline, ranked by
 * cooling × people, at least `minGapM` apart.
 */
export function plantingPlan(model: TreeModel, detail: CityDetail, inside: readonly boolean[], count = 5, minGapM = 1000): PlantingPlace[] {
  const { pop, lon, lat, values } = detail.cells;
  if (!pop) return [];
  const ranges = cityRanges(values);
  const keys = Object.keys(PLANTING).filter((key) => model.features.includes(key));

  const scored: (PlantingPlace & { gain: number })[] = [];
  pop.forEach((people, cell) => {
    if (!inside[cell] || !(people > 0)) return;
    const here = valuesAt(values, cell);
    const planted = Object.fromEntries(keys.map((key) => [key, (here[key] ?? 0) + (PLANTING[key] ?? 0)]));
    const cooling = -whatIf(model, here, planted, ranges).delta;
    if (cooling < MIN_COOLING) return;
    scored.push({ cell, point: [lon[cell] ?? 0, lat[cell] ?? 0], cooling, people, gain: cooling * people });
  });
  scored.sort((a, b) => b.gain - a.gain);

  const picked: PlantingPlace[] = [];
  for (const { gain: _gain, ...place } of scored) {
    if (picked.length >= count) break;
    if (picked.some((p) => distanceM(p.point, place.point) < minGapM)) continue;
    picked.push(place);
  }
  return picked;
}
