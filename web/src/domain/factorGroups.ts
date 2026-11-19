import type { CityDetail } from '../data/contract';
import type { Locale } from '../i18n/locale';
import { GROUP_TEXTS } from './small.texts';

/**
 * Factors that move together, read as one: greenery, tree cover and bare ground are one story, the built-up ones another.
 * SHAP values add up, so a group's contribution in a cell is the plain sum of its members; this stops the credit
 * from being split at random between correlated factors.
 */
export const FACTOR_GROUPS = [
  { id: 'green', keys: ['ndvi', 'tree', 'bare'] },
  { id: 'built', keys: ['built', 'buildings', 'roads', 'height', 'volume'] },
  { id: 'surface', keys: ['albedo'] },
  { id: 'setting', keys: ['water_dist', 'elevation'] },
] as const;

export type FactorGroupId = (typeof FACTOR_GROUPS)[number]['id'];

export interface GroupShare {
  id: FactorGroupId;
  label: string;
  /** Mean |contribution| of the group over the cells, °C. */
  meanAbs: number;
  /** Its part of the sum of mean |contribution| over all groups: a share of magnitude, not of variance. */
  share: number;
}

/**
 * Each group's part of the mean absolute contribution over the cells inside the outline, largest first.
 * A share of SHAP magnitude, not of variance. Without a mask every cell counts.
 */
export function groupShares(detail: CityDetail, locale: Locale, inside?: readonly boolean[]): GroupShare[] {
  const { shap, lst } = detail.cells;
  const cells = lst.flatMap((_, i) => (!inside || inside[i] ? [i] : []));
  const n = cells.length || 1;
  const groups = FACTOR_GROUPS.map((group) => {
    const columns = group.keys.flatMap((key) => (shap[key] ? [shap[key]] : []));
    let total = 0;
    for (const i of cells) total += Math.abs(columns.reduce((sum, column) => sum + (column[i] ?? 0), 0));
    return { id: group.id, label: GROUP_TEXTS[locale][group.id], meanAbs: total / n };
  }).filter((group) => group.meanAbs > 0);
  const sum = groups.reduce((s, group) => s + group.meanAbs, 0) || 1;
  return groups.map((group) => ({ ...group, share: group.meanAbs / sum })).sort((a, b) => b.meanAbs - a.meanAbs);
}

export interface IslandBudget {
  /** Mean surface inside the outline minus the mean around it, °C (a mean, so the parts below add up to it). */
  observed: number;
  /** Each group's share of that difference by the model, °C: its mean contribution inside minus around. */
  groups: { id: FactorGroupId; label: string; contribution: number }[];
  /**
   * What the factors leave unexplained, °C: the observed difference minus the sum of the groups. With SHAP the parts add
   * up to the model's own difference, so this is where the model misses the satellite, not a heat source of its own.
   */
  other: number;
}

/**
 * The city's heat over its ring split by factor group, plus what is left over (Eq. 63 of the team's theory notes:
 * observed contrast minus the sum of the contributions). Null without an outline or with too few cells on a side.
 */
export function islandBudget(detail: CityDetail, locale: Locale, inside: readonly boolean[], minCells = 20): IslandBudget | null {
  const { shap, lst } = detail.cells;
  const sides = [[], []] as [number[], number[]];
  lst.forEach((t, i) => {
    if (Number.isFinite(t)) sides[inside[i] ? 0 : 1].push(i);
  });
  const [within, around] = sides;
  if (within.length < minCells || around.length < minCells) return null;
  const mean = (cells: number[], at: (i: number) => number) => cells.reduce((sum, i) => sum + at(i), 0) / cells.length;
  const contrast = (at: (i: number) => number) => mean(within, at) - mean(around, at);
  const observed = contrast((i) => lst[i] ?? 0);
  const groups = FACTOR_GROUPS.flatMap((group) => {
    const columns = group.keys.flatMap((key) => (shap[key] ? [shap[key]] : []));
    if (!columns.length) return [];
    const contribution = contrast((i) => columns.reduce((sum, column) => sum + (column[i] ?? 0), 0));
    return [{ id: group.id, label: GROUP_TEXTS[locale][group.id], contribution }];
  }).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return { observed, groups, other: observed - groups.reduce((sum, group) => sum + group.contribution, 0) };
}
