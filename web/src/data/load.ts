import type { MultiPolygon, Polygon } from 'geojson';
import type { CityDetail, CitySummary } from './contract';
import { parseCities, parseCityDetail } from './parse';

const BASE = import.meta.env.BASE_URL;
const DATA_ROOT = `${BASE}data`;
const BOUNDARY_ROOT = `${BASE}boundaries`;

export class MissingDataError extends Error {
  constructor(path: string) {
    super(`Нет файла ${path}`);
    this.name = 'MissingDataError';
  }
}

async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(`${DATA_ROOT}/${path}`);
  // A dev server answers a missing file with the app's own HTML, so check the type as well as the status.
  const isHtml = response.headers.get('content-type')?.includes('text/html') ?? false;
  if (!response.ok || isHtml) throw new MissingDataError(path);
  return response.json();
}

export async function loadCities(): Promise<CitySummary[]> {
  return parseCities(await fetchJson('cities.json'));
}

export async function loadCity(id: string): Promise<CityDetail> {
  return parseCityDetail(await fetchJson(`${encodeURIComponent(id)}.json`));
}

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

/**
 * The city outline shipped with the app, `public/boundaries/<id>.geojson`.
 * Missing or unreadable: null, and the map is simply not clipped.
 */
export async function loadBoundary(id: string): Promise<Polygon | MultiPolygon | null> {
  try {
    const response = await fetch(`${BOUNDARY_ROOT}/${encodeURIComponent(id)}.geojson`);
    if (!response.ok) return null;
    return boundaryGeometry(await response.json());
  } catch {
    return null;
  }
}
