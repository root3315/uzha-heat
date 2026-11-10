import type { MultiPolygon, Polygon, Position } from 'geojson';

export interface OutlinePath {
  /** SVG path data in a box `width` wide, north up. */
  d: string;
  width: number;
  height: number;
}

/**
 * A city outline as a small SVG path, for the loading screen: longitude squeezed by the cosine of
 * the latitude, which at city scale is what the web map shows. Coordinates rounded to whole units.
 */
export function outlinePath(geometry: Polygon | MultiPolygon, width = 1000): OutlinePath {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const points = polygons.flat(2);
  const lons = points.map(([lon = 0]) => lon);
  const lats = points.map(([, lat = 0]) => lat);
  const west = Math.min(...lons);
  const east = Math.max(...lons);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const squeeze = Math.cos((((north + south) / 2) * Math.PI) / 180);
  const scale = width / Math.max((east - west) * squeeze, 1e-9);
  const height = Math.round((north - south) * scale);
  const project = ([lon = 0, lat = 0]: Position) => `${Math.round((lon - west) * squeeze * scale)} ${Math.round((north - lat) * scale)}`;
  const d = polygons
    .flat()
    .map((ring) => `M${ring.map(project).join('L')}Z`)
    .join('');
  return { d, width, height };
}
