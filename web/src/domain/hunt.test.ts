import { describe, expect, it } from 'vitest';
import type { CityDetail, FeatureMeta } from '../data/contract';
import { cellReadout, findMessage, huntCell, huntTarget, leadingFactor, registerFind } from './hunt';

const feature = (key: string, label: string, unit: string): FeatureMeta => ({ key, label, unit, description: '' });

function city(): CityDetail {
  const lst = [38, 41, 44, 47, 50, 52];
  return {
    city: { id: 'x', name: 'Ташкент', nameEn: 'Tashkent', country: 'Узбекистан', center: [0, 0], bbox: [0, 0, 1, 1], lstMean: 45, r2: 0.7 },
    period: { label: 'лето', lstScenes: 9, s2Scenes: 6 },
    grid: { cellSizeM: 200, halfSizeDeg: [0.001, 0.001], count: lst.length },
    features: [feature('ndvi', 'Растительность', 'NDVI'), feature('built', 'Застройка', '% площади')],
    model: { type: 'XGBoost', r2Cv: 0.7, maeCv: 1.2, cv: 'spatial', baseValue: 45 },
    stats: { lstMean: 45, lstMin: 38, lstMax: 52, lstP10: 39, lstP90: 50 },
    globalImportance: [],
    cells: {
      lon: lst.map((_, i) => i),
      lat: lst.map(() => 0),
      lst,
      values: { ndvi: lst.map(() => 0.2), built: lst.map(() => 50) },
      shap: { ndvi: [-3, -1, 0.2, 2, 4, 1], built: [0.5, 0.2, -0.4, 0.5, 1, 3] },
    },
    districts: [],
    population: null,
    facilities: [],
    energy: null,
  };
}

describe('huntTarget', () => {
  it('counts the cells at or above the 90th percentile', () => {
    expect(huntTarget(city())).toEqual({ threshold: 50, total: 2 });
  });

  it('counts only the cells that can be tapped, inside the city', () => {
    expect(huntTarget(city(), [true, true, true, true, true, false])).toEqual({ threshold: 50, total: 1 });
  });
});

describe('huntCell', () => {
  const target = { threshold: 50, total: 2 };
  const tapped = { cell: 3, t: 47 };

  it('counts a hot neighbour when the tap lands one cell off', () => {
    expect(huntCell([tapped, { cell: 4, t: 50 }, { cell: 2, t: 44 }], new Set(), target)).toEqual({ cell: 4, t: 50 });
  });

  it('prefers a hot neighbour not yet found', () => {
    expect(huntCell([tapped, { cell: 4, t: 50 }, { cell: 5, t: 52 }], new Set([4]), target)).toEqual({ cell: 5, t: 52 });
  });

  it('falls back to the tapped cell when nothing near is hot', () => {
    expect(huntCell([tapped, { cell: 2, t: 44 }], new Set(), target)).toEqual(tapped);
    expect(huntCell([], new Set(), target)).toBeNull();
  });
});

describe('registerFind', () => {
  const target = { threshold: 50, total: 2 };

  it('counts a hot cell once', () => {
    const first = registerFind(new Set(), 4, 50, target);
    expect(first.outcome).toBe('new');
    expect([...first.found]).toEqual([4]);
    const again = registerFind(first.found, 4, 50, target);
    expect(again.outcome).toBe('repeat');
    expect(again.found).toBe(first.found);
  });

  it('does not count a cooler cell and leaves the set untouched', () => {
    const found = new Set([5]);
    const result = registerFind(found, 1, 41, target);
    expect(result.outcome).toBe('cold');
    expect(result.found).toBe(found);
  });

  it('treats a missing temperature as cold', () => {
    expect(registerFind(new Set(), 0, Number.NaN, target).outcome).toBe('cold');
  });
});

describe('cellReadout', () => {
  it('names the strongest cause, heating or cooling', () => {
    expect(cellReadout(city(), 4)).toEqual({ t: 50, cause: 'мало зелени', heats: true });
    expect(cellReadout(city(), 0)).toEqual({ t: 38, cause: 'зелень', heats: false });
  });

  it('returns null outside the data', () => {
    expect(cellReadout(city(), 99)).toBeNull();
  });
});

describe('leadingFactor', () => {
  it('gives the top factor and its share of the total mean |SHAP|', () => {
    const result = leadingFactor([
      { key: 'built', meanAbsShap: 0.5, correlation: 0.5 },
      { key: 'ndvi', meanAbsShap: 1.5, correlation: -0.8 },
    ]);
    expect(result?.key).toBe('ndvi');
    expect(result?.share).toBeCloseTo(0.75);
  });

  it('is null without importance data', () => {
    expect(leadingFactor([])).toBeNull();
  });
});

describe('findMessage', () => {
  const target = { threshold: 47.9, total: 10 };
  const plain = (text: string) => text.replace(/[  ]/g, ' ');

  it('confirms a find and refuses a repeat', () => {
    expect(plain(findMessage('new', 49.24, target, 43.8))).toBe('Засчитано: 49,2°, горячая десятая часть города.');
    expect(findMessage('repeat', 49.24, target, 43.8)).toBe('Этот участок уже засчитан.');
  });

  it('says how far a miss was from hot', () => {
    expect(plain(findMessage('cold', 45.1, target, 43.8))).toBe('45,1°: теплее среднего, но горячими считаются от 47,9°.');
    expect(plain(findMessage('cold', 40, target, 43.8))).toBe('40,0°: прохладнее среднего по городу, 43,8°.');
  });
});
