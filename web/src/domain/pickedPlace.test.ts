import { describe, expect, it, vi } from 'vitest';
import { refinePlace, type PickedPlace } from './pickedPlace';
import { PRECISION } from './placeName';

const place = (over: Partial<PickedPlace> = {}): PickedPlace => ({
  cell: 7,
  point: [69.2, 41.3],
  at: [69.201, 41.301],
  title: 'Chilonzor',
  precision: PRECISION.district,
  site: null,
  siteSettled: false,
  ...over,
});

const airfield = { kind: 'airport', name: 'Tashkent' } as const;

describe('refinePlace', () => {
  it('finds the site of a place opened before the basemap was ready', () => {
    const refined = refinePlace(place(), { name: () => null, site: () => airfield });
    expect(refined).toMatchObject({ site: airfield, siteSettled: true, title: 'Chilonzor' });
  });

  it('looks the site up even when the name is already as close as it gets', () => {
    const refined = refinePlace(place({ precision: PRECISION.place }), { name: () => null, site: () => airfield });
    expect(refined.site).toEqual(airfield);
  });

  it('asks for the site once, then only refines the name', () => {
    const site = vi.fn(() => null);
    const first = refinePlace(place(), { name: () => null, site });
    const again = refinePlace(first, { name: () => ({ name: 'Bunyodkor ko‘chasi', precision: PRECISION.street }), site });
    expect(site).toHaveBeenCalledTimes(1);
    expect(again).toMatchObject({ title: 'Bunyodkor ko‘chasi', precision: PRECISION.street, site: null });
  });

  it('keeps a site found at the click without asking again', () => {
    const site = vi.fn(() => null);
    expect(refinePlace(place({ site: airfield }), { name: () => null, site }).site).toEqual(airfield);
    expect(site).not.toHaveBeenCalled();
  });

  it('returns the same place when nothing new is known', () => {
    const current = place({ siteSettled: true });
    expect(refinePlace(current, { name: () => ({ name: 'Chilonzor', precision: PRECISION.district }), site: () => null })).toBe(current);
  });
});
