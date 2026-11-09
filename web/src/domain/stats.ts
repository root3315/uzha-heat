import type { LonLat } from '../data/contract';

export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export function meanAt(values: readonly number[], indices: readonly number[]): number {
  if (indices.length === 0) return Number.NaN;
  let sum = 0;
  for (const i of indices) sum += values[i] ?? 0;
  return sum / indices.length;
}

export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (pos - lo);
}

type Ring = ReadonlyArray<ReadonlyArray<number>>;

/** Polygon or MultiPolygon, from the data contract or from GeoJSON. */
export type AreaGeometry = { type: 'Polygon'; coordinates: ReadonlyArray<Ring> } | { type: 'MultiPolygon'; coordinates: ReadonlyArray<ReadonlyArray<Ring>> };

function pointInRing([x, y]: LonLat, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]?.[0] ?? 0;
    const yi = ring[i]?.[1] ?? 0;
    const xj = ring[j]?.[0] ?? 0;
    const yj = ring[j]?.[1] ?? 0;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInPolygonRings(point: LonLat, rings: ReadonlyArray<Ring>): boolean {
  const [outer, ...holes] = rings;
  if (!outer || !pointInRing(point, outer)) return false;
  return !holes.some((hole) => pointInRing(point, hole));
}

export function pointInGeometry(point: LonLat, geometry: AreaGeometry): boolean {
  if (geometry.type === 'Polygon') return pointInPolygonRings(point, geometry.coordinates);
  return geometry.coordinates.some((polygon) => pointInPolygonRings(point, polygon));
}

export function geometryBounds(geometry: AreaGeometry): [number, number, number, number] {
  const rings: Ring[] = geometry.type === 'Polygon' ? [...geometry.coordinates] : geometry.coordinates.flatMap((polygon) => [...polygon]);
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) {
    for (const [x = 0, y = 0] of ring) {
      w = Math.min(w, x);
      s = Math.min(s, y);
      e = Math.max(e, x);
      n = Math.max(n, y);
    }
  }
  return [w, s, e, n];
}
