/**
 * The summer night surface temperature from NASA MODIS Aqua (about 01:30, 1 km), written per city by
 * `python -m pipeline.night --all` as `night-<id>.json`. Optional: without it the map has no night layer.
 * The grid is MODIS's own sinusoidal one, so every pixel drawn is a real 1 km MODIS pixel.
 */
import { DataContractError, isNumber, isObject } from './parse';

export interface NightGrid {
  product: string;
  /** Local overpass time, "~01:30". */
  overpassLocal: string;
  /** The Landsat period, as in the city file (Russian). */
  period: string;
  composites: number;
  /** Sphere radius of the sinusoidal projection, m. */
  radiusM: number;
  /** Top-left corner of the grid, sinusoidal metres. */
  x0: number;
  y0: number;
  pixelM: number;
  nx: number;
  ny: number;
  /** Row-major from the north-west, °C; NaN where MODIS had too few good nights or the pixel is far from the city. */
  values: Float32Array;
  median: number;
}

export const NIGHT_FORMAT = 'uzha-night-1';

function positive(value: unknown, path: string): number {
  if (!isNumber(value) || value <= 0) throw new DataContractError(`${path} must be a positive number`);
  return value;
}

function finite(value: unknown, path: string): number {
  if (!isNumber(value)) throw new DataContractError(`${path} must be a number`);
  return value;
}

export function parseNight(json: unknown): NightGrid {
  if (!isObject(json) || json.format !== NIGHT_FORMAT) throw new DataContractError(`night file must have format ${NIGHT_FORMAT}`);
  const { grid, values, stats } = json;
  if (!isObject(grid)) throw new DataContractError('night.grid must be an object');
  const nx = positive(grid.nx, 'night.grid.nx');
  const ny = positive(grid.ny, 'night.grid.ny');
  if (!Number.isInteger(nx) || !Number.isInteger(ny)) throw new DataContractError('night.grid.nx and ny must be whole');
  if (!Array.isArray(values) || values.length !== nx * ny) throw new DataContractError(`night.values must hold nx × ny = ${nx * ny} numbers`);
  const parsed = Float32Array.from(values, (v: unknown) => (isNumber(v) ? v : Number.NaN));
  return {
    product: String(json.product ?? ''),
    overpassLocal: String(json.overpassLocal ?? ''),
    period: String(json.period ?? ''),
    composites: isNumber(json.composites) ? json.composites : 0,
    radiusM: positive(grid.radiusM, 'night.grid.radiusM'),
    x0: finite(grid.x0, 'night.grid.x0'),
    y0: finite(grid.y0, 'night.grid.y0'),
    pixelM: positive(grid.pixelM, 'night.grid.pixelM'),
    nx,
    ny,
    values: parsed,
    median: isObject(stats) && isNumber(stats.median) ? stats.median : medianOf(parsed),
  };
}

function medianOf(values: Float32Array): number {
  const sorted = Array.from(values).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[middle] ?? Number.NaN) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
