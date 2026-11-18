import { DEFAULT_LOCALE, isLocale, type Locale } from '../i18n/locale';
import type { LonLat } from './transect';

/** Five decimals: about a metre, finer than a 200 m cell needs, short enough for a link. */
const DIGITS = 5;
const LANG = 'lang';

/** What a shared link carries on top of the city: the picked place, whether the view is in 3D, and the language. */
export interface SharedView {
  place: LonLat | null;
  threeD: boolean;
  /** Null when the link does not say; the default language then leaves no trace in it. */
  locale: Locale | null;
}

/** `?place=69.24012,41.29871&3d=1&lang=ru` → the place, the 3D flag and the language; anything malformed is ignored, not an error. */
export function readSharedView(search: string): SharedView {
  const params = new URLSearchParams(search);
  const [lon, lat] = (params.get('place') ?? '').split(',').map(Number);
  const place: LonLat | null =
    lon !== undefined && lat !== undefined && Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90
      ? [lon, lat]
      : null;
  const lang = params.get(LANG);
  return { place, threeD: params.get('3d') === '1', locale: isLocale(lang) ? lang : null };
}

/** The query string for a view; empty when there is nothing beyond the city, so a plain map keeps a plain address. */
export function sharedViewQuery({ place, threeD, locale }: SharedView): string {
  const params = new URLSearchParams();
  if (place) params.set('place', `${place[0].toFixed(DIGITS)},${place[1].toFixed(DIGITS)}`);
  if (threeD) params.set('3d', '1');
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
