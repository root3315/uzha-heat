import { describe, expect, it } from 'vitest';
import type { CityDetail, Facility } from '../data/contract';
import { facilitiesNear, facilityTitle, formatPeople, hotFacilities, hotPlacesByPeople, peopleInHeat } from './people';

/** Ten cells in a row along the equator, 0.01° (≈1.1 km) apart; the hottest tenth starts at 49°. */
function city(lst: number[], pop?: number[], facilities: Facility[] = []): CityDetail {
  return {
    features: [],
    stats: { lstMean: 42, lstMin: 30, lstMax: 55, lstP10: 36, lstP90: 49 },
    cells: { lon: lst.map((_, i) => i * 0.01), lat: lst.map(() => 0), lst, values: {}, shap: {}, pop },
    facilities,
  } as unknown as CityDetail;
}

const lst = [50, 51, 40, 40, 49, 40, 40, 48, 40, 52];
const pop = [300, 900, 5000, 0, 700, 0, 0, 2000, 0, 0];

describe('peopleInHeat', () => {
  it('sums the people on cells at or above the hottest-tenth threshold', () => {
    expect(peopleInHeat(city(lst, pop))).toEqual({ people: 300 + 900 + 700 + 0, total: 8900, cells: 4 });
  });

  it('says nothing without population data', () => {
    expect(peopleInHeat(city(lst))).toBeNull();
  });
});

describe('hotPlacesByPeople', () => {
  it('ranks hot cells by people, skips empty and too close ones, ignores cool crowded cells', () => {
    const places = hotPlacesByPeople(city(lst, pop), 5, 1500);
    // 5000 and 2000 live on cooler cells; 900 wins; 300 is 1.1 km from it and is skipped; 52° has nobody.
    expect(places.map((p) => [p.cell, p.people])).toEqual([
      [1, 900],
      [4, 700],
    ]);
    expect(places[0]?.lst).toBe(51);
  });

  it('breaks a tie in people by heat', () => {
    const places = hotPlacesByPeople(city([50, 40, 40, 52], [400, 0, 0, 400]), 2, 0);
    expect(places.map((p) => p.cell)).toEqual([3, 0]);
  });

  it('is empty without population data', () => {
    expect(hotPlacesByPeople(city(lst))).toEqual([]);
  });
});

const school: Facility = { name: 'Школа № 5', type: 'school', lon: 0.01, lat: 0.002 };
const clinic: Facility = { name: '', type: 'clinic', lon: 0.011, lat: 0 };
const far: Facility = { name: 'Больница', type: 'hospital', lon: 0.05, lat: 0 };

describe('facilities', () => {
  it('finds the ones within the radius, nearest first', () => {
    const near = facilitiesNear([school, clinic, far], [0.01, 0], 500);
    expect(near.map((f) => f.type)).toEqual(['clinic', 'school']);
    expect(near[0]?.distanceM).toBeCloseTo(111, -1);
  });

  it('keeps only the ones standing on a hot cell', () => {
    const detail = city(lst, pop, [school, clinic, far]);
    const cellAt = ([lon]: [number, number]) => Math.round(lon / 0.01);
    expect(hotFacilities(detail, cellAt)).toEqual([school, clinic]);
    expect(hotFacilities(detail, () => -1)).toEqual([]);
  });

  it('falls back to the kind of place when OSM has no name', () => {
    expect(facilityTitle(school)).toBe('Школа № 5');
    expect(facilityTitle(clinic)).toBe('Поликлиника');
  });
});

describe('formatPeople', () => {
  it('rounds to what a model estimate can say', () => {
    expect(formatPeople(323_341)).toBe('323 тыс. человек');
    expect(formatPeople(1373)).toBe('1,4 тыс. человек');
    expect(formatPeople(417)).toBe('420 человек');
    expect(formatPeople(22)).toBe('22 человека');
    expect(formatPeople(1)).toBe('1 человек');
  });
});
