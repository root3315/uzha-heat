import type { LonLat } from './transect';

/** A named point from the basemap: suburb, quarter, neighbourhood. */
export interface NamedPoint {
  name: string;
  point: LonLat;
}

/** A named line from the basemap: a street. */
export interface NamedLine {
  name: string;
  line: LonLat[];
}

export interface PlaceNameOptions {
  placeRadiusM?: number;
  streetRadiusM?: number;
}

const EARTH_M_PER_DEG = 111_320;

/** Local planar metres around `origin`; plenty accurate within a few kilometres. */
function toLocal(origin: LonLat, [lon, lat]: LonLat): [number, number] {
  const k = Math.cos((origin[1] * Math.PI) / 180);
  return [(lon - origin[0]) * EARTH_M_PER_DEG * k, (lat - origin[1]) * EARTH_M_PER_DEG];
}

export function distanceM(a: LonLat, b: LonLat): number {
  const [x, y] = toLocal(a, b);
  return Math.hypot(x, y);
}

export function distanceToLineM(point: LonLat, line: readonly LonLat[]): number {
  if (line.length === 1 && line[0]) return distanceM(point, line[0]);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = toLocal(point, line[i - 1] ?? point);
    const [bx, by] = toLocal(point, line[i] ?? point);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

function nearest<T>(items: readonly T[], distance: (item: T) => number, radius: number): T | null {
  let best: T | null = null;
  let bestDistance = radius;
  for (const item of items) {
    const d = distance(item);
    if (d <= bestDistance) {
      best = item;
      bestDistance = d;
    }
  }
  return best;
}

const STREET_GENITIVE: ReadonlyArray<readonly [RegExp, string]> = [
  [/^улица /i, 'улицы '],
  [/^проспект /i, 'проспекта '],
  [/^переулок /i, 'переулка '],
  [/^проезд /i, 'проезда '],
  [/^бульвар /i, 'бульвара '],
  [/^тупик /i, 'тупика '],
  [/ улица$/i, ' улицы'],
  [/ проспект$/i, ' проспекта'],
  [/ переулок$/i, ' переулка'],
  [/ проезд$/i, ' проезда'],
];

/** "улица Бабура" → "улицы Бабура", for "у улицы Бабура". Names in other languages stay as they are. */
export function streetGenitive(name: string): string {
  for (const [pattern, replacement] of STREET_GENITIVE) {
    if (pattern.test(name)) return name.replace(pattern, replacement);
  }
  return name;
}

/** How specific a name is: a neighbourhood beats a street, a street beats a district, anything beats none. */
export type NamePrecision = 0 | 1 | 2 | 3;
export const PRECISION = { none: 0, district: 1, street: 2, place: 3 } as const;

export interface FoundName {
  name: string;
  precision: NamePrecision;
}

/**
 * Name for a picked point from what is already at hand: the nearest named place on the basemap,
 * else "Участок у <улица>", else the district from the data, else null. No geocoding service is involved.
 */
export function placeName(
  point: LonLat,
  places: readonly NamedPoint[],
  streets: readonly NamedLine[],
  district: string | null = null,
  { placeRadiusM = 1500, streetRadiusM = 400 }: PlaceNameOptions = {},
): FoundName | null {
  const place = nearest(places, (p) => distanceM(point, p.point), placeRadiusM);
  if (place) return { name: place.name, precision: PRECISION.place };
  const street = nearest(streets, (s) => distanceToLineM(point, s.line), streetRadiusM);
  if (street) return { name: `Участок у ${streetGenitive(street.name)}`, precision: PRECISION.street };
  return district ? { name: district, precision: PRECISION.district } : null;
}
