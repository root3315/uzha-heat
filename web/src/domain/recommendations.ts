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
  /** e.g. "NDVI 0,08, в 3 раза ниже среднего по городу (0,24)" */
  text: string;
  /** °C this factor adds to the place's temperature. */
  contribution: number;
}

/** What published reviews say about a measure, with the source to check it. No number we could not verify. */
export interface Evidence {
  finding: string;
  cite: string;
  url: string;
}

export interface Recommendation {
  id: string;
  title: string;
  actions: string[];
  reasons: Reason[];
  /** Sum of the positive contributions that triggered this recommendation, °C. */
  heating: number;
  evidence: Evidence;
}

/** Which side of the city mean makes a factor a problem that the intervention addresses. */
type ProblemSide = 'low' | 'high';

interface Trigger {
  key: string;
  problem: ProblemSide;
  /** Another factor that must also be on its problem side, e.g. dark roofs only count where there are roofs. */
  alongWith?: { key: string; problem: ProblemSide };
}

interface InterventionRule {
  id: string;
  title: string;
  actions: string[];
  triggers: Trigger[];
  evidence: Evidence;
}

const KNIGHT_2021 = { cite: 'Knight и др., 2021, Environmental Evidence', url: 'https://doaj.org/article/a25650e3e71d43f1bf66e2651063233f' };

/**
 * Interventions keyed by the factors that make them relevant. Factors without a rule
 * (e.g. elevation) describe the setting and are not actionable.
 */
export const INTERVENTIONS: readonly InterventionRule[] = [
  {
    id: 'shade-trees',
    title: 'Деревья вдоль улиц и теневые навесы',
    actions: [
      'высадить крупномерные деревья вдоль тротуаров и во дворах: чинара, карагач, тут',
      'навесы и перголы над остановками, рынками и детскими площадками',
    ],
    triggers: [
      { key: 'ndvi', problem: 'low' },
      { key: 'tree', problem: 'low' },
    ],
    evidence: { finding: 'по обзору 308 исследований, под деревьями воздух в среднем на 0,8° прохладнее', ...KNIGHT_2021 },
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
      // Low albedo is a roof problem only where there are roofs; elsewhere dark ground is usually green.
      { key: 'albedo', problem: 'low', alongWith: { key: 'built', problem: 'high' } },
    ],
    evidence: {
      finding: 'по обзору моделей городов, зелёные крыши снижают температуру воздуха на 0,3–3°',
      cite: 'Santamouris, 2014, Solar Energy',
      url: 'https://doi.org/10.1016/j.solener.2012.07.003',
    },
  },
  {
    id: 'shade-dense-blocks',
    title: 'Тень и улицы в плотных кварталах',
    actions: [
      'между высокими домами узкие улицы и дворы, галереи и навесы, чтобы дома затеняли тротуары и друг друга',
      'новые улицы вести по оси север–юг или наискось, а не с востока на запад',
    ],
    triggers: [
      { key: 'volume', problem: 'high' },
      { key: 'height', problem: 'high', alongWith: { key: 'volume', problem: 'high' } },
    ],
    evidence: {
      finding:
        'по моделированию для жаркого сухого климата, тепловой стресс днём зависит от высоты домов к ширине улицы и её направления: открытые улицы и улицы с востока на запад жарче всего, глубокие и затенённые прохладнее',
      cite: 'Ali-Toudert и Mayer, 2006, Building and Environment',
      url: 'https://doi.org/10.1016/j.buildenv.2005.01.013',
    },
  },
  {
    id: 'cool-pavements',
    title: 'Затенение и светлые покрытия дорог',
    actions: ['светлый или проницаемый асфальт на парковках и тротуарах', 'деревья по разделительным полосам'],
    triggers: [{ key: 'roads', problem: 'high' }],
    evidence: {
      finding: 'по обзору, светлые и проницаемые покрытия нагреваются меньше обычного асфальта, насколько зависит от материала',
      cite: 'Santamouris, 2013, Renewable and Sustainable Energy Reviews',
      url: 'https://doi.org/10.1016/j.rser.2013.05.047',
    },
  },
  {
    id: 'cover-bare-soil',
    title: 'Закрыть открытый грунт',
    actions: [
      'засухоустойчивый газон и почвопокровные растения на пустырях',
      'пылеподавление и озеленение промзон и обочин',
    ],
    triggers: [{ key: 'bare', problem: 'high' }],
    evidence: { finding: 'по обзору 308 исследований, участки с травой в среднем на 0,6° прохладнее незелёных', ...KNIGHT_2021 },
  },
  {
    id: 'water',
    title: 'Вода рядом: арыки, фонтаны, полив',
    actions: [
      'восстановить арычную сеть и капельный полив скверов',
      'фонтаны и открытые водоёмы в общественных пространствах',
    ],
    triggers: [{ key: 'water_dist', problem: 'high' }],
    evidence: {
      finding: 'по обзору, у воды воздух прохладнее, но насколько, сильно зависит от ветра и застройки вокруг',
      cite: 'Völker и др., 2013, Erdkunde',
      url: 'https://doi.org/10.3112/erdkunde.2013.04.05',
    },
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
  if (!Number.isFinite(cityMean) || cityMean <= 0 || value < 0) return `в среднем по городу ${meanText}`;
  const relative = (value - cityMean) / cityMean;
  if (Math.abs(relative) < NEAR_MEAN_SHARE) return `на уровне среднего по городу (${meanText})`;
  if (value <= cityMean * ALMOST_NONE_SHARE) return `почти нет, в среднем по городу ${meanText}`;
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
    text: `${factorName(feature)} ${formatFactorValue(feature, value)}, ${compareWithCity(feature, value, cityMean)}`,
    contribution: input.contributions[feature.key] ?? 0,
  };
}

/**
 * A heating contribution is only actionable when the value sits on the problem side of the city mean:
 * if sparse roads "heat" a place, the model is picking up something else (e.g. bare outskirts),
 * and paving advice would be wrong.
 */
function onProblemSide(key: string, problem: ProblemSide, input: RecommendationInput): boolean {
  const value = input.values[key];
  const cityMean = input.cityMeans[key];
  if (value === undefined || cityMean === undefined || !Number.isFinite(cityMean)) return true;
  return problem === 'low' ? value < cityMean : value > cityMean;
}

function isProblem(trigger: Trigger, input: RecommendationInput): boolean {
  const { alongWith } = trigger;
  if (alongWith && !(alongWith.key in input.values && onProblemSide(alongWith.key, alongWith.problem, input))) return false;
  return onProblemSide(trigger.key, trigger.problem, input);
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
      evidence: rule.evidence,
    });
  }

  return recommendations.sort((a, b) => b.heating - a.heating);
}
