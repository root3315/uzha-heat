import { describe, expect, it } from 'vitest';
import type { CityDetail, FeatureMeta } from '../data/contract';
import { hotspotProfile } from './places';
import { distinctByName, hotTenthCauses, hottestPlaces, keyFigures, reportTransect, sectionOnData } from './report';
import { sampleTransect, type Transect, type TransectSource } from './transect';

/** Plain metres, data only for 0 ≤ x ≤ 10 km and 0 ≤ y ≤ 1 km. */
const source: TransectSource = {
  toMetres: ([x, y]) => [x, y],
  fromMetres: ([x, y]) => [x, y],
  cellAt: ([x, y]) => (x >= 0 && x <= 10_000 && y >= 0 && y <= 1000 ? Math.floor(x / 100) : -1),
  inside: () => true,
  temperatureAt: ([x]) => 40 + x / 1000,
  contributionsOf: () => ({ ndvi: 1 }),
};
const onData: Transect = [
  [1000, 500],
  [9000, 500],
];
const offData: Transect = [
  [1000, 5000],
  [5700, 5000],
];

describe('reportTransect', () => {
  it('keeps the section on screen when it runs over the data', () => {
    expect(reportTransect(source, onData, offData).transect).toBe(onData);
  });

  it('falls back to the default section when the one on screen missed the data', () => {
    expect(sectionOnData(sampleTransect(source, offData))).toBe(false);
    const { transect, profile } = reportTransect(source, offData, onData);
    expect(transect).toBe(onData);
    expect(sectionOnData(profile)).toBe(true);
  });

  it('does not trust a section that only clips the data', () => {
    const clipping: Transect = [
      [9500, 500],
      [30_000, 500],
    ];
    expect(sectionOnData(sampleTransect(source, clipping))).toBe(false);
  });
});

const feature = (key: string): FeatureMeta => ({ key, label: key, unit: '', description: '' });

/** Ten cells in a row along the equator, 0.01° (≈1.1 km) apart. */
function city(lst: number[], shap: Record<string, number[]>): CityDetail {
  return {
    features: [feature('ndvi'), feature('built')],
    stats: { lstMean: 42, lstMin: 30, lstMax: 55, lstP10: 36, lstP90: 49 },
    cells: { lon: lst.map((_, i) => i * 0.01), lat: lst.map(() => 0), lst, values: { ndvi: lst.map(() => 0), built: lst.map(() => 0) }, shap },
  } as unknown as CityDetail;
}

describe('hottestPlaces', () => {
  const lst = [50, 51, 40, 40, 49, 40, 40, 48, 40, 52];
  const shap = { ndvi: lst.map((_, i) => (i === 7 ? 0.5 : 3)), built: lst.map((_, i) => (i === 7 ? 2 : 1)) };

  it('takes the hottest cells inside the city, far enough apart, with what heats each most', () => {
    const inside = lst.map((_, i) => i !== 9);
    const places = hottestPlaces(city(lst, shap), inside, 3, 1500);
    // 52° is outside; 51° wins; 50° is 1.1 km from it and is skipped; then 49° and 48°.
    expect(places.map((p) => p.lst)).toEqual([51, 49, 48]);
    expect(places[0]?.cause).toEqual({ key: 'ndvi', value: 3 });
    expect(places[2]?.cause).toEqual({ key: 'built', value: 2 });
  });
});

describe('hotTenthCauses', () => {
  it('lists every factor over the hottest tenth, largest first, with how often it leads', () => {
    const lst = [50, 50, 40, 40, 40, 40, 40, 40, 40, 40];
    const d = city(lst, { ndvi: [3, 0, 0, 0, 0, 0, 0, 0, 0, 0], built: [1, 2, 0, 0, 0, 0, 0, 0, 0, 0] });
    const lines = hotTenthCauses(d, hotspotProfile(d));
    expect(lines).toEqual([
      { key: 'ndvi', value: 1.5, leads: 0.5 },
      { key: 'built', value: 1.5, leads: 0.5 },
    ]);
  });
});

describe('keyFigures', () => {
  it('gives the spread between the hottest and the coolest tenth', () => {
    expect(keyFigures({ lstMean: 42, lstMin: 30, lstMax: 55, lstP10: 36, lstP90: 49 })).toEqual({ mean: 42, hot: 49, cool: 36, spread: 13 });
  });
});

describe('distinctByName', () => {
  it('keeps one item per name and leaves unnamed ones alone', () => {
    const names = ['Аэропорт', 'Чиланзар', 'Аэропорт', null, null, 'Юнусабад'];
    const picked = distinctByName(names, (name) => name, 4);
    expect(picked.map((p) => p.index)).toEqual([0, 1, 3, 4]);
  });
});
