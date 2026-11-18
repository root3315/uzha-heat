import { texts } from '../i18n/locale';

/** The words of one measure: what to do, and what published reviews say about it. */
export interface InterventionWords {
  title: string;
  actions: string[];
  finding: string;
  cite: string;
}

export type InterventionId = 'shade-trees' | 'cool-roofs' | 'shade-dense-blocks' | 'cool-pavements' | 'cover-bare-soil' | 'water';

/** A comparison with the city mean: "3 times" or "30%" plus the direction. */
export type Amount = { kind: 'times'; text: string } | { kind: 'percent'; text: string };

export const INTERVENTION_TEXTS = texts<Record<InterventionId, InterventionWords>>(
  {
    'shade-trees': {
      title: 'Street trees and shade canopies',
      actions: [
        'plant large-canopy trees along sidewalks and in courtyards: plane, elm, mulberry',
        'canopies and pergolas over bus stops, markets and playgrounds',
      ],
      finding: 'a review of 308 studies: air under trees is 0.8° cooler on average',
      cite: 'Knight et al., 2021, Environmental Evidence',
    },
    'cool-roofs': {
      title: 'Cool and green roofs',
      actions: ['light reflective roof coatings at scheduled repairs', 'green roofs on public and commercial buildings with flat roofs'],
      finding: 'a review of city models: green roofs lower air temperature by 0.3–3°',
      cite: 'Santamouris, 2014, Solar Energy',
    },
    'shade-dense-blocks': {
      title: 'Shade and street layout in dense blocks',
      actions: [
        'narrow streets and courtyards between tall buildings, arcades and canopies, so buildings shade the sidewalks and each other',
        'run new streets north–south or diagonally, not east–west',
      ],
      finding:
        'modelling for a hot dry climate: daytime heat stress depends on building height to street width and on street orientation; open streets and east–west streets are the hottest, deep shaded ones the coolest',
      cite: 'Ali-Toudert and Mayer, 2006, Building and Environment',
    },
    'cool-pavements': {
      title: 'Shade and light paving on roads',
      actions: ['light or permeable asphalt on car parks and sidewalks', 'trees on median strips'],
      finding: 'a review: light and permeable pavements heat up less than ordinary asphalt, by how much depends on the material',
      cite: 'Santamouris, 2013, Renewable and Sustainable Energy Reviews',
    },
    'cover-bare-soil': {
      title: 'Cover bare ground',
      actions: ['trees, shrubs and drought-tolerant ground cover on vacant lots', 'dust control and planting in industrial zones and along roadsides'],
      finding: 'a review of 308 studies: air over grass is 0.6° cooler on average than over unvegetated ground, under trees 0.8°',
      cite: 'Knight et al., 2021, Environmental Evidence',
    },
    water: {
      title: 'Water nearby: aryks, fountains, irrigation',
      actions: ['restore the aryk irrigation channels and drip-water the public gardens', 'fountains and open water in public spaces'],
      finding: 'a review: air is cooler near water, but by how much depends strongly on wind and the buildings around',
      cite: 'Völker et al., 2013, Erdkunde',
    },
  },
  {
    'shade-trees': {
      title: 'Деревья вдоль улиц и теневые навесы',
      actions: [
        'высадить крупномерные деревья вдоль тротуаров и во дворах: чинара, карагач, тут',
        'навесы и перголы над остановками, рынками и детскими площадками',
      ],
      finding: 'по обзору 308 исследований, под деревьями воздух в среднем на 0,8° прохладнее',
      cite: 'Knight и др., 2021, Environmental Evidence',
    },
    'cool-roofs': {
      title: 'Холодные и зелёные крыши',
      actions: ['светлые отражающие покрытия кровли при плановом ремонте', 'зелёные крыши на общественных и торговых зданиях с плоской кровлей'],
      finding: 'по обзору моделей городов, зелёные крыши снижают температуру воздуха на 0,3–3°',
      cite: 'Santamouris, 2014, Solar Energy',
    },
    'shade-dense-blocks': {
      title: 'Тень и улицы в плотных кварталах',
      actions: [
        'между высокими домами узкие улицы и дворы, галереи и навесы, чтобы дома затеняли тротуары и друг друга',
        'новые улицы вести по оси север–юг или наискось, а не с востока на запад',
      ],
      finding:
        'по моделированию для жаркого сухого климата, тепловой стресс днём зависит от высоты домов к ширине улицы и её направления: открытые улицы и улицы с востока на запад жарче всего, глубокие и затенённые прохладнее',
      cite: 'Ali-Toudert и Mayer, 2006, Building and Environment',
    },
    'cool-pavements': {
      title: 'Затенение и светлые покрытия дорог',
      actions: ['светлый или проницаемый асфальт на парковках и тротуарах', 'деревья по разделительным полосам'],
      finding: 'по обзору, светлые и проницаемые покрытия нагреваются меньше обычного асфальта, насколько зависит от материала',
      cite: 'Santamouris, 2013, Renewable and Sustainable Energy Reviews',
    },
    'cover-bare-soil': {
      title: 'Закрыть открытый грунт',
      actions: ['деревья, кустарник и засухоустойчивые почвопокровные растения на пустырях', 'пылеподавление и озеленение промзон и обочин'],
      finding: 'по обзору 308 исследований, воздух над травой в среднем на 0,6° прохладнее, чем над незелёными участками, под деревьями на 0,8°',
      cite: 'Knight и др., 2021, Environmental Evidence',
    },
    water: {
      title: 'Вода рядом: арыки, фонтаны, полив',
      actions: ['восстановить арычную сеть и капельный полив скверов', 'фонтаны и открытые водоёмы в общественных пространствах'],
      finding: 'по обзору, у воды воздух прохладнее, но насколько, сильно зависит от ветра и застройки вокруг',
      cite: 'Völker и др., 2013, Erdkunde',
    },
  },
);

export const COMPARE_TEXTS = texts(
  {
    times: (_n: number, text: string) => `${text} times`,
    percent: (text: string) => `${text}%`,
    unknownMean: (mean: string) => `city average ${mean}`,
    nearMean: (mean: string) => `about the city average (${mean})`,
    almostNone: (mean: string) => `almost none; city average ${mean}`,
    differs: (amount: Amount, lower: boolean, mean: string) =>
      amount.kind === 'times'
        ? `${amount.text} ${lower ? 'lower' : 'higher'} than the city average (${mean})`
        : `${amount.text} ${lower ? 'below' : 'above'} the city average (${mean})`,
  },
  {
    times: (n, text) => {
      // "в 1,6 раза", "в 3 раза", "в 5 раз": a fraction always takes "раза".
      if (!Number.isInteger(n)) return `в ${text} раза`;
      const lastTwo = n % 100;
      const last = n % 10;
      return `в ${text} ${last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'раза' : 'раз'}`;
    },
    percent: (text) => `на ${text} %`,
    unknownMean: (mean) => `в среднем по городу ${mean}`,
    nearMean: (mean) => `на уровне среднего по городу (${mean})`,
    almostNone: (mean) => `почти нет, в среднем по городу ${mean}`,
    differs: (amount, lower, mean) => `${amount.text} ${lower ? 'ниже' : 'выше'} среднего по городу (${mean})`,
  },
);
