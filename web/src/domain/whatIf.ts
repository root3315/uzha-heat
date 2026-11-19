/**
 * "What if": the city's own XGBoost model, evaluated in the browser on a cell with some factors changed.
 * The model file is written by the pipeline (pipeline/uzha/browser_model.py); layout in docs/data-contract.md.
 */
import type { Tree, TreeModel } from '../data/contract';
import type { Locale } from '../i18n/locale';
import { CUT_TEXTS } from './small.texts';

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

/**
 * Predicted surface temperature, °C, for a row in `model.features` order. XGBoost compares and adds up the trees in
 * float32, so do we: summed in float64 the result drifts from the booster's by up to ~1e-4 °C over 400 trees.
 */
export function predictRow(model: TreeModel, row: readonly number[]): number {
  let sum = f32(model.baseScore);
  for (const tree of model.trees) sum = f32(sum + f32(walk(tree, row)));
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
    const sorted = column.filter(Number.isFinite).sort((x, y) => x - y);
    if (sorted.length) ranges[key] = [sortedQuantile(sorted, lo), sortedQuantile(sorted, hi)];
  }
  return ranges;
}

/** Quantile of an already sorted array, linear between neighbours, as `quantile` does after its own sort. */
function sortedQuantile(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[Math.ceil(pos)] ?? a;
  return a + (b - a) * (pos - lo);
}

const rangesByColumns = new WeakMap<object, FactorRanges>();

/** The city's slider ranges, computed once per city (the columns object is the city's own, never rebuilt). */
export function cityRanges(columns: Record<string, readonly number[]>): FactorRanges {
  let ranges = rangesByColumns.get(columns);
  if (!ranges) {
    ranges = factorRanges(columns);
    rangesByColumns.set(columns, ranges);
  }
  return ranges;
}

/** How much a reduction lever may take, said from the lever itself ("25 pp", "a quarter"), so no text drifts from it. */
export function cutAmount(lever: Lever | undefined, locale: Locale): string | undefined {
  const cut = lever?.cut;
  if (!cut) return undefined;
  const t = CUT_TEXTS[locale];
  if ('points' in cut) return t.points(cut.points);
  return cut.share === 0.25 ? t.quarter : t.percent(Math.round(cut.share * 100));
}

/** The end of a reduction lever when its cut stops it: "minus 25 pp". */
export const cutText = (lever: Lever, locale: Locale): string | undefined => {
  const amount = cutAmount(lever, locale);
  return amount && CUT_TEXTS[locale].minus(amount);
};

export const leverByKey = (key: string): Lever | undefined => LEVERS.find((lever) => lever.key === key);

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
  const after = predict(model, balanceCover(cell, changed));
  return { before, after, delta: after - before };
}

/** WorldCover shares of the same cell, %: they add up to at most 100 with whatever else covers it. */
const COVER = ['tree', 'built', 'bare'] as const;
/** Where added cover comes from: bare ground first, then built-up. */
const GIVES_WAY = ['bare', 'built'] as const;

const coverSum = (values: FactorValues): number => COVER.reduce((sum, key) => sum + (Number.isFinite(values[key]) ? (values[key] ?? 0) : 0), 0);

/**
 * Keeps a cell's land-cover shares possible after a change: more crowns take their area from bare ground, then from
 * built-up, never from a share the reader moved, until the shares add up to no more than 100 % (or to the cell's own
 * sum when that was already over, as rounding can leave it).
 */
export function balanceCover(cell: FactorValues, changed: FactorValues): FactorValues {
  let excess = coverSum(changed) - Math.max(100, coverSum(cell));
  if (excess <= 0) return changed;
  const balanced = { ...changed };
  for (const key of GIVES_WAY) {
    const value = balanced[key];
    if (excess <= 0 || value === undefined || !Number.isFinite(value) || value !== cell[key]) continue;
    const taken = Math.min(excess, value);
    balanced[key] = value - taken;
    excess -= taken;
  }
  return balanced;
}

/** A factor the reader may move, and which way makes sense to move it. */
export interface Lever {
  key: string;
  /** `up`: more of it (trees, greenery, lighter surfaces); `down`: only less of it (built-up, roads). */
  direction: 'up' | 'down';
  step: number;
  /**
   * For a reduction: how far below the cell's value it may go, so "less built-up" means a lighter block, not a demolished
   * one. `points`: in the factor's own units (percentage points of built-up); `share`: a fraction of the cell's value.
   */
  cut?: { points: number } | { share: number };
}

export const LEVERS: readonly Lever[] = [
  { key: 'tree', direction: 'up', step: 1 },
  { key: 'ndvi', direction: 'up', step: 0.01 },
  { key: 'albedo', direction: 'up', step: 0.01 },
  { key: 'built', direction: 'down', step: 1, cut: { points: 25 } },
  { key: 'roads', direction: 'down', step: 0.5, cut: { share: 0.25 } },
];

export interface LeverRange {
  lever: Lever;
  /** Where the slider starts: the cell as it is. */
  from: number;
  /** As far as the slider goes: the city's 5th or 95th percentile, or the end of the lever's cut. */
  to: number;
  /** What stops it there. */
  bound: 'city' | 'cut';
}

/** A lever needs at least this share of the city's range to move before it is worth a slider. */
const MIN_ROOM = 0.05;
/** At most this many sliders. */
export const MAX_LEVERS = 4;
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
    const cutTo = lever.cut ? from - ('points' in lever.cut ? lever.cut.points : lever.cut.share * from) : -Infinity;
    const bound: LeverRange['bound'] = lever.direction === 'down' && cutTo > range[0] ? 'cut' : 'city';
    const to =
      lever.direction === 'up' ? from + Math.floor((range[1] - from) / lever.step + 1e-9) * lever.step : Math.max(range[0], cutTo);
    const room = lever.direction === 'up' ? to - from : from - to;
    // One step of travel is no slider: at least two, and a real share of the city's range.
    if (room < 2 * lever.step - 1e-9 || room < MIN_ROOM * (range[1] - range[0])) continue;
    const heat = contributions[lever.key] ?? 0;
    if (lever.direction === 'down' && (heat < MIN_HEAT || whatIf(model, cell, { [lever.key]: to }).delta > -MIN_COOLING)) continue;
    options.push({ lever, from, to, bound, heat });
  }
  // The ones that heat this cell most are kept, then shown in one fixed order, so the sliders stay where the hand
  // expects them from one place to the next.
  const order = (range: LeverRange) => LEVERS.indexOf(range.lever);
  return options
    .sort((a, b) => b.heat - a.heat)
    .slice(0, MAX_LEVERS)
    .sort((a, b) => order(a) - order(b))
    .map(({ heat: _heat, ...range }) => range);
}
