import type { FeatureMeta } from '../data/contract';
import { formatNumber } from './format';

const NBSP = ' ';

/** How one factor reads as a cause of heat, in both directions. */
export interface CauseWords {
  /** Subject of "даёт …" when it heats: "нехватка зелени". */
  heats: string;
  /** Subject of "охлаждает …" when it cools: "зелень". */
  cools: string;
  /** Inline label on the ribbon and in lists. */
  heatsShort: string;
  coolsShort: string;
  /** Completes "там …" for the city sentence: "там мало зелени". */
  there: string;
  /** Plural subjects take plural verbs ("дают тёмные покрытия"). */
  plural?: boolean;
  /** Which way cools: more of it (`up`), less of it (`down`), or not something to change. */
  better: 'up' | 'down' | null;
  /** The value in plain terms: "NDVI 0,12". */
  measure(value: number): string;
  /** A group of places on the cooler side of `threshold`: "NDVI выше 0,40". */
  peers(threshold: number): string;
}

const pct = (v: number) => `${formatNumber(v, 0)}${NBSP}%`;

const WORDS: Record<string, CauseWords> = {
  ndvi: {
    heats: 'нехватка зелени',
    cools: 'зелень',
    heatsShort: 'мало зелени',
    coolsShort: 'зелень',
    there: 'мало зелени',
    better: 'up',
    measure: (v) => `NDVI ${formatNumber(v, 2)}`,
    peers: (t) => `NDVI выше ${formatNumber(t, 2)}`,
  },
  tree: {
    heats: 'нехватка деревьев',
    cools: 'тень деревьев',
    heatsShort: 'нет деревьев',
    coolsShort: 'деревья',
    there: 'нет деревьев',
    better: 'up',
    measure: (v) => `деревья на ${pct(v)} площади`,
    peers: (t) => `деревья занимают больше ${pct(t)}`,
  },
  built: {
    heats: 'плотная застройка',
    cools: 'редкая застройка',
    heatsShort: 'застройка',
    coolsShort: 'мало застройки',
    there: 'сплошная застройка',
    better: 'down',
    measure: (v) => `застроено ${pct(v)}`,
    peers: (t) => `застроено меньше ${pct(Math.max(t, 1))}`,
  },
  bare: {
    heats: 'голая земля',
    cools: 'закрытый грунт',
    heatsShort: 'голая земля',
    coolsShort: 'грунт закрыт',
    there: 'голая земля',
    better: 'down',
    measure: (v) => `голой земли ${pct(v)}`,
    peers: (t) => (t < 0.5 ? 'голой земли нет' : `голой земли меньше ${pct(t)}`),
  },
  albedo: {
    // In these cities albedo rises with temperature (bright bare soil is hot), so the words stay neutral
    // and never promise that light surfaces cool.
    heats: 'отражающая способность поверхности',
    cools: 'отражающая способность поверхности',
    heatsShort: 'альбедо',
    coolsShort: 'альбедо',
    there: 'яркая открытая поверхность',
    better: 'up',
    measure: (v) => `альбедо ${formatNumber(v, 2)}`,
    peers: (t) => `альбедо выше ${formatNumber(t, 2)}`,
  },
  roads: {
    heats: 'плотная сеть дорог',
    cools: 'редкая сеть дорог',
    heatsShort: 'дороги',
    coolsShort: 'мало дорог',
    there: 'много дорог',
    better: 'down',
    measure: (v) => `${formatNumber(v, 1)}${NBSP}км дорог на км²`,
    peers: (t) => `дорог меньше ${formatNumber(Math.max(t, 0.5), 1)}${NBSP}км на км²`,
  },
  buildings: {
    heats: 'плотность зданий',
    cools: 'мало зданий',
    heatsShort: 'здания',
    coolsShort: 'мало зданий',
    there: 'много зданий',
    better: 'down',
    measure: (v) => `${formatNumber(v, 1)} зданий на га`,
    peers: (t) => `зданий меньше ${formatNumber(Math.max(t, 0.5), 1)} на га`,
  },
  water_dist: {
    heats: 'удалённость от воды',
    cools: 'близость воды',
    heatsShort: 'далеко от воды',
    coolsShort: 'вода рядом',
    there: 'далеко до воды',
    better: 'down',
    measure: (v) => (v >= 1000 ? `до воды ${formatNumber(v / 1000, 1)}${NBSP}км` : `до воды ${formatNumber(Math.round(v / 10) * 10, 0)}${NBSP}м`),
    peers: (t) => `вода ближе ${formatNumber(Math.max(10, Math.round(t / 10) * 10), 0)}${NBSP}м`,
  },
  elevation: {
    heats: 'рельеф',
    cools: 'рельеф',
    heatsShort: 'рельеф',
    coolsShort: 'рельеф',
    there: 'так сложился рельеф',
    better: null,
    measure: (v) => `высота ${formatNumber(v, 0)}${NBSP}м`,
    peers: () => '',
  },
};

/** Words for any factor; keys outside the fixed vocabulary fall back to the label from the data. */
export function causeWords(feature: Pick<FeatureMeta, 'key' | 'label' | 'unit'>): CauseWords {
  const known = WORDS[feature.key];
  if (known) return known;
  const label = feature.label.toLowerCase();
  return {
    heats: label,
    cools: label,
    heatsShort: label,
    coolsShort: label,
    there: label,
    better: null,
    measure: (v) => `${feature.label} ${formatNumber(v, 2)} ${feature.unit}`.trim(),
    peers: () => '',
  };
}

/** "мало зелени" when the factor heats, "зелень" when it cools. */
export function causeLabel(words: CauseWords, value: number): string {
  return value >= 0 ? words.heatsShort : words.coolsShort;
}

/** Subject phrase with a verb that agrees with it: "даёт нехватка зелени", "охлаждают светлые покрытия". */
export function causeClause(words: CauseWords, value: number, verbs: { one: string; many: string }): string {
  return `${words.plural ? verbs.many : verbs.one} ${value >= 0 ? words.heats : words.cools}`;
}
