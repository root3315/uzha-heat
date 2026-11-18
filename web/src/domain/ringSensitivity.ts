import type { LonLat } from '../data/contract';
import { heatIslandIntensity, type HeatIsland } from './heatIsland';
import type { AreaGeometry } from './stats';

const M_PER_DEG_LAT = 111_320;

/** Every edge of the outline, as pairs of points. */
function outlineEdges(outline: AreaGeometry): [LonLat, LonLat][] {
  const polygons = outline.type === 'Polygon' ? [outline.coordinates] : outline.coordinates;
  return polygons.flatMap((rings) =>
    rings.flatMap((ring) => ring.slice(1).map((point, i) => [ring[i] as LonLat, point as LonLat] as [LonLat, LonLat])),
  );
}

/** Distance from a point to the nearest edge of the outline, metres (local flat approximation, fine at city scale). */
export function distanceToOutlineM(point: LonLat, edges: readonly [LonLat, LonLat][]): number {
  const kx = M_PER_DEG_LAT * Math.cos((point[1] * Math.PI) / 180);
  let best = Infinity;
  for (const [a, b] of edges) {
    const ax = (a[0] - point[0]) * kx;
    const ay = (a[1] - point[1]) * M_PER_DEG_LAT;
    const dx = (b[0] - a[0]) * kx;
    const dy = (b[1] - a[1]) * M_PER_DEG_LAT;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

export interface RingIsland {
  /** Outer edge of the ring, metres from the outline. */
  widthM: number;
  island: HeatIsland | null;
}

/**
 * The heat island against rings of different width around the outline: the same median inside minus median outside,
 * with only the outside cells closer than each width. If the sign and size hold, the number is not an artefact of one ring.
 */
export function islandByRingWidth(
  lst: readonly number[],
  lon: readonly number[],
  lat: readonly number[],
  inside: readonly boolean[],
  outline: AreaGeometry,
  widthsM: readonly number[],
): RingIsland[] {
  const edges = outlineEdges(outline);
  const distance = lst.map((_, i) => (inside[i] ? 0 : distanceToOutlineM([lon[i] ?? 0, lat[i] ?? 0], edges)));
  return widthsM.map((widthM) => {
    const keep = lst.map((_, i) => inside[i] || (distance[i] ?? Infinity) <= widthM);
    const values = lst.map((t, i) => (keep[i] ? t : Number.NaN));
    return { widthM, island: heatIslandIntensity(values, inside) };
  });
}

/** Spread of the island across the rings, °C: small means the choice of ring hardly matters. */
export function ringSpread(rings: readonly RingIsland[]): number | null {
  const values = rings.flatMap((r) => (r.island ? [r.island.intensity] : []));
  return values.length > 1 ? Math.max(...values) - Math.min(...values) : null;
}
