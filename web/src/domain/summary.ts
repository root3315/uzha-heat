import type { CityDetail, FeatureMeta, GlobalImportance } from '../data/contract';
import { formatNumber, formatTemp } from './format';

export interface ImportanceRow {
  feature: FeatureMeta;
  meanAbsShap: number;
  correlation: number;
  /** Share of the total mean |SHAP|, 0–1. */
  share: number;
}

const WEAK_CORRELATION = 0.15;
/** Mean |SHAP| below this, °C, means the factor did not influence the model (e.g. no variation in the city). */
export const NEGLIGIBLE_SHAP = 0.01;

export const isInfluential = (row: ImportanceRow): boolean => row.meanAbsShap >= NEGLIGIBLE_SHAP;

export function importanceRows(detail: CityDetail): ImportanceRow[] {
  const featureByKey = new Map(detail.features.map((f) => [f.key, f]));
  const known = detail.globalImportance.filter((g): g is GlobalImportance => featureByKey.has(g.key));
  const total = known.reduce((sum, g) => sum + g.meanAbsShap, 0) || 1;
  return known
    .map((g) => ({
      feature: featureByKey.get(g.key) as FeatureMeta,
      meanAbsShap: g.meanAbsShap,
      correlation: g.correlation,
      share: g.meanAbsShap / total,
    }))
    .sort((a, b) => b.meanAbsShap - a.meanAbsShap);
}

export type Direction = 'heats' | 'cools' | 'mixed';

export function directionOf(correlation: number): Direction {
  if (Math.abs(correlation) < WEAK_CORRELATION) return 'mixed';
  return correlation > 0 ? 'heats' : 'cools';
}

export function directionPhrase(direction: Direction): string {
  if (direction === 'heats') return 'больше — жарче';
  if (direction === 'cools') return 'больше — прохладнее';
  return 'связь неоднозначна';
}

function listInRussian(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} и ${items[items.length - 1]}`;
}

/** Short plain-language description of what drives surface heat in the city. */
export function citySummary(detail: CityDetail): string[] {
  const { stats, model } = detail;
  const rows = importanceRows(detail);
  const top = rows.filter(isInfluential).slice(0, 3);
  const spread = stats.lstP90 - stats.lstP10;

  const heat = `Летом поверхность города прогревается в среднем до ${formatTemp(stats.lstMean)}. Самые горячие 10 % территории — выше ${formatTemp(stats.lstP90)}, самые прохладные — ниже ${formatTemp(stats.lstP10)}: внутри одного города разница ${formatNumber(spread, 1)} °C.`;

  const drivers = top.length
    ? `Больше всего различия объясняют ${listInRussian(top.map((r) => r.feature.label.toLowerCase()))}. ${top
        .filter((r) => directionOf(r.correlation) !== 'mixed')
        .map((r) => `${r.feature.label}: ${directionPhrase(directionOf(r.correlation))}.`)
        .join(' ')}`.trim()
    : '';

  const quality = `Модель воспроизводит ${formatNumber(model.r2Cv * 100, 0)} % различий температуры между участками, которые она не видела при обучении.`;

  return [heat, drivers, quality].filter(Boolean);
}
