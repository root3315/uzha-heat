import type { CityDetail, FeatureMeta } from '../data/contract';
import { causeClause, causeWords, type CauseWords } from './causes';
import { formatDeg, formatDegSigned, formatKm, formatNumber, formatPercent, formatPoints, plural } from './format';
import type { HeatIsland } from './heatIsland';
import { dominantShares, hotTenthPattern, secondCause, type CauseShare, type HotTenthPattern, type Share } from './hotTenth';
import { hottestTenth, type FactorMeans, type PlaceProfile } from './places';
import { recommend, type Evidence } from './recommendations';
import { insideSamples, type Profile } from './transect';

/** A sentence with some spans marked as hot or cool numbers. */
export type Tone = 'hot' | 'cool';
export type Span = string | { text: string; tone: Tone };
export type Phrase = Span[];

const hot = (text: string): Span => ({ text, tone: 'hot' });
const cool = (text: string): Span => ({ text, tone: 'cool' });

export const plainText = (phrase: Phrase): string => phrase.map((span) => (typeof span === 'string' ? span : span.text)).join('');

export const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Genitive of a city name, for "в черте Ташкента". Covers the usual endings. */
export function genitive(name: string): string {
  const last = name.slice(-1);
  const stem = name.slice(0, -1);
  if (last === 'а') return /[гкхжшщч]$/.test(stem) ? `${stem}и` : `${stem}ы`;
  if (last === 'я') return `${stem}и`;
  if (/[бвгджзклмнпрстфхцчшщ]/.test(last)) return `${name}а`;
  return name;
}

/** Prepositional of a city name, for "в Бухаре", "в Ташкенте". Covers the usual endings. */
export function locative(name: string): string {
  if (/[ая]$/.test(name)) return `${name.slice(0, -1)}е`;
  if (/[бвгджзклмнпрстфхцчшщ]$/.test(name)) return `${name}е`;
  return name;
}

