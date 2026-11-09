import type { LonLat } from './transect';
import { distanceM, distanceToLineM } from './placeName';
import { pointInGeometry, type AreaGeometry } from './stats';

/** Places where the heat is the pavement itself and street trees are not an option. */
export type SiteKind = 'airport' | 'rail';

export interface Site {
  kind: SiteKind;
  /** The airport's name from the basemap, when it has one. */
  name: string | null;
}

/** A basemap feature, already reduced to what the check needs. Layers follow OpenMapTiles. */
export type SiteFeature =
  | { layer: 'aeroway' | 'landuse'; cls: string; area: AreaGeometry }
  | { layer: 'transportation'; cls: string; service: string | null; line: LonLat[] }
  | { layer: 'aerodrome_label'; name: string; point: LonLat };

const AIRFIELD = new Set(['aerodrome', 'runway', 'taxiway', 'apron', 'heliport', 'helipad']);
/** A yard is a field of tracks; one passing line is not a site. */
const YARD_SERVICES = new Set(['yard', 'siding', 'spur']);
const YARD_RADIUS_M = 120;
const YARD_MIN_TRACKS = 3;
const AIRPORT_NAME_RADIUS_M = 4000;

/** Is the point on an airfield or a rail yard? From the basemap features around it, no lookup service. */
export function siteAt(point: LonLat, features: readonly SiteFeature[]): Site | null {
  const onAirfield = features.some((f) => f.layer === 'aeroway' && AIRFIELD.has(f.cls) && pointInGeometry(point, f.area));
  if (onAirfield) {
    let name: string | null = null;
    let best = AIRPORT_NAME_RADIUS_M;
    for (const f of features) {
      if (f.layer !== 'aerodrome_label') continue;
      const d = distanceM(point, f.point);
      if (d <= best) {
        best = d;
        name = f.name;
      }
    }
    return { kind: 'airport', name };
  }
  const onRailLand = features.some((f) => f.layer === 'landuse' && f.cls === 'railway' && pointInGeometry(point, f.area));
  const yardTracks = features.filter(
    (f) => f.layer === 'transportation' && f.cls === 'rail' && f.service !== null && YARD_SERVICES.has(f.service) && distanceToLineM(point, f.line) <= YARD_RADIUS_M,
  ).length;
  return onRailLand || yardTracks >= YARD_MIN_TRACKS ? { kind: 'rail', name: null } : null;
}

/** "Аэродром: Ташкент", "Железнодорожные пути и станция". */
export function siteTitle(site: Site): string {
  if (site.kind === 'airport') return site.name ? `Аэродром: ${site.name}` : 'Аэродром';
  return 'Железнодорожные пути и станция';
}

/** Why the usual advice does not apply here, in one plain sentence. */
export function siteNote(site: Site): string {
  return site.kind === 'airport'
    ? 'Это аэродром: жара идёт от полос и перронов, деревья на них не сажают. Для города это не мера, а фон.'
    : 'Это железнодорожные пути: жара идёт от щебня и рельсов, деревья вдоль путей не сажают. Для города это не мера, а фон.';
}
