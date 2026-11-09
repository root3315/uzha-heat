import { describe, expect, it } from 'vitest';
import type { CityDetail } from '../data/contract';
import { cellsToCsv, cellsToGeoJson } from './exportCells';

const detail = {
  features: [
    { key: 'ndvi', label: 'Растительность', unit: 'NDVI', description: '' },
    { key: 'built', label: 'Застройка', unit: '% площади', description: '' },
  ],
  cells: {
    lon: [69.1234567, 69.2],
    lat: [41.3, 41.3000001],
    lst: [47.256, Number.NaN],
    values: { ndvi: [0.12345, 0.4], built: [80, 10] },
    shap: { ndvi: [2.0004, -1.5], built: [0.5, -0.25] },
  },
} as unknown as CityDetail;

describe('cellsToCsv', () => {
  it('writes a header and one rounded row per cell, blank for a missing reading', () => {
    expect(cellsToCsv(detail, [true, false]).split('\n')).toEqual([
      'lon,lat,lst,inside,ndvi,built,shap_ndvi,shap_built',
      '69.123457,41.3,47.26,1,0.1235,80,2,0.5',
      '69.2,41.3,,0,0.4,10,-1.5,-0.25',
      '',
    ]);
  });
});

describe('cellsToGeoJson', () => {
  it('writes points with every column as a property', () => {
    const collection = JSON.parse(cellsToGeoJson(detail, [true, false]));
    expect(collection.type).toBe('FeatureCollection');
    expect(collection.features).toHaveLength(2);
    expect(collection.features[0]).toEqual({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [69.123457, 41.3] },
      properties: { lst: 47.26, inside: true, ndvi: 0.1235, built: 80, shap_ndvi: 2, shap_built: 0.5 },
    });
    expect(collection.features[1].properties.lst).toBeNull();
  });
});
