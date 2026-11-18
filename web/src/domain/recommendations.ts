import type { FeatureMeta } from '../data/contract';
import type { Locale } from '../i18n/locale';
import { featureLabel } from './dataTexts';
import { formats } from './format';
import { COMPARE_TEXTS, INTERVENTION_TEXTS, type InterventionId } from './recommendations.texts';

export interface RecommendationInput {
  features: FeatureMeta[];
  values: Record<string, number>;
  contributions: Record<string, number>;
  cityMeans: Record<string, number>;
}

export interface Reason {
  key: string;
  /** e.g. "NDVI 0.08, 3 times lower than the city average (0.24)" */
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
  id: InterventionId;
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

/** A measure and the factors that make it relevant; its words are in `recommendations.texts.ts`, keyed by `id`. */
export interface InterventionRule {
  id: InterventionId;
  triggers: Trigger[];
  /** Where to check the evidence. */
  url: string;
}

const KNIGHT_2021 = 'https://doi.org/10.1186/s13750-021-00226-y';

/**
 * Interventions keyed by the factors that make them relevant. Factors without a rule
 * (e.g. elevation) describe the setting and are not actionable.
 */
export const INTERVENTIONS: readonly InterventionRule[] = [
  {
    id: 'shade-trees',
    triggers: [
      { key: 'ndvi', problem: 'low' },
      { key: 'tree', problem: 'low' },
    ],
    url: KNIGHT_2021,
  },
  {
    id: 'cool-roofs',
    triggers: [
      { key: 'built', problem: 'high' },
      { key: 'buildings', problem: 'high' },
      // Low albedo is a roof problem only where there are roofs; elsewhere dark ground is usually green.
      { key: 'albedo', problem: 'low', alongWith: { key: 'built', problem: 'high' } },
    ],
    url: 'https://doi.org/10.1016/j.solener.2012.07.003',
  },
  {
    id: 'shade-dense-blocks',
    triggers: [
      { key: 'volume', problem: 'high' },
      { key: 'height', problem: 'high', alongWith: { key: 'volume', problem: 'high' } },
    ],
    url: 'https://doi.org/10.1016/j.buildenv.2005.01.013',
  },
  {
    id: 'cool-pavements',
    triggers: [{ key: 'roads', problem: 'high' }],
    url: 'https://doi.org/10.1016/j.rser.2013.05.047',
  },
  {
    id: 'cover-bare-soil',
    triggers: [{ key: 'bare', problem: 'high' }],
    url: KNIGHT_2021,
  },
  {
    id: 'water',
    triggers: [{ key: 'water_dist', problem: 'high' }],
    url: 'https://doi.org/10.3112/erdkunde.2013.04.05',
  },
];

/** The evidence for a measure in the reader's language. */
export function evidenceFor(rule: InterventionRule, locale: Locale): Evidence {
  const { finding, cite } = INTERVENTION_TEXTS[locale][rule.id];
  return { finding, cite, url: rule.url };
}

const MIN_CONTRIBUTION = 0.15;
const NEAR_MEAN_SHARE = 0.1;
const ALMOST_NONE_SHARE = 0.05;

/** "в 3 раза", "3 times": a ratio rounded to what it can say. */
export function formatRatio(ratio: number, locale: Locale): string {
  const rounded = Math.round(ratio * 10) / 10;
  const digits = Number.isInteger(rounded) || rounded >= 10 ? 0 : 1;
  const n = digits === 0 ? Math.round(rounded) : rounded;
  return COMPARE_TEXTS[locale].times(n, formats(locale).formatNumber(n, digits));
}

/** Plain-language comparison of a place's value with the city mean. */
export function compareWithCity(feature: FeatureMeta, value: number, cityMean: number, locale: Locale): string {
  const t = COMPARE_TEXTS[locale];
  const { formatFactorValue, formatNumber } = formats(locale);
  const meanText = formatFactorValue(feature, cityMean);
  if (!Number.isFinite(cityMean) || cityMean <= 0 || value < 0) return t.unknownMean(meanText);
  const relative = (value - cityMean) / cityMean;
  if (Math.abs(relative) < NEAR_MEAN_SHARE) return t.nearMean(meanText);
  if (value <= cityMean * ALMOST_NONE_SHARE) return t.almostNone(meanText);
  const ratio = relative < 0 ? cityMean / value : value / cityMean;
  const amount =
    ratio >= 1.5
      ? ({ kind: 'times', text: formatRatio(ratio, locale) } as const)
      : ({ kind: 'percent', text: t.percent(formatNumber(Math.abs(relative) * 100, 0)) } as const);
  return t.differs(amount, relative < 0, meanText);
}

function factorName(feature: FeatureMeta, locale: Locale): string {
  return feature.unit === 'NDVI' ? 'NDVI' : featureLabel(feature, locale);
}

function reasonFor(feature: FeatureMeta, input: RecommendationInput, locale: Locale): Reason {
  const value = input.values[feature.key] ?? Number.NaN;
  const cityMean = input.cityMeans[feature.key] ?? Number.NaN;
  const { formatFactorValue } = formats(locale);
  return {
    key: feature.key,
    text: `${factorName(feature, locale)} ${formatFactorValue(feature, value)}, ${compareWithCity(feature, value, cityMean, locale)}`,
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

export function recommend(input: RecommendationInput, locale: Locale, minContribution = MIN_CONTRIBUTION): Recommendation[] {
  const featureByKey = new Map(input.features.map((f) => [f.key, f]));
  const recommendations: Recommendation[] = [];

  for (const rule of INTERVENTIONS) {
    const reasons = rule.triggers
      .filter((trigger) => (input.contributions[trigger.key] ?? 0) >= minContribution && isProblem(trigger, input))
      .map((trigger) => featureByKey.get(trigger.key))
      .filter((feature): feature is FeatureMeta => feature !== undefined)
      .map((feature) => reasonFor(feature, input, locale))
      .sort((a, b) => b.contribution - a.contribution);
    if (reasons.length === 0) continue;

    const { title, actions } = INTERVENTION_TEXTS[locale][rule.id];
    const heating = reasons.reduce((sum, r) => sum + r.contribution, 0);
    recommendations.push({ id: rule.id, title, actions, reasons, heating, evidence: evidenceFor(rule, locale) });
  }

  return recommendations.sort((a, b) => b.heating - a.heating);
}
