/**
 * `seb-<id>.json`: the physics model's inputs for every cell of a city, written by `python -m pipeline.seb_export`
 * (format in docs/data-contract.md). Fetched only when the reader opens "Surfaces (physics)"; the domain
 * (web/src/domain/surfaces.ts) rebuilds one cell's inputs from it for the solver in web/src/domain/seb/.
 */
import { isNumber, isObject } from './parse';

/** One value for every cell, or fixed-point integers: value = offset + step × int. */
export type SebColumn = number | { offset: number; step: number; values: readonly number[] };

type Ohm = readonly [number, number, number];

export interface SebCity {
  /** Tile names in the order of the per-tile lists. */
  tiles: readonly string[];
  cells: number;
  /** The calibrated parameters, named as the solver's Params. */
  params: Record<(typeof PARAM_KEYS)[number], number>;
  forcing: Record<(typeof UNIFORM_FORCING)[number], number> & Record<'tAir' | 'lDown' | 'pressure', SebColumn>;
  tile: {
    emissivity: readonly number[];
    ohm: readonly Ohm[];
    /** Albedo of the tiles that have one value for the city; the others take `imperviousAlbedo`. */
    albedo: Readonly<Record<string, number>>;
    imperviousTiles: readonly string[];
    /** Tiles that take `canyonShade`; the others are in full sun. */
    canyonTiles: readonly string[];
  };
  cell: { fraction: Readonly<Record<string, SebColumn>> } & Record<(typeof CELL_COLUMNS)[number], SebColumn>;
  /** Sample cells with the Python solver's cell temperature (K) on these same inputs. */
  check: { cells: number[]; tCell: number[] } | null;
}

const PARAM_KEYS = ['kbInv', 'rsMinTree', 'rsMinGrass', 'rsMinCrop', 'soilResistanceScale', 'ohmA1Scale', 'dTAir'] as const;
const UNIFORM_FORCING = ['kDown', 'diffuseFraction', 'eAir', 'wind', 'zRef', 'zenith', 'dkDt'] as const;
const CELL_COLUMNS = ['imperviousAlbedo', 'canyonShade', 'skyView', 'z0m', 'zd', 'soilMoisture', 'qf', 'irrigated', 'rural'] as const;

const isWords = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');
const parseNumber = (value: unknown): number | null => (isNumber(value) ? value : null);

function parseColumn(value: unknown, cells: number): SebColumn | null {
  if (isNumber(value)) return value;
  if (!isObject(value) || !isNumber(value.offset) || !isNumber(value.step) || !Array.isArray(value.values)) return null;
  const values = value.values;
  return values.length === cells && values.every(isNumber) ? { offset: value.offset, step: value.step, values } : null;
}

/** Each key of `keys` parsed by `parse`; null when any is missing or malformed. */
function every<K extends string, V>(source: unknown, keys: readonly K[], parse: (value: unknown) => V | null): Record<K, V> | null {
  if (!isObject(source)) return null;
  const out: Partial<Record<K, V>> = {};
  for (const key of keys) {
    const parsed = parse(source[key]);
    if (parsed === null) return null;
    out[key] = parsed;
  }
  return out as Record<K, V>;
}

function parseTile(value: unknown, tiles: readonly string[]): SebCity['tile'] | null {
  if (!isObject(value) || !isObject(value.albedo)) return null;
  const { emissivity, ohm, imperviousTiles, canyonTiles } = value;
  if (!Array.isArray(emissivity) || emissivity.length !== tiles.length || !emissivity.every(isNumber)) return null;
  const rows = Array.isArray(ohm) ? ohm.filter((row): row is Ohm => Array.isArray(row) && row.length === 3 && row.every(isNumber)) : [];
  if (rows.length !== tiles.length || !isWords(imperviousTiles) || !isWords(canyonTiles)) return null;
  const albedo: Record<string, number> = {};
  for (const [tile, a] of Object.entries(value.albedo)) if (isNumber(a)) albedo[tile] = a;
  // Every tile needs an albedo from one of the two places.
  if (!tiles.every((tile) => albedo[tile] !== undefined || imperviousTiles.includes(tile))) return null;
  return { emissivity, ohm: rows, albedo, imperviousTiles, canyonTiles };
}

function parseCheck(value: unknown, cells: number): SebCity['check'] {
  if (!isObject(value) || !Array.isArray(value.cells) || !Array.isArray(value.tCell)) return null;
  const { cells: picked, tCell } = value;
  const ok = picked.length === tCell.length && picked.every((c) => Number.isInteger(c) && c >= 0 && c < cells) && tCell.every(isNumber);
  return ok ? { cells: picked, tCell } : null;
}

/**
 * Lenient: unknown keys are ignored and `check` is optional, but without every input the solver needs the file is
 * of no use, so it is null then and the block says the physics did not load.
 */
export function parseSeb(raw: unknown): SebCity | null {
  if (!isObject(raw) || !Number.isInteger(raw.cells) || !isWords(raw.tiles) || !isObject(raw.cell)) return null;
  const cells = raw.cells as number;
  const tiles = raw.tiles;
  const column = (value: unknown) => parseColumn(value, cells);
  const params = every(raw.params, PARAM_KEYS, parseNumber);
  const uniform = every(raw.forcing, UNIFORM_FORCING, parseNumber);
  const varying = every(raw.forcing, ['tAir', 'lDown', 'pressure'] as const, column);
  const tile = parseTile(raw.tile, tiles);
  const fraction = every(raw.cell.fraction, tiles, column);
  const columns = every(raw.cell, CELL_COLUMNS, column);
  if (!params || !uniform || !varying || !tile || !fraction || !columns) return null;
  return { tiles, cells, params, forcing: { ...uniform, ...varying }, tile, cell: { fraction, ...columns }, check: parseCheck(raw.check, cells) };
}

/** The column's value for one cell. */
export function columnAt(column: SebColumn, cell: number): number {
  return typeof column === 'number' ? column : column.offset + column.step * (column.values[cell] ?? Number.NaN);
}
