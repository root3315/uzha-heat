/**
 * "Что если": the city's own XGBoost model, evaluated in the browser on a cell with some factors changed.
 * The model file is written by the pipeline (pipeline/uzha/browser_model.py); see there for the layout.
 */

/** One regression tree as parallel arrays over its nodes. A leaf has feature −1 and its value in `value`. */
export interface Tree {
  feature: number[];
  /** Split threshold (go left when x < value), or the leaf value. */
  value: number[];
  /** Left child; the right one is left + 1. −1 for a leaf. */
  left: number[];
  /** 1 when a missing value goes left. */
  defaultLeft: number[];
}

export interface TreeModel {
  features: string[];
  baseScore: number;
  trees: Tree[];
  /** Sample rows with the booster's own predictions, written by the pipeline. */
  check?: { rows: number[][]; prediction: number[] };
}

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

/** Min and max of every factor column, so nobody asks the model for a value the city does not have. */
export function factorRanges(columns: Record<string, readonly number[]>): FactorRanges {
  const ranges: FactorRanges = {};
  for (const [key, column] of Object.entries(columns)) {
    let min = Infinity;
    let max = -Infinity;
    for (const v of column) {
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min <= max) ranges[key] = [min, max];
  }
  return ranges;
}

/** The cell as it is and with `changes` (new values, clamped to the city's range), by the model. */
export function whatIf(model: TreeModel, cell: FactorValues, changes: FactorValues, ranges: FactorRanges = {}): WhatIf {
  const changed: FactorValues = { ...cell };
  for (const [key, value] of Object.entries(changes)) {
    const range = ranges[key];
    changed[key] = range ? clamp(value, range) : value;
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

/**
 * The levers worth offering for a cell: present in the model, with room to move within the city's range,
 * those that heat this cell most (by its SHAP contribution) first. Built-up and roads only go down.
 */
export function leversFor(model: TreeModel, cell: FactorValues, contributions: FactorValues, ranges: FactorRanges): LeverRange[] {
  const options: (LeverRange & { heat: number })[] = [];
  for (const lever of LEVERS) {
    const range = ranges[lever.key];
    const here = cell[lever.key];
    if (!range || here === undefined || !model.features.includes(lever.key)) continue;
    const from = clamp(here, range);
    const to = lever.direction === 'up' ? range[1] : range[0];
    if (Math.abs(to - from) < MIN_ROOM * (range[1] - range[0])) continue;
    options.push({ lever, from, to, heat: contributions[lever.key] ?? 0 });
  }
  return options
    .sort((a, b) => b.heat - a.heat)
    .slice(0, MAX_LEVERS)
    .map(({ lever, from, to }) => ({ lever, from, to }));
}

/** Basic shape check for the downloaded model file. */
export function parseTreeModel(raw: unknown): TreeModel {
  const model = raw as Partial<TreeModel> | null;
  if (!model || !Array.isArray(model.features) || typeof model.baseScore !== 'number' || !Array.isArray(model.trees)) {
    throw new Error('model file: expected features, baseScore and trees');
  }
  for (const tree of model.trees) {
    const n = tree?.feature?.length;
    if (!n || tree.value?.length !== n || tree.left?.length !== n || tree.defaultLeft?.length !== n) {
      throw new Error('model file: a tree with mismatched arrays');
    }
  }
  return model as TreeModel;
}
