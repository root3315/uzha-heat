import { describe, expect, it } from 'vitest';
import { heatBuildings } from './heatBuildings';

const square = (x: number) => [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]];

describe('heatBuildings', () => {
  it('colours each building by the temperature at its centre and keeps its height', () => {
    const out = heatBuildings(
      [
        { geometry: { type: 'Polygon', coordinates: square(0) }, properties: { render_height: 30, render_min_height: 3 } },
        { geometry: { type: 'Polygon', coordinates: square(10) }, properties: {} },
      ],
      ([x]) => (x < 5 ? 50 : Number.NaN),
      (t) => (t > 45 ? 6 : 0),
    );
    expect(out.features.map((f) => f.properties)).toEqual([
      { h: 30, base: 3, k: 6 },
      { h: 6, base: 0, k: -1 },
    ]);
  });

  it('splits a multipolygon into buildings and skips other geometry', () => {
    const out = heatBuildings(
      [
        { geometry: { type: 'MultiPolygon', coordinates: [square(0), square(2)] }, properties: null },
        { geometry: { type: 'Point', coordinates: [0, 0] }, properties: null },
      ],
      () => 40,
      () => 2,
    );
    expect(out.features).toHaveLength(2);
  });
});
