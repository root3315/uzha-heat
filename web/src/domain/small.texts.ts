import { texts } from '../i18n/locale';
import { pluralRu } from '../i18n/plural';

/** The hunt on the landing: the line under the counter after a click. */
export const HUNT_TEXTS = texts(
  {
    counted: (t: string) => `Counted: ${t}, in the hottest 10% of the city.`,
    repeat: 'This cell is already counted.',
    warm: (t: string, threshold: string) => `${t}: warmer than average, but hot starts at ${threshold}.`,
    cool: (t: string, mean: string) => `${t}: cooler than the city average, ${mean}.`,
  },
  {
    counted: (t) => `Засчитано: ${t}, это самые горячие 10 % города.`,
    repeat: 'Этот участок уже засчитан.',
    warm: (t, threshold) => `${t}: теплее среднего, но горячими считаются от ${threshold}.`,
    cool: (t, mean) => `${t}: прохладнее среднего по городу, ${mean}.`,
  },
);

/** The loading line. */
export const LOADING_TEXTS = texts(
  {
    building: 'building isotherms',
    waiting: 'loading data',
    progress: (received: string, total: string) => `data ${received} of ${total} MB`,
    received: (received: string) => `data ${received} MB`,
  },
  {
    building: 'строю изотермы',
    waiting: 'загружаю данные',
    progress: (received, total) => `данные ${received} из ${total} МБ`,
    received: (received) => `данные ${received} МБ`,
  },
);

/** Airfields and rail yards, where the usual advice does not apply. */
export const SITE_TEXTS = texts(
  {
    airport: (name: string | null) => (name ? `Airfield: ${name}` : 'Airfield'),
    rail: 'Railway tracks and station',
    airportNote:
      'This is an airfield: the heat comes from runways and aprons, and trees are not planted on them. For the city it is background, not a place for measures.',
    railNote:
      'These are railway tracks: the heat comes from ballast and rails, and trees are not planted along tracks. For the city it is background, not a place for measures.',
  },
  {
    airport: (name) => (name ? `Аэродром: ${name}` : 'Аэродром'),
    rail: 'Железнодорожные пути и станция',
    airportNote: 'Это аэродром: жара идёт от полос и перронов, деревья на них не сажают. Для города это фон, а не место для мер.',
    railNote: 'Это железнодорожные пути: жара идёт от щебня и рельсов, деревья вдоль путей не сажают. Для города это фон, а не место для мер.',
  },
);

/** Factor groups that move together. */
export const GROUP_TEXTS = texts(
  { green: 'Vegetation and ground', built: 'Built-up', surface: 'Surface colour', setting: 'Water and terrain' },
  { green: 'Растительность и грунт', built: 'Застройка', surface: 'Цвет поверхности', setting: 'Вода и рельеф' },
);

/** How far a reduction lever may go. */
export const CUT_TEXTS = texts(
  {
    points: (points: number) => `${points} ${points === 1 ? 'point' : 'points'}`,
    quarter: 'a quarter',
    percent: (percent: number) => `${percent}%`,
    minus: (amount: string) => `minus ${amount}`,
  },
  {
    points: (points) => `${points} ${pluralRu(points, ['пункт', 'пункта', 'пунктов'])}`,
    quarter: 'четверть',
    percent: (percent) => `${percent} %`,
    minus: (amount) => `минус ${amount}`,
  },
);
