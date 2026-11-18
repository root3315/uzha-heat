import type { CityDetail } from '../data/contract';

/**
 * Factors that move together, read as one: greenery, tree cover and bare ground are one story, the built-up ones another.
 * SHAP values add up, so a group's contribution in a cell is the plain sum of its members; this stops the credit
 * from being split at random between correlated factors.
 */
export const FACTOR_GROUPS = [
  { id: 'green', label: 'Растительность и грунт', keys: ['ndvi', 'tree', 'bare'] },
  { id: 'built', label: 'Застройка', keys: ['built', 'buildings', 'roads', 'height', 'volume'] },
  { id: 'surface', label: 'Цвет поверхности', keys: ['albedo'] },
  { id: 'setting', label: 'Вода и рельеф', keys: ['water_dist', 'elevation'] },
] as const;

export type FactorGroupId = (typeof FACTOR_GROUPS)[number]['id'];

export interface GroupShare {
  id: FactorGroupId;
  label: string;
  /** Mean |contribution| of the group over the cells, °C. */
  meanAbs: number;
  /** Its part of the sum over all groups. */
  share: number;
}

/** How much of the explained temperature each group carries across the city, largest first. */
export function groupShares(detail: CityDetail): GroupShare[] {
  const { shap, lst } = detail.cells;
  const n = lst.length || 1;
  const groups = FACTOR_GROUPS.map((group) => {
    const columns = group.keys.flatMap((key) => (shap[key] ? [shap[key]] : []));
    let total = 0;
    for (let i = 0; i < lst.length; i++) total += Math.abs(columns.reduce((sum, column) => sum + (column[i] ?? 0), 0));
    return { id: group.id, label: group.label, meanAbs: total / n };
  }).filter((group) => group.meanAbs > 0);
  const sum = groups.reduce((s, group) => s + group.meanAbs, 0) || 1;
  return groups.map((group) => ({ ...group, share: group.meanAbs / sum })).sort((a, b) => b.meanAbs - a.meanAbs);
}
