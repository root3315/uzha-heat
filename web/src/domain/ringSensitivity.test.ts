import { describe, expect, it } from 'vitest';
import type { AreaGeometry } from './stats';
import { distanceToOutlineM, islandByRingWidth, ringSpread } from './ringSensitivity';

/** A square city 0.02° across at the equator (≈2.2 km), and cells marching east from its middle. */
const square: AreaGeometry = { type: 'Polygon', coordinates: [[[0, 0], [0.02, 0], [0.02, 0.02], [0, 0.02], [0, 0]]] };

describe('distanceToOutlineM', () => {
  it('measures to the nearest edge in metres', () => {
    const edges: [[number, number], [number, number]][] = [[[0.02, 0], [0.02, 0.02]]];
    expect(distanceToOutlineM([0.03, 0.01], edges)).toBeCloseTo(1113, -1);
  });
});

describe('islandByRingWidth', () => {
  it('keeps only ring cells within each width', () => {
    // Inside: 50, 50, 50. Outside at ≈0.55, 1.1 and 2.2 km: 40, 44, 30.
    const lon = [0.005, 0.01, 0.015, 0.025, 0.03, 0.04];
    const lat = lon.map(() => 0.01);
    const lst = [50, 50, 50, 40, 44, 30];
    const inside = [true, true, true, false, false, false];
    // MIN_CELLS in heatIslandIntensity is 30: repeat everything so both sides are large enough.
    const rep = <T,>(xs: T[]) => Array.from({ length: 40 }, () => xs).flat();
    const rings = islandByRingWidth(rep(lst), rep(lon), rep(lat), rep(inside), square, [600, 1200, 2500]);
    expect(rings.map((r) => r.island?.intensity)).toEqual([10, 8, 10]);
    expect(ringSpread(rings)).toBe(2);
  });
});
