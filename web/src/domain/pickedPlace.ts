import { PRECISION, type FoundName, type NamePrecision } from './placeName';
import type { Site } from './sites';
import type { LonLat } from './transect';

/** The place open in the panel. */
export interface PickedPlace {
  cell: number;
  /** Centre of the cell, where the dot goes. */
  point: LonLat;
  /** Where the reader picked it, which the site is looked up under. */
  at: LonLat;
  title: string;
  precision: NamePrecision;
  site: Site | null;
  /** The site was looked up with the basemap settled; until then a null may only mean it was not drawn yet. */
  siteSettled: boolean;
}

/** What the basemap knows now, asked only when needed. */
export interface PlaceLookup {
  name(): FoundName | null;
  site(): Site | null;
}

/**
 * The place again once the basemap has settled: a closer name than at the first look, and the site (an airfield,
 * a rail yard) the first look could miss, as for a place opened from a link before the basemap was ready.
 * The same object when nothing changed, so React skips the render.
 */
export function refinePlace(current: PickedPlace, lookup: PlaceLookup): PickedPlace {
  const found = current.precision === PRECISION.place ? null : lookup.name();
  const closer = found && found.precision > current.precision ? found : null;
  if (!closer && current.siteSettled) return current;
  const site = current.siteSettled ? current.site : (current.site ?? lookup.site());
  return { ...current, site, siteSettled: true, ...(closer ? { title: closer.name, precision: closer.precision } : {}) };
}
