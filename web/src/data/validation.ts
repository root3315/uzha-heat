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
  day: Agreement;
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

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function parseRings(value: unknown): Record<string, number | null> {
  if (!isObject(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([width, v]) => [width, isNumber(v) ? v : null]));
}

function parsePlatform(value: unknown): ModisPlatform | undefined {
  if (!isObject(value) || !isObject(value.day) || !isObject(value.heatIsland) || !isObject(value.overpassLocal)) return undefined;
  const { n, r, bias, rmse } = value.day;
  if (![n, r, bias, rmse].every(isNumber)) return undefined;
  return {
    product: String(value.product ?? ''),
    overpassLocal: { day: String(value.overpassLocal.day ?? ''), night: String(value.overpassLocal.night ?? '') },
    composites: isNumber(value.composites) ? value.composites : 0,
    day: { n: n as number, r: r as number, bias: bias as number, rmse: rmse as number },
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
