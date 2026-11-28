import { DEFAULT_LOCALE, isLocale, type Locale } from '../i18n/locale';
import type { LonLat } from './transect';

/** Five decimals: about a metre, finer than a 200 m cell needs, short enough for a link. */
const DIGITS = 5;
const LANG = 'lang';
const GROUND = 'ground';

/** What lies under the temperature: the drawn map, the satellite photo, or the land cover. */
export type Ground = 'map' | 'satellite' | 'cover';
const GROUNDS: readonly Ground[] = ['map', 'satellite', 'cover'];
const isGround = (value: string | null): value is Ground => GROUNDS.includes(value as Ground);

/** What a shared link carries on top of the city: the picked place, 3D, the ground under the map, and the language. */
export interface SharedView {
  place: LonLat | null;
  threeD: boolean;
  ground: Ground;
  /** Null when the link does not say; the default language then leaves no trace in it. */
  locale: Locale | null;
}

/** `?place=69.24012,41.29871&3d=1&ground=satellite&lang=ru` → the view; anything malformed is ignored, not an error. */
export function readSharedView(search: string): SharedView {
  const params = new URLSearchParams(search);
  const [lon, lat] = (params.get('place') ?? '').split(',').map(Number);
  const place: LonLat | null =
    lon !== undefined && lat !== undefined && Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90
      ? [lon, lat]
      : null;
  const lang = params.get(LANG);
  const ground = params.get(GROUND);
  return { place, threeD: params.get('3d') === '1', ground: isGround(ground) ? ground : 'map', locale: isLocale(lang) ? lang : null };
}

/** The query string for a view; empty when there is nothing beyond the city, so a plain map keeps a plain address. */
export function sharedViewQuery({ place, threeD, ground, locale }: SharedView): string {
  const params = new URLSearchParams();
  if (place) params.set('place', `${place[0].toFixed(DIGITS)},${place[1].toFixed(DIGITS)}`);
  if (threeD) params.set('3d', '1');
  if (ground !== 'map') params.set(GROUND, ground);
  if (locale && locale !== DEFAULT_LOCALE) params.set(LANG, locale);
  const query = params.toString().replace('%2C', ',');
  return query ? `?${query}` : '';
}

/** Any query string with the language set in it, everything else kept: `lang=ru`, or no `lang` for the default. */
export function withLocale(search: string, locale: Locale): string {
  const params = new URLSearchParams(search);
  if (locale === DEFAULT_LOCALE) params.delete(LANG);
  else params.set(LANG, locale);
  const query = params.toString().replace('%2C', ',');
  return query ? `?${query}` : '';
}
