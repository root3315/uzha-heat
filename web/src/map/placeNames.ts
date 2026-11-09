import type { Map as MapLibreMap } from 'maplibre-gl';
import { placeName, type FoundName, type NamedLine, type NamedPoint } from '../domain/placeName';
import { siteAt, type Site, type SiteFeature } from '../domain/sites';
import type { AreaGeometry } from '../domain/stats';
import type { LonLat } from '../domain/transect';
import { SOURCE } from './style';

/** Parts of a city that people name a place by; the city itself and countries are too coarse. */
const PLACE_CLASSES = new Set(['suburb', 'quarter', 'neighbourhood', 'village', 'hamlet', 'isolated_dwelling']);

function nameOf(feature: { properties: Record<string, unknown> }): string | null {
  const props = feature.properties;
  const name = props['name:ru'] ?? props.name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

function namedPoints(map: MapLibreMap): NamedPoint[] {
  return map.querySourceFeatures(SOURCE.basemap, { sourceLayer: 'place' }).flatMap((feature) => {
    const name = nameOf(feature);
    const cls = feature.properties.class;
    if (!name || typeof cls !== 'string' || !PLACE_CLASSES.has(cls) || feature.geometry.type !== 'Point') return [];
    const [lon = 0, lat = 0] = feature.geometry.coordinates;
    return [{ name, point: [lon, lat] as LonLat }];
  });
}

function namedStreets(map: MapLibreMap): NamedLine[] {
  return map.querySourceFeatures(SOURCE.basemap, { sourceLayer: 'transportation_name' }).flatMap((feature) => {
    const name = nameOf(feature);
    if (!name) return [];
    const { geometry } = feature;
    if (geometry.type === 'LineString') return [{ name, line: geometry.coordinates as LonLat[] }];
    if (geometry.type === 'MultiLineString') return geometry.coordinates.map((line) => ({ name, line: line as LonLat[] }));
    return [];
  });
}

/** Nearest name the basemap has already loaded around the point, else the district; null when neither. */
export function nameFromBasemap(map: MapLibreMap, point: LonLat, district: string | null): FoundName | null {
  if (!map.getSource(SOURCE.basemap)) return placeName(point, [], [], district);
  return placeName(point, namedPoints(map), namedStreets(map), district);
}

function areaOf(geometry: GeoJSON.Geometry): AreaGeometry | null {
  return geometry.type === 'Polygon' || geometry.type === 'MultiPolygon' ? (geometry as AreaGeometry) : null;
}

function linesOf(geometry: GeoJSON.Geometry): LonLat[][] {
  if (geometry.type === 'LineString') return [geometry.coordinates as LonLat[]];
  if (geometry.type === 'MultiLineString') return geometry.coordinates as LonLat[][];
  return [];
}

/** Airfields and rail yards the basemap has loaded around the point; null when it is neither, or tiles are not in. */
export function siteFromBasemap(map: MapLibreMap, point: LonLat): Site | null {
  if (!map.getSource(SOURCE.basemap)) return null;
  const query = (sourceLayer: string) => map.querySourceFeatures(SOURCE.basemap, { sourceLayer });
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  const features: SiteFeature[] = [];
  for (const layer of ['aeroway', 'landuse'] as const) {
    for (const f of query(layer)) {
      const area = areaOf(f.geometry);
      const cls = text(f.properties.class);
      if (area && cls) features.push({ layer, cls, area });
    }
  }
  for (const f of query('transportation')) {
    if (f.properties.class !== 'rail') continue;
    for (const line of linesOf(f.geometry)) features.push({ layer: 'transportation', cls: 'rail', service: text(f.properties.service), line });
  }
  for (const f of query('aerodrome_label')) {
    const name = nameOf(f);
    if (name && f.geometry.type === 'Point') features.push({ layer: 'aerodrome_label', name, point: f.geometry.coordinates as LonLat });
  }
  return siteAt(point, features);
}