function wordsByKey(features: readonly FeatureMeta[]): (key: string) => CauseWords {
  const byKey = new Map(features.map((f) => [f.key, causeWords(f)]));
  return (key) => byKey.get(key) ?? causeWords({ key, label: key, unit: '' });
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

/** "В черте Ташкента поверхность на 1,4° горячее, чем вокруг." Says plainly when the city is the cooler one. */
export function islandAnswer(name: string, island: HeatIsland | null): Phrase {
  if (!island) return [];
  const where = `В черте ${genitive(name)} поверхность`;
  if (Math.abs(island.intensity) < 0.05) return [`${where} такая же, как вокруг.`];
  if (island.intensity > 0) return [`${where} на `, hot(formatDeg(island.intensity)), ' горячее, чем вокруг.'];
  return [`${where} на `, cool(formatDeg(-island.intensity)), ' прохладнее, чем вокруг: голая земля за чертой нагревается сильнее города.'];
}

/** From this share of the hottest tenth outside the city line, the answer says so. */
const MANY_OUTSIDE = 0.2;

const gapPoints = (s: Share) => `${formatNumber(Math.abs(s.hot - s.city), 0)} п.п.`;

function patternSentence({ kind, outsideShare, built, bare }: HotTenthPattern): string {
  if (kind === 'open' && built) {
    const ground = bare && bare.hot > bare.city ? `, голой земли ${formatPercent(bare.hot / 100)} (${formatPoints(bare.hot - bare.city)})` : '';
    const edge = outsideShare >= MANY_OUTSIDE ? ` ${capitalize(formatPercent(outsideShare))} из них за городской чертой.` : '';
    return ` Это в основном открытые, мало застроенные места: застроено ${formatPercent(built.hot / 100)} (${formatPoints(built.hot - built.city)})${ground}.${edge}`;
  }
  if (kind === 'dense-bare' && built && bare) {
    return (
      ` Там плотная застройка вперемешку с голой землёй: застроено ${formatPercent(built.hot / 100)} (${formatPoints(built.hot - built.city)}), ` +
      `голой земли ${formatPercent(bare.hot / 100)} (${formatPoints(bare.hot - bare.city)}).`
    );
  }
  if (kind === 'dense' && built) {
    return ` Это плотная застройка: застроено ${formatPercent(built.hot / 100)}, на ${gapPoints(built)} больше среднего.`;
  }
  if (kind === 'bare' && bare) {
    return ` Там много голой земли: ${formatPercent(bare.hot / 100)}, на ${gapPoints(bare)} больше среднего.`;
  }
  return '';
}

/** The hottest tenth: its threshold, what it is made of and what the model says heats it most often. */
export function hotTenthAnswer(detail: CityDetail, facts: CityFacts): Phrase {
  const phrase: Phrase = ['Каждый десятый участок 200 м горячее ', hot(formatDeg(detail.stats.lstP90)), '.'];
  const pattern = patternSentence(facts.pattern);
  if (pattern) phrase.push(pattern);
  if (!facts.top) return phrase;
  const words = wordsByKey(detail.features);
  let cause = ` Главная причина по модели: ${words(facts.top.key).there}, так в ${formatPercent(facts.top.share)} из них`;
  if (facts.second) cause += `; на втором месте ${words(facts.second.key).there} (${formatPercent(facts.second.share)})`;
  return [...phrase, `${cause}.`];
}

/** The whole answer for a city: the heat island first, then its hottest tenth. */
export function cityAnswer(detail: CityDetail, facts: CityFacts): Phrase {
  const island = islandAnswer(detail.city.name, facts.island);
  const rest = hotTenthAnswer(detail, facts);
  return island.length ? [...island, ' ', ...rest] : rest;
}

/** Below this difference from the city mean, a place is "about average". */
const NEAR_MEAN = 0.5;
/** A cause that explains this much of the excess explains "almost all" of it. */
const MOST_OF_IT = 0.7;

export function placeAnswer(place: PlaceProfile, cityMean: number, features: readonly FeatureMeta[]): Phrase {
  const words = wordsByKey(features);
  const anomaly = place.lst - cityMean;
  if (Math.abs(anomaly) < NEAR_MEAN) {
    const top = strongest(place.contributions, 0);
    const lead = 'Почти как в среднем по городу.';
    if (!top) return [lead];
    return [`${lead} Сильнее всего ${causeClause(words(top[0]), top[1], { one: 'влияет', many: 'влияют' })}.`];
  }
  if (anomaly > 0) {
    const top = strongest(place.contributions, 1);
    const head: Phrase = ['На ', hot(formatDeg(anomaly)), ' жарче, чем в среднем по городу.'];
    if (!top) return head;
    const lead = top[1] / anomaly >= MOST_OF_IT ? 'Почти всё это' : 'Больше всего';
    return [...head, ` ${lead} ${causeClause(words(top[0]), top[1], { one: 'даёт', many: 'дают' })}.`];
  }
  const top = strongest(place.contributions, -1);
  const head: Phrase = ['На ', cool(formatDeg(-anomaly)), ' прохладнее, чем в среднем по городу.'];
  if (!top) return head;
  return [...head, ` Больше всего ${causeClause(words(top[0]), top[1], { one: 'охлаждает', many: 'охлаждают' })}.`];
}

function averageContributions(profile: Profile, samples = insideSamples(profile)): Record<string, number> {
  const sums: Record<string, number> = {};
  for (const sample of samples) {
    for (const [key, value] of Object.entries(sample.contributions ?? {})) sums[key] = (sums[key] ?? 0) + value;
  }
  return Object.fromEntries(Object.entries(sums).map(([key, sum]) => [key, sum / (samples.length || 1)]));
}

/** One or two sentences about the section: how much of it is hot, and what heats it. */
export function sectionAnswer(profile: Profile, cityMean: number, features: readonly FeatureMeta[]): Phrase {
  const words = wordsByKey(features);
  const inside = insideSamples(profile);
  if (inside.length < 3) return ['Разрез прошёл мимо данных.'];
  const hotPart = inside.filter((sample) => sample.t > cityMean);
  if (hotPart.length === 0) {
    const top = strongest(averageContributions(profile, inside), -1);
    const head = 'Весь разрез прохладнее, чем в среднем по городу.';
    return top ? [`${head} Больше всего ${causeClause(words(top[0]), top[1], { one: 'охлаждает', many: 'охлаждают' })}.`] : [head];
  }
  const share = (count: number) => (count / profile.samples.length) * profile.length;
  const peak = Math.max(...hotPart.map((sample) => sample.t));
  const hotM = share(hotPart.length);
  const insideM = share(inside.length);
  const head: Phrase =
    hotPart.length === inside.length
      ? [`Весь разрез, ${formatKm(profile.length)}, жарче среднего, до `, hot(formatDegSigned(peak - cityMean)), '.']
      : [`Жарче среднего ${formatKm(hotM)} из ${formatKm(insideM)}, до `, hot(formatDegSigned(peak - cityMean)), '.'];
  const top = strongest(averageContributions(profile, hotPart), 1);
  if (!top) return head;
  return [...head, ` Там больше всего ${causeClause(words(top[0]), top[1], { one: 'греет', many: 'греют' })}.`];
}

export interface RestOfCauses {
  count: number;
  sum: number;
  summary: string;
}

/** "ещё 7 причин · +4,3°": everything except the dominant cause, folded into one line. */
export function restOfCauses(contributions: Record<string, number>, dominantKey: string): RestOfCauses {
  const others = Object.entries(contributions).filter(([key]) => key !== dominantKey);
  const sum = others.reduce((total, [, value]) => total + value, 0);
  const count = others.length;
  return { count, sum, summary: `ещё ${count} ${plural(count, ['причина', 'причины', 'причин'])} · ${formatDegSigned(sum)}` };
}

/** The cause to show as the one bar: what heats a hot place most, what cools a cool place most. */
export function dominantFor(place: PlaceProfile, cityMean: number): [string, number] | null {
  const heats = place.lst >= cityMean;
  return strongest(place.contributions, heats ? 1 : -1) ?? strongest(place.contributions, 0);
}

export type Advice =
  | { kind: 'act'; title: string; actions: string[]; reason: Phrase; heating: number; evidence: Evidence }
  | { kind: 'none'; text: Phrase };

/**
 * What to do here, and why, in this place's own numbers. When nothing applies, the text
 * says why, from the contributions themselves; it never claims a factor cools unless it does.
 */
export function advise(detail: CityDetail, place: PlaceProfile, cityMeans: FactorMeans): Advice {
  const words = wordsByKey(detail.features);
  const [first] = recommend({ features: detail.features, values: place.values, contributions: place.contributions, cityMeans });
  const where = place.kind === 'hotspot' ? 'В горячей десятой части' : 'Здесь';

  if (first) {
    const key = first.reasons[0]?.key ?? '';
    const reason: Phrase = [`${where} ${words(key).measure(place.values[key] ?? Number.NaN)}, по модели это даёт `, hot(formatDegSigned(place.contributions[key] ?? 0)), '.'];
    return { kind: 'act', title: first.title, actions: first.actions, reason, heating: first.heating, evidence: first.evidence };
  }

  if (place.lst < detail.stats.lstMean) {
    const top = strongest(place.contributions, -1);
    const head = place.kind === 'hotspot' ? 'Менять нечего.' : 'Здесь прохладнее среднего, менять нечего.';
    if (!top || !words(top[0]).better) return { kind: 'none', text: [head] };
    return { kind: 'none', text: [`${head} Стоит сохранить то, что охлаждает: ${words(top[0]).cools}, `, cool(formatDegSigned(top[1])), '.'] };
  }

  const top = strongest(place.contributions, 1);
  if (!top) return { kind: 'none', text: ['Ни один фактор не греет это место заметно, явной меры нет.'] };
  const w = words(top[0]);
  if (!w.better) {
    const verb = w.plural ? 'добавляют' : 'добавляет';
    const tail = w.explain ? `. ${w.explain}` : ', а это благоустройством не изменить.';
    return { kind: 'none', text: [`${capitalize(w.heats)} ${verb} здесь `, hot(formatDegSigned(top[1])), tail] };
  }
  return { kind: 'none', text: [`Явной меры нет: ${w.heats} здесь не хуже, чем в среднем по городу.`] };
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
  elevation: 'Copernicus DEM',
};

/** The quiet last line: where the numbers come from and how far to trust them. */
export function sourcesLine(detail: CityDetail): string {
  const sources = ['NASA/USGS Landsat 8/9', ...new Set(detail.features.map((f) => SOURCE_BY_KEY[f.key]).filter((s): s is string => Boolean(s)))];
  if (detail.features.some((f) => f.key === 'water_dist') && !sources.includes('OpenStreetMap')) sources.push('OpenStreetMap');
  if (detail.population) sources.push(`WorldPop ${detail.population.year}`);
  const { model } = detail;
  return (
    `${sources.join(', ')}, ${detail.period.label}. ` +
    `R² ${formatNumber(model.r2Cv, 2)} на пространственной проверке, ошибка ~${formatDeg(model.maeCv)}. ` +
    'Вклад факторов показывает связь, а не эксперимент.'
  );
}

