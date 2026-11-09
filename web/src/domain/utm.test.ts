import { describe, expect, it } from 'vitest';
import { fromUtm, toUtm, utmZone } from './utm';

describe('utm', () => {
  it('picks the zone from longitude', () => {
    expect(utmZone(69.28)).toBe(42);
    expect(utmZone(66.97)).toBe(42);
    expect(utmZone(60.6)).toBe(41);
  });

  it('puts the central meridian on the false easting', () => {
    const [x] = toUtm(69, 41.3, 42);
    expect(x).toBeCloseTo(500000, 3);
  });

  it('round-trips a point to well under a centimetre', () => {
    const [x, y] = toUtm(69.2797, 41.3111, 42);
    const [lon, lat] = fromUtm(x, y, 42);
    expect(lon).toBeCloseTo(69.2797, 7);
    expect(lat).toBeCloseTo(41.3111, 7);
  });

  it('keeps 200 m between points 200 m apart', () => {
    const [x, y] = toUtm(69.25, 41.3, 42);
    const [lon, lat] = fromUtm(x + 200, y, 42);
    const [x2, y2] = toUtm(lon, lat, 42);
    expect(Math.hypot(x2 - x, y2 - y)).toBeCloseTo(200, 3);
  });
});
