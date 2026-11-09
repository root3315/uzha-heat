import { fromUtm, toUtm, utmZone, type Metres } from './utm';

/**
 * Cells snapped onto their UTM grid, so a city can be treated as an image.
 * Slot (gx, gy) is a cell position: gx grows east, gy grows south, slot (0, 0) is the north-west corner.
 */
export interface CellGrid {
  zone: number;
  cellSizeM: number;
  nx: number;
  ny: number;
  /** Cell index in each slot, −1 where the data has no cell. */
  index: Int32Array;
  /** UTM centre of slot (0, 0). */
  originX: number;
  originY: number;
}

/** Empty slots kept around the data so smoothing and contours have room at the edge. */
export const GRID_PAD = 4;

function offsetOf(value: number, cellSizeM: number): number {
  return value - Math.round(value / cellSizeM) * cellSizeM;
}

export function buildCellGrid(lon: readonly number[], lat: readonly number[], cellSizeM: number, pad = GRID_PAD): CellGrid {
  const n = lon.length;
  if (n === 0) throw new Error('Нет ни одной ячейки');
  const zone = utmZone(lon[0] ?? 0);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const [x, y] = toUtm(lon[i] ?? 0, lat[i] ?? 0, zone);
    xs[i] = x;
    ys[i] = y;
  }
  const ox = offsetOf(xs[0] ?? 0, cellSizeM);
  const oy = offsetOf(ys[0] ?? 0, cellSizeM);

  const cols = new Int32Array(n);
  const rows = new Int32Array(n);
  let minCol = Infinity;
  let maxCol = -Infinity;
  let minRow = Infinity;
  let maxRow = -Infinity;
  for (let i = 0; i < n; i++) {
    const col = Math.round(((xs[i] ?? 0) - ox) / cellSizeM);
    const row = Math.round(((ys[i] ?? 0) - oy) / cellSizeM);
    cols[i] = col;
    rows[i] = row;
    minCol = Math.min(minCol, col);
    maxCol = Math.max(maxCol, col);
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, row);
  }

  const nx = maxCol - minCol + 1 + 2 * pad;
  const ny = maxRow - minRow + 1 + 2 * pad;
  const index = new Int32Array(nx * ny).fill(-1);
  for (let i = 0; i < n; i++) {
    const gx = (cols[i] ?? 0) - minCol + pad;
    const gy = maxRow - (rows[i] ?? 0) + pad;
    index[gy * nx + gx] = i;
  }
  return {
    zone,
    cellSizeM,
    nx,
    ny,
    index,
    originX: (minCol - pad) * cellSizeM + ox,
    originY: (maxRow + pad) * cellSizeM + oy,
  };
}

export function slotToUtm(grid: CellGrid, gx: number, gy: number): Metres {
  return [grid.originX + gx * grid.cellSizeM, grid.originY - gy * grid.cellSizeM];
}

export function utmToSlot(grid: CellGrid, x: number, y: number): [number, number] {
  return [(x - grid.originX) / grid.cellSizeM, (grid.originY - y) / grid.cellSizeM];
}

export function slotToLonLat(grid: CellGrid, gx: number, gy: number): [number, number] {
  const [x, y] = slotToUtm(grid, gx, gy);
  return fromUtm(x, y, grid.zone);
}

export function lonLatToSlot(grid: CellGrid, lon: number, lat: number): [number, number] {
  const [x, y] = toUtm(lon, lat, grid.zone);
  return utmToSlot(grid, x, y);
}

/** Index of the cell covering the point, or −1. */
export function cellAt(grid: CellGrid, lon: number, lat: number): number {
  const [gx, gy] = lonLatToSlot(grid, lon, lat);
  const cx = Math.round(gx);
  const cy = Math.round(gy);
  if (cx < 0 || cy < 0 || cx >= grid.nx || cy >= grid.ny) return -1;
  return grid.index[cy * grid.nx + cx] ?? -1;
}

/** One value per slot; NaN where there is no cell. */
export function rasterize(grid: CellGrid, values: readonly number[]): Float32Array {
  const raster = new Float32Array(grid.nx * grid.ny).fill(Number.NaN);
  grid.index.forEach((cell, slot) => {
    if (cell >= 0) raster[slot] = values[cell] ?? Number.NaN;
  });
  return raster;
}
