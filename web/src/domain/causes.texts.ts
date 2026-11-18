import { texts } from '../i18n/locale';
import { formats } from './format';

const NBSP = ' ';

/** How one factor reads as a cause of heat, in both directions. */
export interface CauseWords {
  /** Subject of "даёт …" / "comes from …" when it heats: "нехватка зелени", "lack of greenery". */
  heats: string;
  /** Subject when it cools: "зелень", "greenery". */
  cools: string;
  /** Inline label on the ribbon and in lists. */
  heatsShort: string;
  coolsShort: string;
  /** Completes "там …" for the city sentence: "там мало зелени", "little greenery". */
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

/** The factors of the contract's fixed vocabulary. */
export type FactorKey = 'ndvi' | 'tree' | 'built' | 'bare' | 'albedo' | 'roads' | 'buildings' | 'height' | 'volume' | 'water_dist' | 'elevation';

const en = formats('en');
const ru = formats('ru');
const pctEn = (v: number) => `${en.formatNumber(v, 0)}%`;
const pctRu = (v: number) => `${ru.formatNumber(v, 0)}${NBSP}%`;

export const CAUSE_WORDS = texts<Record<FactorKey, CauseWords>>(
  {
    ndvi: {
      heats: 'lack of greenery',
      cools: 'greenery',
      heatsShort: 'little greenery',
      coolsShort: 'greenery',
      there: 'little greenery',
      better: 'up',
      measure: (v) => `NDVI ${en.formatNumber(v, 2)}`,
    },
    tree: {
      heats: 'lack of trees',
      cools: 'tree shade',
      heatsShort: 'no trees',
      coolsShort: 'trees',
      there: 'no trees',
      better: 'up',
      measure: (v) => `trees on ${pctEn(v)} of the area`,
    },
    built: {
      heats: 'dense building',
      cools: 'sparse building',
      heatsShort: 'built-up',
      coolsShort: 'little built-up',
      there: 'solid built-up cover',
      better: 'down',
      measure: (v) => `${pctEn(v)} built up`,
    },
    bare: {
      heats: 'bare ground',
      cools: 'covered ground',
      heatsShort: 'bare ground',
      coolsShort: 'ground covered',
      there: 'bare ground',
      better: 'down',
      measure: (v) => `${pctEn(v)} bare ground`,
    },
    albedo: {
      heats: 'bright open surface',
      cools: 'dark surface',
      heatsShort: 'bright ground',
      coolsShort: 'dark surface',
      there: 'bright open ground',
      better: null,
      explain:
        'High albedo here means open dry ground: in these cities bare soil is the brightest surface and also the hottest. Light surfaces do not heat by themselves; covering the ground with plants helps.',
      measure: (v) => `albedo ${en.formatNumber(v, 2)}`,
    },
    roads: {
      heats: 'dense road network',
      cools: 'sparse road network',
      heatsShort: 'roads',
      coolsShort: 'few roads',
      there: 'many roads',
      better: 'down',
      measure: (v) => `${en.formatNumber(v, 1)}${NBSP}km of road per km²`,
    },
    buildings: {
      heats: 'building density',
      cools: 'few buildings',
      heatsShort: 'buildings',
      coolsShort: 'few buildings',
      there: 'many buildings',
      better: 'down',
      measure: (v) => `${en.formatNumber(v, 1)} buildings per ha`,
    },
    height: {
      heats: 'tall buildings',
      cools: 'shade of tall buildings',
      heatsShort: 'tall buildings',
      coolsShort: 'building shade',
      there: 'tall buildings',
      better: null,
      explain:
        'Tall buildings both heat and shade: by day their shadow cools the yard and the street, while walls and roofs store heat. Which wins depends on the block, so height is read together with building volume.',
      measure: (v) => `buildings ${en.formatNumber(v, 0)}${NBSP}m tall on average`,
    },
    volume: {
      heats: 'dense mass of buildings',
      cools: 'open layout',
      heatsShort: 'dense building',
      coolsShort: 'open layout',
      there: 'a dense mass of buildings',
      better: 'down',
      measure: (v) => `${en.formatNumber(Math.round(v / 100) * 100, 0)}${NBSP}m³ of buildings per ha`,
    },
    water_dist: {
      heats: 'distance from water',
      cools: 'water nearby',
      heatsShort: 'far from water',
      coolsShort: 'water nearby',
      there: 'water is far',
      better: 'down',
      measure: (v) => (v >= 1000 ? `${en.formatNumber(v / 1000, 1)}${NBSP}km to water` : `${en.formatNumber(Math.round(v / 10) * 10, 0)}${NBSP}m to water`),
    },
    elevation: {
      heats: 'terrain',
      cools: 'terrain',
      heatsShort: 'terrain',
      coolsShort: 'terrain',
      there: 'the terrain',
      better: null,
      measure: (v) => `elevation ${en.formatNumber(v, 0)}${NBSP}m`,
    },
  },
  {
    ndvi: {
      heats: 'нехватка зелени',
      cools: 'зелень',
      heatsShort: 'мало зелени',
      coolsShort: 'зелень',
      there: 'мало зелени',
      better: 'up',
      measure: (v) => `NDVI ${ru.formatNumber(v, 2)}`,
    },
    tree: {
      heats: 'нехватка деревьев',
      cools: 'тень деревьев',
      heatsShort: 'нет деревьев',
      coolsShort: 'деревья',
      there: 'нет деревьев',
      better: 'up',
      measure: (v) => `деревья на ${pctRu(v)} площади`,
    },
    built: {
      heats: 'плотная застройка',
      cools: 'редкая застройка',
      heatsShort: 'застройка',
      coolsShort: 'мало застройки',
      there: 'сплошная застройка',
      better: 'down',
      measure: (v) => `застроено ${pctRu(v)}`,
    },
    bare: {
      heats: 'голая земля',
      cools: 'закрытый грунт',
      heatsShort: 'голая земля',
      coolsShort: 'грунт закрыт',
      there: 'голая земля',
      better: 'down',
      measure: (v) => `голой земли ${pctRu(v)}`,
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
      measure: (v) => `альбедо ${ru.formatNumber(v, 2)}`,
    },
    roads: {
      heats: 'плотная сеть дорог',
      cools: 'редкая сеть дорог',
      heatsShort: 'дороги',
      coolsShort: 'мало дорог',
      there: 'много дорог',
      better: 'down',
      measure: (v) => `${ru.formatNumber(v, 1)}${NBSP}км дорог на км²`,
    },
    buildings: {
      heats: 'плотность зданий',
      cools: 'мало зданий',
      heatsShort: 'здания',
      coolsShort: 'мало зданий',
      there: 'много зданий',
      better: 'down',
      measure: (v) => `${ru.formatNumber(v, 1)} зданий на га`,
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
      measure: (v) => `дома в среднем ${ru.formatNumber(v, 0)}${NBSP}м высотой`,
    },
    volume: {
      heats: 'плотная масса домов',
      cools: 'просторная застройка',
      heatsShort: 'плотная застройка',
      coolsShort: 'просторно',
      there: 'плотная масса домов',
      better: 'down',
      measure: (v) => `${ru.formatNumber(Math.round(v / 100) * 100, 0)}${NBSP}м³ зданий на га`,
    },
    water_dist: {
      heats: 'удалённость от воды',
      cools: 'близость воды',
      heatsShort: 'далеко от воды',
      coolsShort: 'вода рядом',
      there: 'далеко до воды',
      better: 'down',
      measure: (v) => (v >= 1000 ? `до воды ${ru.formatNumber(v / 1000, 1)}${NBSP}км` : `до воды ${ru.formatNumber(Math.round(v / 10) * 10, 0)}${NBSP}м`),
    },
    elevation: {
      heats: 'рельеф',
      cools: 'рельеф',
      heatsShort: 'рельеф',
      coolsShort: 'рельеф',
      there: 'так сложился рельеф',
      better: null,
      measure: (v) => `высота ${ru.formatNumber(v, 0)}${NBSP}м`,
    },
  },
);
