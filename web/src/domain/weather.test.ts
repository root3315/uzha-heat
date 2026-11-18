import { describe, expect, it } from 'vitest';
import type { Weather } from '../data/contract';
import { overpassLine, summerFigures, weatherComparison, weatherSource, withWeather } from './weather';

/** Units sit after a non-breaking space; compare with plain ones for readability. */
const plain = (text: string | null) => text?.replace(/\u00a0/g, ' ') ?? null;

function weather(windMs: number, airMaxC: number, overpass = true): Weather {
  return {
    source: 'ERA5 (Copernicus) via Open-Meteo',
    period: 'июнь–август 2023–2025',
    point: [69.25, 41.25],
    summer: { windMs, humidityPct: 42.5, solarKwhM2: 7.3, cloudPct: 15.3, airMeanC: 27.1, airMaxC },
    ...(overpass ? { overpass: { days: 21, localHour: 11, windMs: 1.5, humidityPct: 31, solarWm2: 799, cloudPct: 0.3, airC: 32 } } : {}),
  };
}

describe('summerFigures', () => {
  it('formats every summer value with its unit, wind first', () => {
    const figures = summerFigures(weather(1.9, 34.3), 'ru');
    expect({ ...figures[0], value: plain(figures[0]?.value ?? '') }).toEqual({ key: 'wind', label: 'ветер', value: '1,9 м/с' });
    expect(figures.map((f) => plain(f.value))).toEqual(['1,9 м/с', '34,3°', '27,1°', '43 %', '7,3 кВт·ч', '15 %']);
  });
});

describe('overpassLine', () => {
  it('describes the hours of the Landsat pictures', () => {
    expect(plain(overpassLine(weather(1.9, 34.3), 'en'))).toBe(
      'On the 21 days of Landsat overpasses, around 11:00: wind 1.5 m/s, air 32.0°, humidity 31%, cloud cover 0%.',
    );
    expect(plain(overpassLine(weather(1.9, 34.3), 'ru'))).toBe(
      'В 21 день съёмки Landsat, около 11:00: ветер 1,5 м/с, воздух 32,0°, влажность 31 %, облачность 0 %.',
    );
  });

  it('is null without overpass data', () => {
    expect(overpassLine(weather(1.9, 34.3, false), 'ru')).toBeNull();
  });
});

describe('weatherSource', () => {
  it('names the source, the period and the coarse point', () => {
    expect(plain(weatherSource(weather(1, 1), 'en'))).toBe(
      'ERA5 (Copernicus) via Open-Meteo, June–August 2023–2025: one grid point about 25 km across, near the city centre.',
    );
    expect(plain(weatherSource(weather(1, 1), 'ru'))).toBe('ERA5 (Copernicus) via Open-Meteo, июнь–август 2023–2025: одна точка сетки около 25 км у центра города.');
  });
});

describe('weatherComparison', () => {
  const cities = [
    { name: 'Ташкент', weather: weather(1.9, 34.3) },
    { name: 'Самарканд', weather: weather(2.9, 34.6) },
    { name: 'Бухара', weather: weather(4.6, 37.8) },
  ];

  it('names the calmest and the windiest city and the hottest afternoon air', () => {
    expect(plain(weatherComparison(cities, 'ru'))).toBe(
      'Слабее всего ветер в Ташкенте: 1,9 м/с против 4,6 м/с в Бухаре. Чем слабее ветер, тем меньше тепла он уносит с нагретых крыш и асфальта. ' +
        'Жарче всего воздух в Бухаре: днём в среднем до 37,8°.',
    );
  });

  it('says nothing about one city or equal numbers', () => {
    expect(weatherComparison(cities.slice(0, 1), 'ru')).toBeNull();
    expect(weatherComparison([cities[0]!, { name: 'Копия', weather: weather(1.9, 34.3) }], 'ru')).toBeNull();
  });

  it('keeps only cities that have weather', () => {
    const cities = [
      { name: 'А', nameEn: 'A', weather: weather(1, 1) },
      { name: 'Б', nameEn: 'B' },
    ];
    expect(withWeather(cities, 'ru').map((c) => c.name)).toEqual(['А']);
    expect(withWeather(cities, 'en').map((c) => c.name)).toEqual(['A']);
  });
});
