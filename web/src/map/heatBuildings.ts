import type { Feature, FeatureCollection, Geometry, Polygon } from 'geojson';
import type { LonLat } from '../domain/transect';

export interface HeatBuildingProperties {
  /** Top and bottom of the building, metres. */
  h: number;
  base: number;
  /** Temperature class of the surface under it; −1 where the satellite has no reading. */
  k: number;
}

/** Height when the basemap gives none: one or two storeys, what most of these cities are made of. */
const DEFAULT_HEIGHT_M = 6;

/** Centre of the outer ring's box: cheap, and inside the building for the blocky shapes cities are made of. */
function centreOf(polygon: Polygon['coordinates']): LonLat | null {
  const ring = polygon[0];
  if (!ring || ring.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x = 0, y = 0] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

const numberOr = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/**
 * Basemap buildings coloured by the surface temperature under each of them: the city as a 3D heat model.
 * Each polygon (or part of a multipolygon) is one building; `temperatureAt` gives NaN outside the data.
 */
export function heatBuildings(
  buildings: ReadonlyArray<{ geometry: Geometry; properties: Record<string, unknown> | null }>,
  temperatureAt: (point: LonLat) => number,
  classOf: (t: number) => number,
): FeatureCollection<Polygon, HeatBuildingProperties> {
  const features: Feature<Polygon, HeatBuildingProperties>[] = [];
  for (const { geometry, properties } of buildings) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
    const h = numberOr(properties?.render_height, DEFAULT_HEIGHT_M);
    const base = numberOr(properties?.render_min_height, 0);
    for (const coordinates of polygons) {
      const centre = centreOf(coordinates);
      if (!centre) continue;
      const t = temperatureAt(centre);
      features.push({ type: 'Feature', properties: { h, base, k: Number.isFinite(t) ? classOf(t) : -1 }, geometry: { type: 'Polygon', coordinates } });
    }
  }
  return { type: 'FeatureCollection', features };
}
