import { describe, expect, it } from 'vitest';
import type { CityDetail } from '../data/contract';
import { cellsInDistrict } from './places';

const square = (x0: number, y0: number, x1: number, y1: number): [number, number][][] => [
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]],
];

function cityWithDistricts(): CityDetail {
  return {
    city: { id: 't', name: 'T', nameEn: 'T', country: 'X', center: [0.5, 0.5], bbox: [0, 0, 2, 1], lstMean: 40, r2: 0.5 },
    period: { label: '', lstScenes: 1, s2Scenes: 1 },
    grid: { cellSizeM: 200, halfSizeDeg: [0.001, 0.001], count: 4 },
    features: [],
    model: { type: 'm', r2Cv: 0.5, maeCv: 1, cv: 'cv', baseValue: 40 },
    stats: { lstMean: 40, lstMin: 38, lstMax: 42, lstP10: 39, lstP90: 41 },
    globalImportance: [],
    cells: { lon: [0.2, 0.8, 1.2, 1.8], lat: [0.5, 0.5, 0.5, 0.5], lst: [40, 41, 39, 42], values: {}, shap: {} },
    districts: [
      { name: 'West', geometry: { type: 'Polygon', coordinates: square(0, 0, 1, 1) }, lstMean: 40, cellCount: 2, shapMean: {} },
      {
        name: 'East',
        geometry: { type: 'MultiPolygon', coordinates: [square(1, 0, 1.5, 1), square(1.7, 0, 2, 1)] },
        lstMean: 40,
        cellCount: 2,
        shapMean: {},
      },
    ],
  };
}

describe('cellsInDistrict', () => {
  it('assigns cells to the polygons that contain them', () => {
    const detail = cityWithDistricts();
    expect(cellsInDistrict(detail, 0)).toEqual([0, 1]);
    expect(cellsInDistrict(detail, 1)).toEqual([2, 3]);
  });

  it('returns the same membership on repeated calls and nothing for unknown districts', () => {
    const detail = cityWithDistricts();
    expect(cellsInDistrict(detail, 0)).toBe(cellsInDistrict(detail, 0));
    expect(cellsInDistrict(detail, 5)).toEqual([]);
  });
});
