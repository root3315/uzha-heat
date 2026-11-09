import { blur2 } from 'd3-array';
import { lonLatToSlot, rasterize, type CellGrid } from './grid';

/** A smooth temperature surface at `factor` times the grid resolution. */
export interface Field {
  grid: CellGrid;
  factor: number;
  fx: number;
  fy: number;
  values: Float32Array;
  /** 1 where the data has a cell, 0 elsewhere, bilinear between them, at the same resolution. */
  coverage: Float32Array;
}

export interface FieldOptions {
  factor?: number;
  /** Blur radius in fine pixels. */
  blur?: number;
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/**
 * Fills every empty slot with the mean of its filled neighbours, ring by ring outward.
 * This only gives smoothing something sensible to lean on at the edge: what is drawn is
 * clipped to the coverage, so nothing beyond the data is ever shown.
 */
export function fillEmpty(raster: Float32Array, nx: number, ny: number): Float32Array {
  let current = raster.slice();
  for (;;) {
    const next = current.slice();
    let filled = 0;
    let empty = 0;
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        if (!Number.isNaN(current[y * nx + x] ?? 0)) continue;
        empty++;
        let sum = 0;
        let count = 0;
        for (const [dx, dy] of NEIGHBOURS) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
          const v = current[yy * nx + xx] ?? Number.NaN;
          if (!Number.isNaN(v)) {
            sum += v;
            count++;
          }
        }
        if (count > 0) {
          next[y * nx + x] = sum / count;
          filled++;
        }
      }
    }
    current = next;
    if (filled === 0 || filled === empty) return current;
  }
}

/** 1 where a cell exists; a single missing cell surrounded by data counts as covered. */
export function coverageOf(grid: CellGrid, minNeighbours = 6): Float32Array {
  const { nx, ny, index } = grid;
  const cover = new Float32Array(nx * ny);
  for (let i = 0; i < index.length; i++) cover[i] = (index[i] ?? -1) >= 0 ? 1 : 0;
  const closed = cover.slice();
  for (let y = 1; y < ny - 1; y++) {
    for (let x = 1; x < nx - 1; x++) {
      if (cover[y * nx + x] === 1) continue;
      const around = NEIGHBOURS.reduce((sum, [dx, dy]) => sum + (cover[(y + dy) * nx + x + dx] ?? 0), 0);
      if (around >= minNeighbours) closed[y * nx + x] = 1;
    }
  }
  return closed;
}

export function bilinear(values: ArrayLike<number>, w: number, h: number, x: number, y: number): number {
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, x - x0));
  const ty = Math.max(0, Math.min(1, y - y0));
  const at = (xx: number, yy: number) => values[yy * w + xx] ?? 0;
  const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
  const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Fine pixel u sits at slot coordinate (u + 0.5) / factor − 0.5, and back. */
export const fineToSlot = (factor: number, u: number): number => (u + 0.5) / factor - 0.5;
export const slotToFine = (factor: number, g: number): number => (g + 0.5) * factor - 0.5;

export function upsample(values: Float32Array, nx: number, ny: number, factor: number): Float32Array {
  const fx = nx * factor;
  const fy = ny * factor;
  const fine = new Float32Array(fx * fy);
  for (let v = 0; v < fy; v++) {
    for (let u = 0; u < fx; u++) {
      fine[v * fx + u] = bilinear(values, nx, ny, fineToSlot(factor, u), fineToSlot(factor, v));
    }
  }
  return fine;
}

export function buildField(grid: CellGrid, lst: readonly number[], { factor = 4, blur = 6 }: FieldOptions = {}): Field {
  const { nx, ny } = grid;
  const values = upsample(fillEmpty(rasterize(grid, lst), nx, ny), nx, ny, factor);
  const fx = nx * factor;
  const fy = ny * factor;
  if (blur > 0) blur2({ data: values, width: fx, height: fy }, blur);
  return { grid, factor, fx, fy, values, coverage: upsample(coverageOf(grid), nx, ny, factor) };
}

/** Smoothed temperature at a point; the nearest edge value outside the grid. */
export function fieldAt(field: Field, lon: number, lat: number): number {
  const [gx, gy] = lonLatToSlot(field.grid, lon, lat);
  return bilinear(field.values, field.fx, field.fy, slotToFine(field.factor, gx), slotToFine(field.factor, gy));
}
