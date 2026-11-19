import type { CityDetail, FeatureMeta } from '../data/contract';
import type { Locale } from '../i18n/locale';
import { ANSWER_TEXTS } from './answers.texts';
import { causeWords, type CauseWords } from './causes';
import { cityName, periodText } from './dataTexts';
import { formats } from './format';
import type { HeatIsland } from './heatIsland';
import { dominantShares, hotTenthPattern, secondCause, type CauseShare, type HotTenthPattern, type Share } from './hotTenth';
import { cool, hot, type Phrase } from './phrase';
import { hottestTenth, type FactorMeans, type PlaceProfile } from './places';
import { recommend, type Evidence } from './recommendations';
import { insideSamples, type Profile } from './transect';

function wordsByKey(features: readonly FeatureMeta[], locale: Locale): (key: string) => CauseWords {
  const byKey = new Map(features.map((f) => [f.key, causeWords(f, locale)]));
  return (key) => byKey.get(key) ?? causeWords({ key, label: key, unit: '' }, locale);
}

function strongest(contributions: Record<string, number>, sign: 1 | -1 | 0): [string, number] | null {
  let best: [string, number] | null = null;
  for (const [key, value] of Object.entries(contributions)) {
    const score = sign === 0 ? Math.abs(value) : sign * value;
    if (score <= 0 && sign !== 0) continue;
    if (!best || score > (sign === 0 ? Math.abs(best[1]) : sign * best[1])) best = [key, value];
  }
  return best;
}

export interface CityFacts {
  /** The factor that most often heats a cell of the hottest tenth most, and how often. */
  top: CauseShare | null;
  second: CauseShare | null;
  pattern: HotTenthPattern;
  island: HeatIsland | null;
}

export function cityFacts(detail: CityDetail, inside: readonly boolean[], island: HeatIsland | null): CityFacts {
  const members = hottestTenth(detail);
  const shares = dominantShares(detail, members);
  return {
    top: shares[0] ?? null,
    second: secondCause(detail, members, shares),
    pattern: hotTenthPattern(detail, members, inside),
    island,
  };
}

/** "Within Tashkent, the surface is 1.4° hotter than around the city." Says plainly when the city is the cooler one. */
export function islandAnswer(name: string, island: HeatIsland | null, locale: Locale): Phrase {
  if (!island) return [];
  const t = ANSWER_TEXTS[locale].island;
  const { formatDeg } = formats(locale);
  if (Math.abs(island.intensity) < 0.05) return t.same(name);
  if (island.intensity > 0) return t.hotter(name, hot(formatDeg(island.intensity)));
  return t.cooler(name, cool(formatDeg(-island.intensity)));
}

/** From this share of the hottest tenth outside the city line, the answer says so. */
const MANY_OUTSIDE = 0.2;

function patternSentence({ kind, outsideShare, built, bare }: HotTenthPattern, locale: Locale): string {
  const t = ANSWER_TEXTS[locale].pattern;
  const { formatNumber, formatPercent, formatPoints } = formats(locale);
  const share = (s: Share) => formatPercent(s.hot / 100);
  const gap = (s: Share) => formatPoints(s.hot - s.city);
  const gapPoints = (s: Share) => t.gap(formatNumber(Math.abs(s.hot - s.city), 0));
  if (kind === 'open' && built) {
    const ground = bare && bare.hot > bare.city ? { share: share(bare), gap: gap(bare) } : null;
    return t.open(share(built), gap(built), ground, outsideShare >= MANY_OUTSIDE ? formatPercent(outsideShare) : null);
  }
  if (kind === 'dense-bare' && built && bare) return t.denseBare(share(built), gap(built), share(bare), gap(bare));
  if (kind === 'dense' && built) return t.dense(share(built), gapPoints(built));
  if (kind === 'bare' && bare) return t.bare(share(bare), gapPoints(bare));
  return '';
}

/** The hottest tenth: its threshold, what it is made of and what the model says heats it most often. */
export function hotTenthAnswer(detail: CityDetail, facts: CityFacts, locale: Locale): Phrase {
  const t = ANSWER_TEXTS[locale].hotTenth;
  const { formatTemp, formatPercent } = formats(locale);
  const phrase: Phrase = t.head(hot(formatTemp(detail.stats.lstP90)));
  const pattern = patternSentence(facts.pattern, locale);
  if (pattern) phrase.push(pattern);
  if (!facts.top) return phrase;
  const words = wordsByKey(detail.features, locale);
  const second = facts.second ? { there: words(facts.second.key).there, share: formatPercent(facts.second.share) } : null;
  return [...phrase, t.cause(words(facts.top.key).there, formatPercent(facts.top.share), second)];
}

