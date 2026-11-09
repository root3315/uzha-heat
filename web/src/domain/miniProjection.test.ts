import { describe, expect, it } from 'vitest';
import { miniProjection } from './miniProjection';

describe('miniProjection', () => {
  const box: [number, number, number, number] = [69.1, 41.2, 69.5, 41.4];

  it('keeps the box inside the canvas with its margin', () => {
    const p = miniProjection(box, 600, 400, 20);
    for (const [lon, lat] of [
      [69.1, 41.2],
      [69.5, 41.4],
      [69.3, 41.3],
    ] as const) {
      const [x, y] = p.project(lon, lat);
      expect(x).toBeGreaterThanOrEqual(19.9);
      expect(x).toBeLessThanOrEqual(580.1);
      expect(y).toBeGreaterThanOrEqual(19.9);
      expect(y).toBeLessThanOrEqual(p.height - 19.9);
    }
  });

  it('puts north up and east right', () => {
    const p = miniProjection(box, 600, 400);
    const [xw, yn] = p.project(69.1, 41.4);
    const [xe, ys] = p.project(69.5, 41.2);
    expect(xe).toBeGreaterThan(xw);
    expect(ys).toBeGreaterThan(yn);
  });

  it('round-trips through unproject', () => {
    const p = miniProjection(box, 480, 360);
    const [x, y] = p.project(69.31, 41.27);
    const [lon, lat] = p.unproject(x, y);
    expect(lon).toBeCloseTo(69.31, 6);
    expect(lat).toBeCloseTo(41.27, 6);
  });

  it('keeps the shape: a degree of longitude is shorter than a degree of latitude', () => {
    const p = miniProjection(box, 1000, 1000, 0);
    const [x0, y0] = p.project(69.1, 41.2);
    const [x1] = p.project(69.2, 41.2);
    const [, y1] = p.project(69.1, 41.3);
    expect(x1 - x0).toBeLessThan(y0 - y1);
    expect((x1 - x0) / (y0 - y1)).toBeCloseTo(Math.cos((41.3 * Math.PI) / 180), 2);
  });
});
