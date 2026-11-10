import { describe, expect, it } from 'vitest';
import { outlinePath } from './outlinePath';

describe('outlinePath', () => {
  it('fits the outline to the width, north up, with longitude squeezed by latitude', () => {
    const square = { type: 'Polygon' as const, coordinates: [[[69, 41], [70, 41], [70, 42], [69, 42], [69, 41]]] };
    const path = outlinePath(square, 100);
    expect(path.width).toBe(100);
    // One degree of latitude is longer than one of longitude at 41.5°N.
    expect(path.height).toBe(Math.round(100 / Math.cos((41.5 * Math.PI) / 180)));
    expect(path.d.startsWith('M0 ')).toBe(true);
    expect(path.d).toContain(`L100 ${path.height}`);
    expect(path.d.endsWith('Z')).toBe(true);
  });

  it('draws every ring of a MultiPolygon', () => {
    const ring = [[0, 0], [1, 0], [1, 1], [0, 0]];
    const path = outlinePath({ type: 'MultiPolygon', coordinates: [[ring], [ring.map(([x = 0, y = 0]) => [x + 2, y])]] });
    expect(path.d.match(/M/g)).toHaveLength(2);
  });
});