/** The whole answer for a city: the heat island first, then its hottest tenth. */
export function cityAnswer(detail: CityDetail, facts: CityFacts, locale: Locale): Phrase {
  const island = islandAnswer(cityName(detail.city, locale), facts.island, locale);
  const rest = hotTenthAnswer(detail, facts, locale);
  return island.length ? [...island, ' ', ...rest] : rest;
}

/** Below this difference from the city mean, a place is "about average". */
const NEAR_MEAN = 0.5;
/** A cause that explains this much of the excess explains "almost all" of it. */
const MOST_OF_IT = 0.7;

export function placeAnswer(place: PlaceProfile, cityMean: number, features: readonly FeatureMeta[], locale: Locale): Phrase {
  const t = ANSWER_TEXTS[locale].place;
  const { formatDeg } = formats(locale);
  const words = wordsByKey(features, locale);
  const anomaly = place.lst - cityMean;
  if (Math.abs(anomaly) < NEAR_MEAN) {
    const top = strongest(place.contributions, 0);
    if (!top) return [t.nearMean];
    return [`${t.nearMean}${t.nearMeanCause({ words: words(top[0]), value: top[1] })}`];
  }
  if (anomaly > 0) {
    const top = strongest(place.contributions, 1);
    const head = t.hotter(hot(formatDeg(anomaly)));
    if (!top) return head;
    return [...head, t.hotterCause({ words: words(top[0]), value: top[1] }, top[1] / anomaly >= MOST_OF_IT)];
  }
  const top = strongest(place.contributions, -1);
  const head = t.cooler(cool(formatDeg(-anomaly)));
  if (!top) return head;
  return [...head, t.coolerCause({ words: words(top[0]), value: top[1] })];
}

function averageContributions(profile: Profile, samples = insideSamples(profile)): Record<string, number> {
  const sums: Record<string, number> = {};
  for (const sample of samples) {
    for (const [key, value] of Object.entries(sample.contributions ?? {})) sums[key] = (sums[key] ?? 0) + value;
  }
  return Object.fromEntries(Object.entries(sums).map(([key, sum]) => [key, sum / (samples.length || 1)]));
}

/** One or two sentences about the section: how much of it is hot, and what heats it. */
export function sectionAnswer(profile: Profile, cityMean: number, features: readonly FeatureMeta[], locale: Locale): Phrase {
  const t = ANSWER_TEXTS[locale].section;
  const { formatDegSigned, formatKm } = formats(locale);
  const words = wordsByKey(features, locale);
  const inside = insideSamples(profile);
  if (inside.length < 3) return [t.missed];
  const hotPart = inside.filter((sample) => sample.t > cityMean);
  if (hotPart.length === 0) {
    const top = strongest(averageContributions(profile, inside), -1);
    return top ? [`${t.allCool}${t.allCoolCause({ words: words(top[0]), value: top[1] })}`] : [t.allCool];
  }
  const share = (count: number) => (count / profile.samples.length) * profile.length;
  const peak = hot(formatDegSigned(Math.max(...hotPart.map((sample) => sample.t)) - cityMean));
  const head =
    hotPart.length === inside.length
      ? t.allHot(formatKm(profile.length), peak)
      : t.partHot(formatKm(share(hotPart.length)), formatKm(share(inside.length)), peak);
  const top = strongest(averageContributions(profile, hotPart), 1);
  if (!top) return head;
  return [...head, t.hotCause({ words: words(top[0]), value: top[1] })];
}

export interface RestOfCauses {
  count: number;
  sum: number;
  summary: string;
}

/** Contributions this small print as "0.0°": they say nothing and are left out of lists. */
export const NEGLIGIBLE_DEG = 0.05;

export const isNegligible = (value: number): boolean => Math.abs(value) < NEGLIGIBLE_DEG;

/**
 * What the contributions leave of a place's difference from the city mean: the model's own error there plus the gap
 * between its base value and the city mean. Shown so the causes add up to the headline difference.
 */
export function unexplainedPart(place: PlaceProfile, cityMean: number): number {
  const explained = Object.values(place.contributions).reduce((total, value) => total + value, 0);
  return place.lst - cityMean - explained;
}

