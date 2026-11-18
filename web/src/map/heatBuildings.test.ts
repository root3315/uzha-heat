import { describe, expect, it } from 'vitest';
import { buildingClass } from './heatBuildings';

const square = (x: number) => [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]];

describe('buildingClass', () => {
  it('reads the temperature at the centre of the building', () => {
    const at: [number, number][] = [];
    const k = buildingClass({ type: 'Polygon', coordinates: square(0) }, (p) => (at.push(p), 50), (t) => (t > 45 ? 6 : 0));
    expect(k).toBe(6);
    expect(at).toEqual([[0.5, 0.5]]);
  });

  it('is −1 outside the data and for anything that is not an area', () => {
    expect(buildingClass({ type: 'MultiPolygon', coordinates: [square(0)] }, () => Number.NaN, () => 3)).toBe(-1);
    expect(buildingClass({ type: 'Point', coordinates: [0, 0] }, () => 40, () => 3)).toBe(-1);
  });
});
