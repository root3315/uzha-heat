import type { CityDetail, GlobalImportance } from '../data/contract';
import { causeLabel, causeWords } from './causes';
import { formatDeg } from './format';
import { dominantCause } from './transect';

/**
 * The opening game: find the hot places. A place is one 200 m cell, and it counts as hot
 * when it is in the city's hottest tenth, the same group the city answer talks about.
 */
export interface HuntTarget {
  threshold: number;
  total: number;
}

/** Only cells that can be tapped count: those inside the city outline, when one is given. */
export function huntTarget(detail: CityDetail, inside?: readonly boolean[]): HuntTarget {
  const threshold = detail.stats.lstP90;
  return { threshold, total: detail.cells.lst.filter((t, i) => t >= threshold && (inside?.[i] ?? true)).length };
}

export interface HuntCandidate {
  cell: number;
  t: number;
}

/**
 * A tap within one cell of a hot cell counts, so a finger does not have to land on 200 m exactly.
 * `candidates` are the tapped cell first, then its neighbours: a new hot one wins, then an already found one.
 */
export function huntCell(candidates: readonly HuntCandidate[], found: ReadonlySet<number>, target: HuntTarget): HuntCandidate | null {
  const hot = candidates.filter((c) => c.t >= target.threshold);
  return hot.find((c) => !found.has(c.cell)) ?? hot[0] ?? candidates[0] ?? null;
}

export type FindOutcome = 'new' | 'repeat' | 'cold';

/** A click on a cell: counted once if it is hot, otherwise only reported back. */
export function registerFind(found: ReadonlySet<number>, cell: number, lst: number, target: HuntTarget): { found: ReadonlySet<number>; outcome: FindOutcome } {
  if (!(lst >= target.threshold)) return { found, outcome: 'cold' };
  if (found.has(cell)) return { found, outcome: 'repeat' };
  return { found: new Set(found).add(cell), outcome: 'new' };
}

export interface CellReadout {
  t: number;
  /** The factor that moves this cell's temperature most, in the words of the map legend. */
  cause: string | null;
  heats: boolean;
}

/** What the map says under the cursor: the cell's temperature and its strongest cause. */
export function cellReadout(detail: CityDetail, cell: number): CellReadout | null {
  const t = detail.cells.lst[cell];
  if (t === undefined || !Number.isFinite(t)) return null;
  const contributions = Object.fromEntries(detail.features.map((f) => [f.key, detail.cells.shap[f.key]?.[cell] ?? 0]));
  const top = dominantCause(contributions);
  const feature = detail.features.find((f) => f.key === top?.key);
  if (!top || !feature) return { t, cause: null, heats: false };
  return { t, cause: causeLabel(causeWords(feature), top.value), heats: top.value >= 0 };
}

/** The factor that explains the largest part of the temperature differences, and how large that part is. */
export function leadingFactor(importance: readonly GlobalImportance[]): { key: string; share: number } | null {
  const total = importance.reduce((sum, item) => sum + Math.max(0, item.meanAbsShap), 0);
  const top = importance.reduce<GlobalImportance | null>((best, item) => (!best || item.meanAbsShap > best.meanAbsShap ? item : best), null);
  if (!top || total <= 0) return null;
  return { key: top.key, share: top.meanAbsShap / total };
}

/** The line under the counter after a click, in the page's plain voice. */
export function findMessage(outcome: FindOutcome, t: number, target: HuntTarget, cityMean: number): string {
  if (outcome === 'new') return `Засчитано: ${formatDeg(t)}, горячая десятая часть города.`;
  if (outcome === 'repeat') return 'Этот участок уже засчитан.';
  if (t >= cityMean) return `${formatDeg(t)}: теплее среднего, но горячими считаются от ${formatDeg(target.threshold)}.`;
  return `${formatDeg(t)}: прохладнее среднего по городу, ${formatDeg(cityMean)}.`;
}