/** "7 more causes · +4.3°": everything except the dominant cause, folded into one line; causes that round to 0.0° are not counted. */
export function restOfCauses(contributions: Record<string, number>, dominantKey: string, locale: Locale): RestOfCauses {
  const others = Object.entries(contributions).filter(([key]) => key !== dominantKey);
  const sum = others.reduce((total, [, value]) => total + value, 0);
  const count = others.filter(([, value]) => !isNegligible(value)).length;
  return { count, sum, summary: ANSWER_TEXTS[locale].rest(count, formats(locale).formatDegSigned(sum)) };
}

/**
 * The cause to show as the one bar: what heats a hot place most, what cools a cool place most,
 * and for a place about the city mean the largest either way, the same cause `placeAnswer` names.
 */
export function dominantFor(place: PlaceProfile, cityMean: number): [string, number] | null {
  const anomaly = place.lst - cityMean;
  if (Math.abs(anomaly) < NEAR_MEAN) return strongest(place.contributions, 0);
  return strongest(place.contributions, anomaly > 0 ? 1 : -1) ?? strongest(place.contributions, 0);
}

export type Advice =
  | { kind: 'act'; title: string; actions: string[]; reason: Phrase; heating: number; evidence: Evidence }
  | { kind: 'none'; text: Phrase };

/**
 * What to do here, and why, in this place's own numbers. When nothing applies, the text
 * says why, from the contributions themselves; it never claims a factor cools unless it does.
 */
export function advise(detail: CityDetail, place: PlaceProfile, cityMeans: FactorMeans, locale: Locale): Advice {
  const t = ANSWER_TEXTS[locale].advice;
  const { formatDegSigned } = formats(locale);
  const words = wordsByKey(detail.features, locale);
  const [first] = recommend({ features: detail.features, values: place.values, contributions: place.contributions, cityMeans }, locale);
  const where = place.kind === 'hotspot' ? t.whereHotspot : t.whereHere;

  if (first) {
    const key = first.reasons[0]?.key ?? '';
    const reason = t.reason(where, words(key).measure(place.values[key] ?? Number.NaN), hot(formatDegSigned(place.contributions[key] ?? 0)));
    return { kind: 'act', title: first.title, actions: first.actions, reason, heating: first.heating, evidence: first.evidence };
  }

  if (place.lst - detail.stats.lstMean <= -NEAR_MEAN) {
    const top = strongest(place.contributions, -1);
    const head = place.kind === 'hotspot' ? t.nothingHotspot : t.nothingCool;
    if (!top || !words(top[0]).better) return { kind: 'none', text: [head] };
    return { kind: 'none', text: t.keep(head, words(top[0]).cools, cool(formatDegSigned(top[1]))) };
  }

  const top = strongest(place.contributions, 1);
  if (!top) return { kind: 'none', text: [t.noHeat] };
  const w = words(top[0]);
  if (!w.better) return { kind: 'none', text: t.notLever(w, hot(formatDegSigned(top[1]))) };
  return { kind: 'none', text: [t.noClear(w.heats)] };
}

const SOURCE_BY_KEY: Record<string, string> = {
  ndvi: 'Sentinel-2',
  albedo: 'Sentinel-2',
  tree: 'ESA WorldCover',
  built: 'ESA WorldCover',
  bare: 'ESA WorldCover',
  water_dist: 'ESA WorldCover',
  roads: 'OpenStreetMap',
  buildings: 'OpenStreetMap',
  height: 'GHSL',
  volume: 'GHSL',
  elevation: 'Copernicus DEM',
};

/** The quiet last line: where the numbers come from and how far to trust them. */
export function sourcesLine(detail: CityDetail, locale: Locale): string {
  const sources = ['NASA/USGS Landsat 8/9', ...new Set(detail.features.map((f) => SOURCE_BY_KEY[f.key]).filter((s): s is string => Boolean(s)))];
  if (detail.features.some((f) => f.key === 'water_dist') && !sources.includes('OpenStreetMap')) sources.push('OpenStreetMap');
  if (detail.population) sources.push(`WorldPop ${detail.population.year}`);
  const { formatPercent, formatTemp } = formats(locale);
  const { model } = detail;
  return ANSWER_TEXTS[locale].sources(sources.join(', '), periodText(detail.period.label, locale), formatPercent(model.r2Cv), formatTemp(model.maeCv));
}
