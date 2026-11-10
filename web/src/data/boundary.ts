import type { MultiPolygon, Polygon } from 'geojson';

function isArea(value: unknown): value is Polygon | MultiPolygon {
  if (typeof value !== 'object' || value === null) return false;
  const { type, coordinates } = value as { type?: unknown; coordinates?: unknown };
  return (type === 'Polygon' || type === 'MultiPolygon') && Array.isArray(coordinates) && coordinates.length > 0;
}

/** First (Multi)Polygon in a GeoJSON geometry, Feature or FeatureCollection. */
export function boundaryGeometry(raw: unknown): Polygon | MultiPolygon | null {
  if (isArea(raw)) return raw;
  if (typeof raw !== 'object' || raw === null) return null;
  const { geometry, features } = raw as { geometry?: unknown; features?: unknown };
  if (isArea(geometry)) return geometry;
  if (Array.isArray(features)) {
    for (const feature of features) {
      const found = boundaryGeometry(feature);
      if (found) return found;
    }
  }
  return null;
}
