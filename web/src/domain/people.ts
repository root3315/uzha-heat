import type { CityDetail, Facility, LonLat } from '../data/contract';
import type { Locale } from '../i18n/locale';
import { plural, type EnForms, type RuForms } from '../i18n/plural';
import { formats } from './format';
import { PEOPLE_TEXTS } from './people.texts';
import { capitalize } from './phrase';
import { distanceM } from './placeName';
import { hottestTenth } from './places';

/** How many people inside the city outline live in its hottest tenth, out of everyone inside the outline. */
export interface PeopleInHeat {
  people: number;
  total: number;
  /** Cells of the hottest tenth inside the outline. */
  cells: number;
  /** All cells inside the outline. */
  insideCells: number;
}

const sumAt = (values: readonly number[], members: readonly number[]) => members.reduce((s, i) => s + (values[i] ?? 0), 0);

/** Cells of the hottest tenth that lie inside the city outline: the ring around the city is not its people. */
const hotInside = (detail: CityDetail, inside: readonly boolean[]) => hottestTenth(detail).filter((i) => inside[i]);

/**
 * People inside the city outline living on cells at or above the hottest-tenth threshold, out of everyone inside it;
 * null when the data has no population.
 */
export function peopleInHeat(detail: CityDetail, inside: readonly boolean[]): PeopleInHeat | null {
  const { pop } = detail.cells;
  if (!pop) return null;
  const members = hotInside(detail, inside);
  const total = pop.reduce((sum, p, i) => (inside[i] ? sum + p : sum), 0);
  const insideCells = inside.filter(Boolean).length;
  return { people: sumAt(pop, members), total, cells: members.length, insideCells };
}

export interface PeoplePlace {
  cell: number;
  point: LonLat;
  lst: number;
  /** People living in this 200 m cell. */
  people: number;
}

/**
 * Hot places ranked by how many people they touch: cells of the hottest tenth inside the outline, most people first (hotter first on a tie),
 * at least `minGapM` apart, so five places are five neighbourhoods and not one block counted five times.
 */
export function hotPlacesByPeople(detail: CityDetail, inside: readonly boolean[], count = 5, minGapM = 1000): PeoplePlace[] {
  const { pop, lst, lon, lat } = detail.cells;
  if (!pop) return [];
  const order = hotInside(detail, inside)
    .filter((i) => (pop[i] ?? 0) > 0)
    .sort((a, b) => (pop[b] ?? 0) - (pop[a] ?? 0) || (lst[b] ?? 0) - (lst[a] ?? 0));
  const picked: PeoplePlace[] = [];
  for (const i of order) {
    if (picked.length >= count) break;
    const point: LonLat = [lon[i] ?? 0, lat[i] ?? 0];
    if (picked.some((p) => distanceM(p.point, point) < minGapM)) continue;
    picked.push({ cell: i, point, lst: lst[i] ?? Number.NaN, people: pop[i] ?? 0 });
  }
  return picked;
}

export interface NearFacility extends Facility {
  distanceM: number;
}

/** Schools, kindergartens and clinics within `radiusM` of the point, nearest first. */
export function facilitiesNear(facilities: readonly Facility[], point: LonLat, radiusM = 500): NearFacility[] {
  return facilities
    .map((f) => ({ ...f, distanceM: distanceM(point, [f.lon, f.lat]) }))
    .filter((f) => f.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM);
}

/** Facilities standing on a cell of the hottest tenth; `cellAt` finds the cell under a point (−1 off the data). */
export function hotFacilities(detail: CityDetail, cellAt: (point: LonLat) => number): Facility[] {
  const { lst } = detail.cells;
  return detail.facilities.filter((f) => {
    const cell = cellAt([f.lon, f.lat]);
    return cell >= 0 && (lst[cell] ?? Number.NEGATIVE_INFINITY) >= detail.stats.lstP90;
  });
}

/** "Школа № 110" as named in OSM, or the kind of place when it has no name there. */
export function facilityTitle(facility: Facility, locale: Locale): string {
  const word = PEOPLE_TEXTS[locale].facilities[facility.type];
  return facility.name || capitalize(word);
}

/** A people count rounded to what a model estimate can say: 323 000 → 323 thousand, 1373 → 1.4 thousand, 417 → 420. */
function roundPeople(n: number, locale: Locale): { figure: string; count: number } {
  const { formatNumber } = formats(locale);
  const { thousands } = PEOPLE_TEXTS[locale];
  // The form is chosen from the rounded figure, so 996 and 1004 both read "1.0 thousand", and 9,960 "10 thousand".
  const count = n >= 100 ? Math.round(n / 10) * 10 : Math.round(n);
  if (count < 1000) return { figure: formatNumber(count, 0), count };
  const tenths = Math.round(n / 100) / 10;
  if (tenths < 10) return { figure: thousands(formatNumber(tenths, 1)), count: 0 };
  return { figure: thousands(formatNumber(Math.round(n / 1000), 0)), count: 0 };
}

/** The number alone, for a big figure with its noun in a caption: "323 thousand", "420". */
export const peopleFigure = (n: number, locale: Locale): string => roundPeople(n, locale).figure;

/** The noun that goes with the rounded number, in the given forms of each language. */
export const peopleNoun = (n: number, forms: { en: EnForms; ru: RuForms }, locale: Locale): string =>
  plural(locale, roundPeople(n, locale).count, forms);

/** People as a reader takes them in: "323 thousand people", "1.4 thousand people", "420 people". */
export const formatPeople = (n: number, locale: Locale): string =>
  `${peopleFigure(n, locale)} ${PEOPLE_TEXTS[locale].people(roundPeople(n, locale).count)}`;

/** Hot cells this much emptier than the city's average cell are mostly not where people live. */
const SPARSE_RATIO = 0.5;

/**
 * Why so few people live in the heat, when that is the case: "Самые горячие участки здесь почти без жилья: в среднем 20 человек
 * на участок против 220 по городу." Null when the hot cells are as lived-in as the rest.
 */
export function sparseHeatNote(inHeat: PeopleInHeat, locale: Locale): string | null {
  if (inHeat.cells === 0 || inHeat.insideCells === 0) return null;
  const hot = inHeat.people / inHeat.cells;
  const city = inHeat.total / inHeat.insideCells;
  if (hot >= city * SPARSE_RATIO) return null;
  return PEOPLE_TEXTS[locale].sparse(formatPeople(hot, locale), peopleFigure(city, locale));
}

/** The caveat printed next to every population figure. */
export const populationCaveat = (year: number, locale: Locale): string => PEOPLE_TEXTS[locale].caveat(year);
