import { describe, expect, it } from 'vitest';
import { formats } from '../domain/format';
import { LOCALES, type Texts } from './locale';
import { plural, pluralEn, pluralRu } from './plural';

/** The shape of a dictionary: its keys all the way down, array lengths, and which values are functions. */
function shape(value: unknown): unknown {
  if (typeof value === 'function') return 'function';
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, shape((value as Record<string, unknown>)[key])]),
    );
  }
  return typeof value;
}

const isTexts = (value: unknown): value is Texts<unknown> =>
  !!value && typeof value === 'object' && LOCALES.every((locale) => locale in value) && Object.keys(value).length === LOCALES.length;

const modules = import.meta.glob<Record<string, unknown>>('../**/*.texts.ts', { eager: true });

describe('dictionaries', () => {
  const dictionaries = Object.entries(modules).flatMap(([file, exports]) =>
    Object.entries(exports)
      .filter(([, value]) => isTexts(value))
      .map(([name, value]) => [`${file}: ${name}`, value as Texts<unknown>] as const),
  );

  it('are found', () => {
    expect(dictionaries.length).toBeGreaterThan(10);
  });

  it.each(dictionaries)('%s has the same keys in every language', (_, dictionary) => {
    for (const locale of LOCALES) expect(shape(dictionary[locale])).toEqual(shape(dictionary.en));
  });
});

describe('plurals', () => {
  it('has one and other in English', () => {
    expect(pluralEn(1, ['place', 'places'])).toBe('place');
    expect(pluralEn(0, ['place', 'places'])).toBe('places');
    expect(pluralEn(2, ['place', 'places'])).toBe('places');
    expect(pluralEn(21, ['place', 'places'])).toBe('places');
  });

  it('has three forms in Russian', () => {
    const forms = ['причина', 'причины', 'причин'] as const;
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map((n) => pluralRu(n, forms))).toEqual([
      'причина',
      'причины',
      'причины',
      'причин',
      'причин',
      'причин',
      'причин',
      'причина',
      'причины',
      'причин',
      'причина',
      'причин',
    ]);
  });

  it('picks the forms of the language', () => {
    const forms = { en: ['cause', 'causes'], ru: ['причина', 'причины', 'причин'] } as const;
    expect(plural('en', 3, forms)).toBe('causes');
    expect(plural('ru', 3, forms)).toBe('причины');
  });
});

describe('numbers', () => {
  const en = formats('en');
  const ru = formats('ru');

  it('writes English with a decimal point and comma groups', () => {
    expect(en.formatDeg(43.633)).toBe('43.6°');
    expect(en.formatNumber(1234, 0)).toBe('1,234');
    expect(en.formatDegSigned(-1.24)).toBe('−1.2°');
    expect(en.formatDegSigned(4.56)).toBe('+4.6°');
    expect(en.formatPercent(0.34)).toBe('34%');
    expect(en.formatPoints(17)).toBe('+17 points');
    expect(en.formatKm(1240)).toBe('1.2 km');
  });

  it('writes Russian with a decimal comma and space groups, as before', () => {
    expect(ru.formatDeg(43.633)).toBe('43,6°');
    expect(ru.formatNumber(1234, 0)).toBe('1 234');
    expect(ru.formatDegSigned(-1.24)).toBe('−1,2°');
    expect(ru.formatPercent(0.34)).toBe('34 %');
    expect(ru.formatPoints(17)).toBe('+17 пунктов');
    expect(ru.formatKm(1240)).toBe('1,2 км');
  });

  it('never writes a negative zero', () => {
    expect(en.formatDegSigned(-0.01)).toBe('0.0°');
    expect(ru.formatDegSigned(-0.01)).toBe('0,0°');
  });

  it('writes factor units in the language', () => {
    expect(en.formatFactorValue({ unit: 'м' }, 340)).toBe('340 m');
    expect(en.formatFactorValue({ unit: 'м' }, 2300)).toBe('2.3 km');
    expect(en.formatFactorValue({ unit: '% площади' }, 41.2)).toBe('41%');
    expect(en.formatFactorValue({ unit: 'м³/га' }, 12345)).toBe('12,300 m³/ha');
    expect(ru.formatFactorValue({ unit: 'м³/га' }, 12345)).toBe('12 300 м³/га');
    expect(en.formatFactorValue({ unit: 'NDVI' }, 0.234)).toBe('0.23');
  });
});
