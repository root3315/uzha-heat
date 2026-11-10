import type { Weather } from '../data/contract';
import { locative } from './answers';
import { formatDeg, formatNumber, plural } from './format';

const NBSP = ' ';

export interface WeatherFigure {
  key: 'wind' | 'humidity' | 'solar' | 'cloud' | 'airMean' | 'airMax';
  label: string;
  value: string;
}

export const formatWind = (ms: number): string => `${formatNumber(ms, 1)}${NBSP}м/с`;
const formatShare = (pct: number): string => `${formatNumber(pct, 0)}${NBSP}%`;
const formatSolar = (kwh: number): string => `${formatNumber(kwh, 1)}${NBSP}кВт·ч`;

/** The summer in six numbers, in the order a reader compares cities: wind first, it is what carries heat away. */
export function summerFigures({ summer }: Weather): WeatherFigure[] {
  return [
    { key: 'wind', label: 'ветер', value: formatWind(summer.windMs) },
    { key: 'airMax', label: 'воздух, дневной максимум', value: formatDeg(summer.airMaxC) },
    { key: 'airMean', label: 'воздух, среднее', value: formatDeg(summer.airMeanC) },
    { key: 'humidity', label: 'влажность', value: formatShare(summer.humidityPct) },
    { key: 'solar', label: 'солнце за день на м²', value: formatSolar(summer.solarKwhM2) },
    { key: 'cloud', label: 'облачность', value: formatShare(summer.cloudPct) },
  ];
}

/** What the air was like when Landsat took the pictures, or null without overpass data. */
export function overpassLine({ overpass }: Weather): string | null {
  if (!overpass) return null;
  const days = `${formatNumber(overpass.days, 0)} ${plural(overpass.days, ['день', 'дня', 'дней'])}`;
  return (
    `В ${days} съёмки Landsat, около ${overpass.localHour}:00: ветер ${formatWind(overpass.windMs)}, воздух ${formatDeg(overpass.airC)}, ` +
    `влажность ${formatShare(overpass.humidityPct)}, облачность ${formatShare(overpass.cloudPct)}.`
  );
}

/** Where the numbers come from and how coarse they are. */
export const weatherSource = (weather: Weather): string =>
  `${weather.source}, ${weather.period}: одна точка сетки около 25${NBSP}км у центра города.`;

export interface CityWeather {
  name: string;
  weather: Weather;
}

function extremes(cities: readonly CityWeather[], value: (w: Weather) => number): [CityWeather, CityWeather] | null {
  if (cities.length < 2) return null;
  const sorted = [...cities].sort((a, b) => value(a.weather) - value(b.weather));
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  return low && high && value(high.weather) > value(low.weather) ? [low, high] : null;
}

/**
 * What the summers say about the cities' heat, from the numbers alone: where the wind is weakest and why that matters,
 * and where the afternoon air is hottest. Null when fewer than two cities have weather.
 */
export function weatherComparison(cities: readonly CityWeather[]): string | null {
  const wind = extremes(cities, (w) => w.summer.windMs);
  const air = extremes(cities, (w) => w.summer.airMaxC);
  const sentences: string[] = [];
  if (wind) {
    const [calm, windy] = wind;
    sentences.push(
      `Слабее всего ветер в ${locative(calm.name)}: ${formatWind(calm.weather.summer.windMs)} против ${formatWind(windy.weather.summer.windMs)} ` +
        `в ${locative(windy.name)}. Чем слабее ветер, тем меньше тепла он уносит с нагретых крыш и асфальта.`,
    );
  }
  if (air) {
    const [, hottest] = air;
    sentences.push(`Жарче всего воздух в ${locative(hottest.name)}: днём в среднем до ${formatDeg(hottest.weather.summer.airMaxC)}.`);
  }
  return sentences.length ? sentences.join(' ') : null;
}

/** Cities that carry weather, with their names, in the given order. */
export const withWeather = <T extends { name: string; weather?: Weather }>(cities: readonly T[]): CityWeather[] =>
  cities.flatMap((c) => (c.weather ? [{ name: c.name, weather: c.weather }] : []));
