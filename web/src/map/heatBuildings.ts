import type { Geometry } from 'geojson';
import { geometryBounds } from '../domain/stats';
import type { LonLat } from '../domain/transect';

/**
 * Temperature class of the surface under a building, by the centre of its box; −1 where the satellite has no reading
 * or the geometry is not an area. Used as feature state on the basemap's own buildings, so the map draws them itself.
 */
export function buildingClass(geometry: Geometry, temperatureAt: (point: LonLat) => number, classOf: (t: number) => number): number {
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return -1;
  const [w, s, e, n] = geometryBounds(geometry);
  const t = temperatureAt([(w + e) / 2, (s + n) / 2]);
  return Number.isFinite(t) ? classOf(t) : -1;
}
