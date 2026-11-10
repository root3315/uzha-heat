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
  /** For a factor that is not a lever: one plain sentence on what the number really shows. */
  explain?: string;
  /** The value in plain terms: "NDVI 0,12". */
  measure(value: number): string;
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
  },
  tree: {
    heats: 'нехватка деревьев',
    cools: 'тень деревьев',
    heatsShort: 'нет деревьев',
    coolsShort: 'деревья',
    there: 'нет деревьев',
    better: 'up',
    measure: (v) => `деревья на ${pct(v)} площади`,
  },
  built: {
    heats: 'плотная застройка',
    cools: 'редкая застройка',
    heatsShort: 'застройка',
    coolsShort: 'мало застройки',
    there: 'сплошная застройка',
    better: 'down',
    measure: (v) => `застроено ${pct(v)}`,
  },
  bare: {
    heats: 'голая земля',
    cools: 'закрытый грунт',
    heatsShort: 'голая земля',
    coolsShort: 'грунт закрыт',
    there: 'голая земля',
    better: 'down',
    measure: (v) => `голой земли ${pct(v)}`,
  },
  albedo: {
    // In all three cities albedo rises with temperature: the brightest surface is bare dry soil, and it is the hottest.
    // So albedo is read as a sign of open ground, never as a lever, and never as "light surfaces heat".
    heats: 'яркая открытая поверхность',
    cools: 'тёмная поверхность',
    heatsShort: 'яркий грунт',
    coolsShort: 'тёмная поверхность',
    there: 'яркая открытая земля',
    better: null,
    explain:
      'Высокое альбедо здесь значит открытую сухую землю: в этих городах светлее всего голый грунт, он же и горячее всего. Светлые поверхности сами по себе не греют, помогает закрыть грунт зеленью.',
    measure: (v) => `альбедо ${formatNumber(v, 2)}`,
  },
  roads: {
    heats: 'плотная сеть дорог',
    cools: 'редкая сеть дорог',
    heatsShort: 'дороги',
    coolsShort: 'мало дорог',
    there: 'много дорог',
    better: 'down',
    measure: (v) => `${formatNumber(v, 1)}${NBSP}км дорог на км²`,
  },
  buildings: {
    heats: 'плотность зданий',
    cools: 'мало зданий',
    heatsShort: 'здания',
    coolsShort: 'мало зданий',
    there: 'много зданий',
    better: 'down',
    measure: (v) => `${formatNumber(v, 1)} зданий на га`,
  },
  height: {
    heats: 'высокая застройка',
    cools: 'тень высоких домов',
    heatsShort: 'высокие дома',
    coolsShort: 'тень домов',
    there: 'высокие дома',
    better: null,
    explain:
      'Высокие дома и греют, и затеняют: днём их тень остужает двор и улицу, а стены и крыши копят тепло. Что перевешивает, зависит от квартала, поэтому высоту читаем вместе с объёмом застройки.',
    measure: (v) => `дома в среднем ${formatNumber(v, 0)}${NBSP}м высотой`,
  },
  volume: {
    heats: 'плотная масса домов',
    cools: 'просторная застройка',
    heatsShort: 'плотная застройка',
    coolsShort: 'просторно',
    there: 'плотная масса домов',
    better: 'down',
    measure: (v) => `${formatNumber(Math.round(v / 100) * 100, 0)}${NBSP}м³ зданий на га`,
  },
  water_dist: {
    heats: 'удалённость от воды',
    cools: 'близость воды',
    heatsShort: 'далеко от воды',
    coolsShort: 'вода рядом',
    there: 'далеко до воды',
    better: 'down',
    measure: (v) => (v >= 1000 ? `до воды ${formatNumber(v / 1000, 1)}${NBSP}км` : `до воды ${formatNumber(Math.round(v / 10) * 10, 0)}${NBSP}м`),
  },
  elevation: {
    heats: 'рельеф',
    cools: 'рельеф',
    heatsShort: 'рельеф',
    coolsShort: 'рельеф',
    there: 'так сложился рельеф',
    better: null,
    measure: (v) => `высота ${formatNumber(v, 0)}${NBSP}м`,
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
