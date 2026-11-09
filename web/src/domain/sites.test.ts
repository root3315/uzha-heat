import { describe, expect, it } from 'vitest';
import { siteAt, siteTitle, type SiteFeature } from './sites';

const box = (w: number, s: number, e: number, n: number) => ({
  type: 'Polygon' as const,
  coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
});

describe('siteAt', () => {
  it('finds an airfield and the nearest airport name', () => {
    const features: SiteFeature[] = [
      { layer: 'aeroway', cls: 'runway', area: box(69.26, 41.25, 69.28, 41.26) },
      { layer: 'aerodrome_label', name: 'Ташкент', point: [69.27, 41.257] },
    ];
    const site = siteAt([69.27, 41.255], features);
    expect(site).toEqual({ kind: 'airport', name: 'Ташкент' });
    expect(siteTitle(site!)).toBe('Аэродром: Ташкент');
  });

  it('finds a rail yard by its land use or by several yard tracks', () => {
    expect(siteAt([69.3, 41.3], [{ layer: 'landuse', cls: 'railway', area: box(69.29, 41.29, 69.31, 41.31) }])).toEqual({ kind: 'rail', name: null });
    const track = (dy: number): SiteFeature => ({ layer: 'transportation', cls: 'rail', service: 'yard', line: [[69.29, 41.3 + dy], [69.31, 41.3 + dy]] });
    expect(siteAt([69.3, 41.3], [track(0), track(0.0002), track(0.0004)])?.kind).toBe('rail');
  });

  it('ignores a single main line and ordinary land', () => {
    const main: SiteFeature = { layer: 'transportation', cls: 'rail', service: null, line: [[69.29, 41.3], [69.31, 41.3]] };
    expect(siteAt([69.3, 41.3], [main, { layer: 'landuse', cls: 'residential', area: box(69.29, 41.29, 69.31, 41.31) }])).toBeNull();
  });
});
