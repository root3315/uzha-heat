import type { FeatureMeta } from '../data/contract';
import { formatFactorValue, formatNumber } from './format';

export interface RecommendationInput {
  features: FeatureMeta[];
  values: Record<string, number>;
  contributions: Record<string, number>;
  cityMeans: Record<string, number>;
}

export interface Reason {
  key: string;
  /** e.g. "NDVI 0,08 — в 3 раза ниже среднего по городу (0,24)" */
  text: string;
  /** °C this factor adds to the place's temperature. */
  contribution: number;
}

export interface EffectRange {
  /** Expected surface cooling, °C, as positive numbers (min ≤ max). */
  min: number;
  max: number;
}

export interface Recommendation {
  id: string;
  title: string;
  actions: string[];
  reasons: Reason[];
  /** Sum of the positive contributions that triggered this recommendation, °C. */
  heating: number;
  effect: EffectRange;
}

/** Which side of the city mean makes a factor a problem that the intervention addresses. */
type ProblemSide = 'low' | 'high';

interface Trigger {
  key: string;
  problem: ProblemSide;
}

interface InterventionRule {
  id: string;
  title: string;
  actions: string[];
  triggers: Trigger[];
  /** Typical surface-temperature reduction reported in the literature, °C. */
  typicalEffect: EffectRange;
}

/**
 * Interventions keyed by the factors that make them relevant. Factors without a rule
 * (e.g. elevation) describe the setting and are not actionable.
 */
export const INTERVENTIONS: readonly InterventionRule[] = [
  {
    id: 'shade-trees',
    title: 'Деревья вдоль улиц и теневые навесы',
    actions: [
      'высадить крупномерные деревья вдоль тротуаров и во дворах — чинара, карагач, тут',
      'навесы и перголы над остановками, рынками и детскими площадками',
    ],
    triggers: [
      { key: 'ndvi', problem: 'low' },
      { key: 'tree', problem: 'low' },
    ],
    typicalEffect: { min: 1, max: 3 },
  },
  {
    id: 'cool-roofs',
    title: 'Холодные и зелёные крыши',
    actions: [
      'светлые отражающие покрытия кровли при плановом ремонте',
      'зелёные крыши на общественных и торговых зданиях с плоской кровлей',
    ],
    triggers: [
      { key: 'built', problem: 'high' },
      { key: 'buildings', problem: 'high' },
      { key: 'albedo', problem: 'low' },
    ],
    typicalEffect: { min: 0.5, max: 2 },
  },
  {
    id: 'cool-pavements',
    title: 'Затенение и светлые покрытия дорог',
    actions: ['светлый или проницаемый асфальт на парковках и тротуарах', 'деревья по разделительным полосам'],
    triggers: [{ key: 'roads', problem: 'high' }],
    typicalEffect: { min: 0.5, max: 1.5 },
  },
  {
    id: 'cover-bare-soil',
    title: 'Закрыть открытый грунт',
    actions: [
      'засухоустойчивый газон и почвопокровные растения на пустырях',
      'пылеподавление и озеленение промзон и обочин',
    ],
    triggers: [{ key: 'bare', problem: 'high' }],
    typicalEffect: { min: 1, max: 3 },
  },
  {
    id: 'water',
    title: 'Вода рядом: арыки, фонтаны, полив',
    actions: [
      'восстановить арычную сеть и капельный полив скверов',
      'фонтаны и открытые водоёмы в общественных пространствах',
    ],
    triggers: [{ key: 'water_dist', problem: 'high' }],
    typicalEffect: { min: 0.5, max: 2 },
  },
];

const MIN_CONTRIBUTION = 0.15;
const NEAR_MEAN_SHARE = 0.1;
const ALMOST_NONE_SHARE = 0.05;

function timesWord(ratio: number): string {
  const rounded = Math.round(ratio * 10) / 10;
  if (!Number.isInteger(rounded)) return 'раза';
  const lastTwo = rounded % 100;
  const last = rounded % 10;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'раза' : 'раз';
}

