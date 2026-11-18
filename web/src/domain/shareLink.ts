import type { LonLat } from './transect';

/** Five decimals: about a metre, finer than a 200 m cell needs, short enough for a link. */
const DIGITS = 5;

/** What a shared link carries on top of the city: the picked place and whether the view is in 3D. */
export interface SharedView {
  place: LonLat | null;
  threeD: boolean;
}

/** `?place=69.24012,41.29871&3d=1` → the place and the 3D flag; anything malformed is ignored, not an error. */
export function readSharedView(search: string): SharedView {
  const params = new URLSearchParams(search);
  const [lon, lat] = (params.get('place') ?? '').split(',').map(Number);
  const place: LonLat | null =
    lon !== undefined && lat !== undefined && Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90
      ? [lon, lat]
      : null;
  return { place, threeD: params.get('3d') === '1' };
}

/** The query string for a view; empty when there is nothing beyond the city, so a plain map keeps a plain address. */
export function sharedViewQuery({ place, threeD }: SharedView): string {
  const params = new URLSearchParams();
  if (place) params.set('place', `${place[0].toFixed(DIGITS)},${place[1].toFixed(DIGITS)}`);
  if (threeD) params.set('3d', '1');
  const query = params.toString().replace('%2C', ',');
  return query ? `?${query}` : '';
}
