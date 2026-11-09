import { describe, expect, it } from 'vitest';
import type { CityDetail } from '../data/contract';
import { cellProfile, districtAt, dominantFactorPerCell, hotspotProfile, hottestTenth } from './places';

function city(): CityDetail {
  return {
    city: { id: 't', name: 'T', nameEn: 'T', country: 'X', center: [0, 0], bbox: [0, 0, 1, 1], lstMean: 42, r2: 0.5 },
    period: { label: '', lstScenes: 1, s2Scenes: 1 },
    grid: { cellSizeM: 200, halfSizeDeg: [0.001, 0.001], count: 4 },
    features: [
      { key: 'a', label: 'A', unit: '', description: '' },
      { key: 'b', label: 'B', unit: '', description: '' },
    ],
    model: { type: 'm', r2Cv: 0.5, maeCv: 1, cv: 'cv', baseValue: 42 },
    stats: { lstMean: 42, lstMin: 38, lstMax: 46, lstP10: 39, lstP90: 45 },
    globalImportance: [],
    cells: {
      lon: [0, 1, 2, 3],
      lat: [0, 0, 0, 0],
      lst: [38, 41, 45, 46],
      values: { a: [1, 2, 3, 4], b: [5, 6, 7, 8] },
      shap: { a: [-1, 0.5, 2, 0.4], b: [-0.5, -0.2, 1, 1.5] },
    },
    districts: [],
  };
}

describe('places', () => {
  it('reads one cell across every column', () => {
    expect(cellProfile(city(), 2)).toMatchObject({ kind: 'cell', cell: 2, lst: 45, values: { a: 3, b: 7 }, contributions: { a: 2, b: 1 } });
  });

  it('averages the hottest tenth (cells at or above P90)', () => {
    const detail = city();
    expect(hottestTenth(detail)).toEqual([2, 3]);
    const hot = hotspotProfile(detail);
    expect(hot.lst).toBe(45.5);
    expect(hot.contributions.a).toBeCloseTo(1.2);
  });

  it('finds the top heating factor per cell, null when nothing heats', () => {
    expect(dominantFactorPerCell(city())).toEqual([null, 'a', 'a', 'b']);
  });

  it('names the district that contains a point, or nothing', () => {
    const detail = city();
    detail.districts = [
      {
        name: 'Чиланзарский район',
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 1], [0, 1], [0, 0]]] },
        lstMean: 42,
        cellCount: 2,
        shapMean: {},
      },
    ];
    expect(districtAt(detail, [1, 0.5])).toBe('Чиланзарский район');
    expect(districtAt(detail, [5, 0.5])).toBeNull();
  });
});
