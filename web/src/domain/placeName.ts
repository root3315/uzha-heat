import type { Locale } from '../i18n/locale';
import { districtName } from './dataTexts';
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

/** Street types and their genitive: "у улицы", "у проспекта". */
const STREET_TYPES: Record<string, string> = {
  улица: 'улицы',
  проспект: 'проспекта',
  переулок: 'переулка',
  проезд: 'проезда',
  бульвар: 'бульвара',
  тупик: 'тупика',
  дорога: 'дороги',
  площадь: 'площади',
  шоссе: 'шоссе',
  набережная: 'набережной',
};

/** Adjective endings and their genitive: "объездная" → "объездной", "Ташкентский" → "Ташкентского". */
const ADJECTIVE_GENITIVE: ReadonlyArray<readonly [RegExp, string]> = [
  [/ая$/, 'ой'],
  [/яя$/, 'ей'],
  [/([кгхжшчщ])ий$/, '$1ого'],
  [/ий$/, 'его'],
  [/[ыо]й$/, 'ого'],
  [/ое$/, 'ого'],
  [/ее$/, 'его'],
];

const isAdjective = (word: string) => ADJECTIVE_GENITIVE.some(([pattern]) => pattern.test(word));

function adjectiveGenitive(word: string): string {
  const rule = ADJECTIVE_GENITIVE.find(([pattern]) => pattern.test(word));
  return rule ? word.replace(rule[0], rule[1]) : word;
}

/**
 * A street name as it follows "у": "улица Бабура" → "улицы Бабура",
 * "Ташкентская городская объездная дорога" → "Ташкентской городской объездной дороги",
 * "Ханабадтепа проспект" → "проспекта Ханабадтепа" (a name before the type moves after it, as Russian puts it).
 * Names in other languages stay as they are.
 */
export function streetGenitive(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0]?.toLowerCase() ?? '';
  const last = words[words.length - 1]?.toLowerCase() ?? '';
  if (words.length > 1 && STREET_TYPES[first]) return [STREET_TYPES[first], ...words.slice(1)].join(' ');
  if (words.length > 1 && STREET_TYPES[last]) {
    const before = words.slice(0, -1);
    if (before.every(isAdjective)) return [...before.map(adjectiveGenitive), STREET_TYPES[last]].join(' ');
    return [STREET_TYPES[last], ...before].join(' ');
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

/** "Участок у улицы Бабура" in Russian; in English the street keeps its name as the map gives it: "Near Bobur ko'chasi". */
const nearStreet = (street: string, locale: Locale): string => (locale === 'en' ? `Near ${street}` : `Участок у ${streetGenitive(street)}`);

/**
 * Name for a picked point from what is already at hand: the nearest named place on the basemap,
 * else "Near <street>", else the district from the data, else null. No geocoding service is involved.
 * The basemap names come in the reader's language already; the district is the data's and is put into it here.
 */
export function placeName(
  point: LonLat,
  places: readonly NamedPoint[],
  streets: readonly NamedLine[],
  district: string | null,
  locale: Locale,
  { placeRadiusM = 1500, streetRadiusM = 400 }: PlaceNameOptions = {},
): FoundName | null {
  const place = nearest(places, (p) => distanceM(point, p.point), placeRadiusM);
  if (place) return { name: place.name, precision: PRECISION.place };
  const street = nearest(streets, (s) => distanceToLineM(point, s.line), streetRadiusM);
  if (street) return { name: nearStreet(street.name, locale), precision: PRECISION.street };
  return district ? { name: districtName(district, locale), precision: PRECISION.district } : null;
}
