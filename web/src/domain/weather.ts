import type { CitySummary, Weather } from '../data/contract';
import type { Locale } from '../i18n/locale';
import { cityName, periodText } from './dataTexts';
import { formats } from './format';
import { WEATHER_TEXTS } from './weather.texts';

export interface WeatherFigure {
  key: 'wind' | 'humidity' | 'solar' | 'cloud' | 'airMean' | 'airMax';
  label: string;
  value: string;
}

export const formatWind = (ms: number, locale: Locale): string => `${formats(locale).formatNumber(ms, 1)}${WEATHER_TEXTS[locale].wind}`;
const formatShare = (pct: number, locale: Locale): string => `${formats(locale).formatNumber(pct, 0)}${WEATHER_TEXTS[locale].percent}`;
const formatSolar = (kwh: number, locale: Locale): string => `${formats(locale).formatNumber(kwh, 1)}${WEATHER_TEXTS[locale].solar}`;

/** The summer in six numbers, in the order a reader compares cities: wind first, it is what carries heat away. */
export function summerFigures({ summer }: Weather, locale: Locale): WeatherFigure[] {
  const label = WEATHER_TEXTS[locale].labels;
  const { formatDeg } = formats(locale);
  return [
    { key: 'wind', label: label.wind, value: formatWind(summer.windMs, locale) },
    { key: 'airMax', label: label.airMax, value: formatDeg(summer.airMaxC) },
    { key: 'airMean', label: label.airMean, value: formatDeg(summer.airMeanC) },
    { key: 'humidity', label: label.humidity, value: formatShare(summer.humidityPct, locale) },
    { key: 'solar', label: label.solar, value: formatSolar(summer.solarKwhM2, locale) },
    { key: 'cloud', label: label.cloud, value: formatShare(summer.cloudPct, locale) },
  ];
}

/** What the air was like when Landsat took the pictures, or null without overpass data. */
export function overpassLine({ overpass }: Weather, locale: Locale): string | null {
  if (!overpass) return null;
  const { formatDeg, formatNumber } = formats(locale);
  return WEATHER_TEXTS[locale].overpass(
    overpass.days,
    formatNumber(overpass.days, 0),
    overpass.localHour,
    formatWind(overpass.windMs, locale),
    formatDeg(overpass.airC),
    formatShare(overpass.humidityPct, locale),
    formatShare(overpass.cloudPct, locale),
  );
}

/** Where the numbers come from and how coarse they are. */
export const weatherSource = (weather: Weather, locale: Locale): string =>
  WEATHER_TEXTS[locale].source(weather.source, periodText(weather.period, locale));

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
export function weatherComparison(cities: readonly CityWeather[], locale: Locale): string | null {
  const t = WEATHER_TEXTS[locale];
  const wind = extremes(cities, (w) => w.summer.windMs);
  const air = extremes(cities, (w) => w.summer.airMaxC);
  const sentences: string[] = [];
  if (wind) {
    const [calm, windy] = wind;
    sentences.push(t.calmest(calm.name, formatWind(calm.weather.summer.windMs, locale), windy.name, formatWind(windy.weather.summer.windMs, locale)));
  }
  if (air) {
    const [, hottest] = air;
    sentences.push(t.hottestAir(hottest.name, formats(locale).formatDeg(hottest.weather.summer.airMaxC)));
  }
  return sentences.length ? sentences.join(' ') : null;
}

/** Cities that carry weather, with their names in the reader's language, in the given order. */
export const withWeather = (cities: readonly Pick<CitySummary, 'name' | 'nameEn' | 'weather'>[], locale: Locale): CityWeather[] =>
  cities.flatMap((c) => (c.weather ? [{ name: cityName(c, locale), weather: c.weather }] : []));
