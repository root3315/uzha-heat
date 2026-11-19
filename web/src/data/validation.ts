/**
 * The check of our Landsat surface temperature against NASA MODIS (MOD11A2 / MYD11A2, 1 km), written by
 * `python -m pipeline.validate --all --web`. Optional: the site works without it.
 */

export interface Agreement {
  n: number;
  r: number;
  /** Ours minus MODIS, °C. */
  bias: number;
  rmse: number;
}

export interface ModisPlatform {
  product: string;
  overpassLocal: { day: string; night: string };
  composites: number;
  /** Null when too few pixels overlapped to compare; the heat island still stands on its own. */
  day: Agreement | null;
  /** The same, only on pixels inside the city outline: the pattern within the city, not just city against countryside. */
  dayInsideCity: Agreement | null;
  /** Heat island by MODIS, °C, keyed by ring width ("1km", "1.5km", ...); null where a side had too few pixels. */
  heatIsland: { day: Record<string, number | null>; night: Record<string, number | null> };
}

export interface CityValidation {
  terra?: ModisPlatform;
  aqua?: ModisPlatform;
}

export interface Validation {
  period: string;
  cities: Record<string, CityValidation>;
}

import { isNumber, isObject } from './parse';

function parseRings(value: unknown): Record<string, number | null> {
  if (!isObject(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([width, v]) => [width, isNumber(v) ? v : null]));
}

function parseAgreement(value: unknown): Agreement | null {
  if (!isObject(value)) return null;
  const { n, r, bias, rmse } = value;
  return isNumber(n) && isNumber(r) && isNumber(bias) && isNumber(rmse) ? { n, r, bias, rmse } : null;
}

function parsePlatform(value: unknown): ModisPlatform | undefined {
  if (!isObject(value) || !isObject(value.heatIsland) || !isObject(value.overpassLocal)) return undefined;
  return {
    product: String(value.product ?? ''),
    overpassLocal: { day: String(value.overpassLocal.day ?? ''), night: String(value.overpassLocal.night ?? '') },
    composites: isNumber(value.composites) ? value.composites : 0,
    day: parseAgreement(value.day),
    dayInsideCity: parseAgreement(value.dayInsideCity),
    heatIsland: { day: parseRings(value.heatIsland.day), night: parseRings(value.heatIsland.night) },
  };
}

/** Lenient: anything malformed is dropped rather than breaking the page. */
export function parseValidation(value: unknown): Validation | null {
  if (!isObject(value) || !isObject(value.cities)) return null;
  const cities = Object.fromEntries(
    Object.entries(value.cities).map(([id, city]) => [id, isObject(city) ? { terra: parsePlatform(city.terra), aqua: parsePlatform(city.aqua) } : {}]),
  );
  return { period: String(value.period ?? ''), cities };
}