export function formatRatio(ratio: number): string {
  const rounded = Math.round(ratio * 10) / 10;
  const digits = Number.isInteger(rounded) || rounded >= 10 ? 0 : 1;
  return `в ${formatNumber(digits === 0 ? Math.round(rounded) : rounded, digits)} ${timesWord(digits === 0 ? Math.round(rounded) : rounded)}`;
}

/** Plain-language comparison of a place's value with the city mean. */
export function compareWithCity(feature: FeatureMeta, value: number, cityMean: number): string {
  const meanText = formatFactorValue(feature, cityMean);
  if (!Number.isFinite(cityMean) || cityMean <= 0 || value < 0) return `в среднем по городу — ${meanText}`;
  const relative = (value - cityMean) / cityMean;
  if (Math.abs(relative) < NEAR_MEAN_SHARE) return `на уровне среднего по городу (${meanText})`;
  if (value <= cityMean * ALMOST_NONE_SHARE) return `почти нет; в среднем по городу — ${meanText}`;
  const direction = relative < 0 ? 'ниже' : 'выше';
  const ratio = relative < 0 ? cityMean / value : value / cityMean;
  const amount = ratio >= 1.5 ? formatRatio(ratio) : `на ${formatNumber(Math.abs(relative) * 100, 0)} %`;
  return `${amount} ${direction} среднего по городу (${meanText})`;
}

function factorName(feature: FeatureMeta): string {
  return feature.unit === 'NDVI' ? 'NDVI' : feature.label;
}

function reasonFor(feature: FeatureMeta, input: RecommendationInput): Reason {
  const value = input.values[feature.key] ?? Number.NaN;
  const cityMean = input.cityMeans[feature.key] ?? Number.NaN;
  return {
    key: feature.key,
    text: `${factorName(feature)} ${formatFactorValue(feature, value)} — ${compareWithCity(feature, value, cityMean)}`,
    contribution: input.contributions[feature.key] ?? 0,
  };
}

/** The literature range, capped by how much the triggering factors actually heat this place. */
function expectedEffect(typical: EffectRange, heating: number): EffectRange {
  const cap = Math.max(0.1, Math.round(heating * 10) / 10);
  const max = Math.min(typical.max, cap);
  const min = Math.min(typical.min, Math.round((max / 2) * 10) / 10);
  return { min, max };
}

/**
 * A heating contribution is only actionable when the value sits on the problem side of the city mean:
 * if sparse roads "heat" a place, the model is picking up something else (e.g. bare outskirts),
 * and paving advice would be wrong.
 */
function isProblem(trigger: Trigger, input: RecommendationInput): boolean {
  const value = input.values[trigger.key];
  const cityMean = input.cityMeans[trigger.key];
  if (value === undefined || cityMean === undefined || !Number.isFinite(cityMean)) return true;
  return trigger.problem === 'low' ? value < cityMean : value > cityMean;
}

export function recommend(input: RecommendationInput, minContribution = MIN_CONTRIBUTION): Recommendation[] {
  const featureByKey = new Map(input.features.map((f) => [f.key, f]));
  const recommendations: Recommendation[] = [];

  for (const rule of INTERVENTIONS) {
    const reasons = rule.triggers
      .filter((trigger) => (input.contributions[trigger.key] ?? 0) >= minContribution && isProblem(trigger, input))
      .map((trigger) => featureByKey.get(trigger.key))
      .filter((feature): feature is FeatureMeta => feature !== undefined)
      .map((feature) => reasonFor(feature, input))
      .sort((a, b) => b.contribution - a.contribution);
    if (reasons.length === 0) continue;

    const heating = reasons.reduce((sum, r) => sum + r.contribution, 0);
    recommendations.push({
      id: rule.id,
      title: rule.title,
      actions: rule.actions,
      reasons,
      heating,
      effect: expectedEffect(rule.typicalEffect, heating),
    });
  }

  return recommendations.sort((a, b) => b.heating - a.heating);
}

export function formatEffect(effect: EffectRange): string {
  const lo = formatNumber(effect.min, 1);
  const hi = formatNumber(effect.max, 1);
  return effect.min === effect.max ? `до −${hi} °C` : `−${lo}…−${hi} °C`;
}
