/**
 * "Что если": the city's own XGBoost model, evaluated in the browser on a cell with some factors changed.
 * The model file is written by the pipeline (pipeline/uzha/browser_model.py); layout in docs/data-contract.md.
 */
import type { Tree, TreeModel } from '../data/contract';
import { quantile } from './stats';

/** Values of one cell, by factor key. */
export type FactorValues = Record<string, number>;
/** [min, max] of each factor over the city's cells. */
export type FactorRanges = Record<string, readonly [number, number]>;

export interface WhatIf {
  /** The model for the cell as it is, °C. */
  before: number;
  /** The model for the cell with the changes, °C. */
  after: number;
  delta: number;
}

const f32 = Math.fround;

function walk(tree: Tree, row: readonly number[]): number {
  const { feature, value, left, defaultLeft } = tree;
  let node = 0;
  for (;;) {
    const split = feature[node] ?? -1;
    if (split < 0) return value[node] ?? 0;
    const x = row[split] ?? Number.NaN;
    const goLeft = Number.isNaN(x) ? defaultLeft[node] === 1 : f32(x) < f32(value[node] ?? 0);
    node = (left[node] ?? 0) + (goLeft ? 0 : 1);
  }
}

/** Predicted surface temperature, °C, for a row in `model.features` order (XGBoost compares in float32, so do we). */
export function predictRow(model: TreeModel, row: readonly number[]): number {
  let sum = model.baseScore;
  for (const tree of model.trees) sum += walk(tree, row);
  return sum;
}

/** Predicted surface temperature, °C, for a cell's factor values; a factor the cell lacks counts as missing. */
export function predict(model: TreeModel, values: FactorValues): number {
  return predictRow(
    model,
    model.features.map((key) => values[key] ?? Number.NaN),
  );
}

export const clamp = (value: number, [min, max]: readonly [number, number]): number => Math.min(max, Math.max(min, value));

/** Sliders stop at the city's 5th and 95th percentile: past them the model would be asked about combinations it hardly saw. */
export const RANGE_QUANTILES = [0.05, 0.95] as const;

/** The 5th–95th percentile of every factor column, so nobody asks the model for a value the city barely has. */
export function factorRanges(columns: Record<string, readonly number[]>, [lo, hi]: readonly [number, number] = RANGE_QUANTILES): FactorRanges {
  const ranges: FactorRanges = {};
  for (const [key, column] of Object.entries(columns)) {
    const finite = column.filter(Number.isFinite);
    if (finite.length) ranges[key] = [quantile(finite, lo), quantile(finite, hi)];
  }
  return ranges;
}

/**
 * The cell as it is and with `changes` (new values), by the model. A change is clamped to the city's range, widened
 * to take in the cell's own value: a cell already past the range keeps its value and may only move back into it.
 */
export function whatIf(model: TreeModel, cell: FactorValues, changes: FactorValues, ranges: FactorRanges = {}): WhatIf {
  const changed: FactorValues = { ...cell };
  for (const [key, value] of Object.entries(changes)) {
    const range = ranges[key];
    const here = cell[key];
    const bounds: readonly [number, number] | undefined =
      range && here !== undefined && Number.isFinite(here) ? [Math.min(range[0], here), Math.max(range[1], here)] : range;
    changed[key] = bounds ? clamp(value, bounds) : value;
  }
  const before = predict(model, cell);
  const after = predict(model, changed);
  return { before, after, delta: after - before };
}

/** A factor the reader may move, and which way makes sense to move it. */
export interface Lever {
  key: string;
  /** `up`: more of it (trees, greenery, lighter surfaces); `down`: only less of it (built-up, roads). */
  direction: 'up' | 'down';
  step: number;
}

export const LEVERS: readonly Lever[] = [
  { key: 'tree', direction: 'up', step: 1 },
  { key: 'ndvi', direction: 'up', step: 0.01 },
  { key: 'albedo', direction: 'up', step: 0.01 },
  { key: 'built', direction: 'down', step: 1 },
  { key: 'roads', direction: 'down', step: 0.5 },
];

export interface LeverRange {
  lever: Lever;
  /** Where the slider starts: the cell as it is. */
  from: number;
  /** As far as the city goes in that direction. */
  to: number;
}

/** A lever needs at least this share of the city's range to move before it is worth a slider. */
const MIN_ROOM = 0.05;
/** At most this many sliders. */
export const MAX_LEVERS = 3;
/** Less built-up or fewer roads is offered only where that factor heats the cell by at least this much, °C… */
const MIN_HEAT = 0.1;
/** …and where taking it all the way down cools the cell by the model at least this much, °C. */
const MIN_COOLING = 0.1;

/**
 * The levers worth offering for a cell: present in the model, with room to move within the city's range,
 * those that heat this cell most (by its SHAP contribution) first.
 *
 * Built-up and roads only go down, and only where it makes sense. With everything else held, the model reads the
 * freed land as bare ground, which in these cities is often hotter than asphalt; so a reduction is offered only
 * where the factor heats this cell and its removal cools it. Greener and lighter are offered wherever there is room.
 */
export function leversFor(model: TreeModel, cell: FactorValues, contributions: FactorValues, ranges: FactorRanges): LeverRange[] {
  const options: (LeverRange & { heat: number })[] = [];
  for (const lever of LEVERS) {
    const range = ranges[lever.key];
    const here = cell[lever.key];
    if (!range || here === undefined || !model.features.includes(lever.key)) continue;
    // The slider starts at the cell as it is, even past the range; then it has no room in that direction.
    const from = here;
    // A slider moves in whole steps from its low end: going up, that end is the cell itself, so the top is the last
    // step that fits; going down, the low end is the range's own end and is reached exactly.
    const to = lever.direction === 'up' ? from + Math.floor((range[1] - from) / lever.step + 1e-9) * lever.step : range[0];
    const room = lever.direction === 'up' ? to - from : from - to;
    if (room < lever.step || room < MIN_ROOM * (range[1] - range[0])) continue;
    const heat = contributions[lever.key] ?? 0;
    if (lever.direction === 'down' && (heat < MIN_HEAT || whatIf(model, cell, { [lever.key]: to }).delta > -MIN_COOLING)) continue;
    options.push({ lever, from, to, heat });
  }
  return options
    .sort((a, b) => b.heat - a.heat)
    .slice(0, MAX_LEVERS)
    .map(({ lever, from, to }) => ({ lever, from, to }));
}
