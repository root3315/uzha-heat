import type { Feature, FeatureCollection, Polygon } from 'geojson';
import type { LonLat } from '../domain/transect';
import { buildingClass } from './heatBuildings';

/** One view's worth of buildings: enough for a dense quarter in 3D, few enough to stay smooth on a phone. */
export const MAX_BUILDINGS = 25000;
/** Half the side of the square read around the view centre, m. A tilted view reaches the horizon; far buildings are a
 * few pixels high there and would only cost downloads. */
export const MAX_HALF_SPAN_M = 2500;
const METRES_PER_DEGREE = 111_320;
/** The first bytes of every FlatGeobuf file: "fgb", 3, then the minor version. */
const MAGIC = [0x66, 0x67, 0x62, 3];

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** What the file stores per building: height, m; confidence, 0–1; source, 0 tagged in OSM, 1 modelled. */
export interface BuildingProps {
  h: number;
  conf: number;
  src: number;
}

export type BuildingFeature = Feature<Polygon, BuildingProps & { k: number }>;

export const buildingsUrl = (base: string, cityId: string): string => `${base}data/buildings/${cityId}.fgb`;

/** True for the start of a FlatGeobuf file; a missing file comes back as the app's HTML or a 404 page. */
export function isFlatGeobuf(bytes: Uint8Array): boolean {
  return MAGIC.every((byte, i) => bytes[i] === byte);
}

/** The part of the view to read: its bounds, cut to a square of `halfSpanM` around the centre. */
export function viewRect(bounds: [number, number, number, number], center: LonLat, halfSpanM = MAX_HALF_SPAN_M): Rect {
  const [w, s, e, n] = bounds;
  const [lon, lat] = center;
  const dLat = halfSpanM / METRES_PER_DEGREE;
  const dLon = dLat / Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  return { minX: Math.max(w, lon - dLon), minY: Math.max(s, lat - dLat), maxX: Math.min(e, lon + dLon), maxY: Math.min(n, lat + dLat) };
}

/** True when `inner` lies inside `outer`: the buildings already loaded cover the new view, nothing to read. */
export function covers(outer: Rect | null, inner: Rect): boolean {
  return outer !== null && outer.minX <= inner.minX && outer.minY <= inner.minY && outer.maxX >= inner.maxX && outer.maxY >= inner.maxY;
}

/** A building with its temperature class `k`, read under its centre like the basemap's buildings. */
export function classify(feature: Feature, temperatureAt: (point: LonLat) => number, classOf: (t: number) => number): BuildingFeature | null {
  if (feature.geometry?.type !== 'Polygon') return null;
  const props = (feature.properties ?? {}) as Partial<BuildingProps>;
  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: { h: props.h ?? 0, conf: props.conf ?? 0, src: props.src ?? 1, k: buildingClass(feature.geometry, temperatureAt, classOf) },
  };
}

/**
 * Collect features from a stream until it ends, `max` are in, or the signal aborts; leaving the loop early closes the
 * generator, so no further range requests go out. Null when aborted: the result belongs to a view already left.
 */
export async function collect<T>(features: AsyncIterable<Feature>, toFeature: (f: Feature) => T | null, max: number, signal: AbortSignal): Promise<T[] | null> {
  const out: T[] = [];
  for await (const feature of features) {
    if (signal.aborted) return null;
    const item = toFeature(feature);
    if (item) out.push(item);
    if (out.length >= max) break;
  }
  return signal.aborted ? null : out;
}

export const collection = (features: BuildingFeature[]): FeatureCollection<Polygon, BuildingFeature['properties']> => ({ type: 'FeatureCollection', features });
