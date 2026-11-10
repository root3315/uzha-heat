import type { CityDetail, Facility, FacilityType, LonLat } from '../data/contract';
import { formatNumber, plural } from './format';
import { distanceM } from './placeName';
import { hottestTenth } from './places';

/** How many people live in the hottest tenth of the city, out of everyone on the map. */
export interface PeopleInHeat {
  people: number;
  total: number;
  /** Cells in the hottest tenth. */
  cells: number;
}

const sumAt = (values: readonly number[], members: readonly number[]) => members.reduce((s, i) => s + (values[i] ?? 0), 0);

/** People living on the cells at or above the hottest-tenth threshold; null when the data has no population. */
export function peopleInHeat(detail: CityDetail): PeopleInHeat | null {
  const { pop } = detail.cells;
  if (!pop) return null;
  const members = hottestTenth(detail);
  return { people: sumAt(pop, members), total: sumAt(pop, pop.map((_, i) => i)), cells: members.length };
}

export interface PeoplePlace {
  cell: number;
  point: LonLat;
  lst: number;
  /** People living in this 200 m cell. */
  people: number;
}

/**
 * Hot places ranked by how many people they touch: cells of the hottest tenth, most people first (hotter first on a tie),
 * at least `minGapM` apart, so five places are five neighbourhoods and not one block counted five times.
 */
export function hotPlacesByPeople(detail: CityDetail, count = 5, minGapM = 1000): PeoplePlace[] {
  const { pop, lst, lon, lat } = detail.cells;
  if (!pop) return [];
  const order = hottestTenth(detail)
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

const FACILITY_WORDS: Record<FacilityType, string> = {
  school: 'школа',
  kindergarten: 'детский сад',
  clinic: 'поликлиника',
  hospital: 'больница',
};

/** "Школа № 110" as named in OSM, or the kind of place when it has no name there. */
export function facilityTitle(facility: Facility): string {
  const word = FACILITY_WORDS[facility.type];
  return facility.name || word.charAt(0).toUpperCase() + word.slice(1);
}

/** A people count rounded to what a model estimate can say: 323 000 → 323 тыс., 1373 → 1,4 тыс., 417 → 420. */
function roundPeople(n: number): { figure: string; count: number } {
  if (n >= 10_000) return { figure: `${formatNumber(Math.round(n / 1000), 0)} тыс.`, count: 0 };
  if (n >= 1000) return { figure: `${formatNumber(n / 1000, 1)} тыс.`, count: 0 };
  const count = n >= 100 ? Math.round(n / 10) * 10 : Math.round(n);
  return { figure: formatNumber(count, 0), count };
}

/** The number alone, for a big figure with its noun in a caption: "323 тыс.", "420". */
export const peopleFigure = (n: number): string => roundPeople(n).figure;

/** The noun that goes with the rounded number, in the given forms (for 1, 2–4, 5+). */
export const peopleNoun = (n: number, forms: readonly [string, string, string]): string => plural(roundPeople(n).count, forms);

/** People as a reader takes them in: "323 тыс. человек", "1,4 тыс. человек", "420 человек". */
export const formatPeople = (n: number): string => `${peopleFigure(n)} ${peopleNoun(n, ['человек', 'человека', 'человек'])}`;

/** The caveat printed next to every population figure. */
export const populationCaveat = (year: number): string =>
  `Число жителей: оценка WorldPop ${year}. Это модель по переписи и снимкам застройки, а не подсчёт людей.`;
