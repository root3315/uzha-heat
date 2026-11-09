import { blur2 } from 'd3-array';
import { contours } from 'd3-contour';
import type { Feature, FeatureCollection, MultiPolygon } from 'geojson';
import { upsample } from './field';
import { slotToLonLat, type CellGrid } from './grid';

export interface CauseAreaProperties {
  key: string;
}

export interface CauseAreaOptions {
  /** Cells where the top cause adds less than this, °C, are left unmarked. */
  minContribution?: number;
  factor?: number;
  blur?: number;
}

/**
 * Areas where one factor is what heats the cells most, one MultiPolygon per factor.
 * `dominant[i]` is the top heating factor of cell i (or null) and `strength[i]` its °C.
 */
export function causeAreas(
  grid: CellGrid,
  dominant: readonly (string | null)[],
  strength: readonly number[],
  { minContribution = 0.5, factor = 2, blur = 1 }: CauseAreaOptions = {},
): FeatureCollection<MultiPolygon, CauseAreaProperties> {
  const keys = [...new Set(dominant.filter((k): k is string => k !== null))];
  const { nx, ny } = grid;
  const fx = nx * factor;
  const fy = ny * factor;
  const generator = contours().size([fx, fy]).thresholds([0.5]);
  const features: Feature<MultiPolygon, CauseAreaProperties>[] = [];
  for (const key of keys) {
    const mask = new Float32Array(nx * ny);
    grid.index.forEach((cell, slot) => {
      if (cell >= 0 && dominant[cell] === key && (strength[cell] ?? 0) >= minContribution) mask[slot] = 1;
    });
    const fine = upsample(mask, nx, ny, factor);
    if (blur > 0) blur2({ data: fine, width: fx, height: fy }, blur);
    const [area] = generator(Array.from(fine));
    if (!area || area.coordinates.length === 0) continue;
    const coordinates = area.coordinates.map((polygon) =>
      polygon.map((ring) => ring.map(([u = 0, v = 0]) => slotToLonLat(grid, u / factor - 0.5, v / factor - 0.5))),
    );
    features.push({ type: 'Feature', properties: { key }, geometry: { type: 'MultiPolygon', coordinates } });
  }
  return { type: 'FeatureCollection', features };
}
