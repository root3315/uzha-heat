import { describe, expect, it } from 'vitest';
import type { FeatureMeta } from '../data/contract';
import { compareWithCity, formatEffect, formatRatio, recommend, type RecommendationInput } from './recommendations';

/** Formatting uses non-breaking spaces; compare with plain ones for readability. */
const plain = (text: string | undefined) => text?.replace(/[  ]/g, ' ');

const feature = (key: string, label: string, unit: string): FeatureMeta => ({ key, label, unit, description: '' });

const FEATURES: FeatureMeta[] = [
  feature('ndvi', 'Растительность', 'NDVI'),
  feature('tree', 'Древесный покров', '% площади'),
  feature('built', 'Застройка', '% площади'),
  feature('bare', 'Открытый грунт', '% площади'),
  feature('water_dist', 'Удалённость от воды', 'м'),
  feature('elevation', 'Высота', 'м'),
];

function input(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    features: FEATURES,
    values: { ndvi: 0.08, tree: 4, built: 80, bare: 2, water_dist: 2400, elevation: 450 },
    cityMeans: { ndvi: 0.24, tree: 12, built: 50, bare: 6, water_dist: 1200, elevation: 460 },
    contributions: { ndvi: 1.3, tree: 0.4, built: 0.9, bare: -0.3, water_dist: 0.6, elevation: 0.5 },
    ...overrides,
  };
}

describe('recommend', () => {
  it('turns low vegetation into a tree recommendation explained by the actual numbers', () => {
    const trees = recommend(input()).find((r) => r.id === 'shade-trees');
    expect(trees).toBeDefined();
    expect(trees?.reasons.map((r) => plain(r.text))).toContain('NDVI 0,08, в 3 раза ниже среднего по городу (0,24)');
    expect(trees?.reasons.map((r) => r.key)).toEqual(['ndvi', 'tree']);
  });

  it('sorts recommendations by how much their factors heat the place', () => {
    const ids = recommend(input()).map((r) => r.id);
    expect(ids).toEqual(['shade-trees', 'cool-roofs', 'water']);
  });

  it('skips cooling and negligible factors', () => {
    const ids = recommend(input({ contributions: { ndvi: -0.8, tree: 0.05, built: 0.9, bare: -0.3, water_dist: 0, elevation: 2 } })).map((r) => r.id);
    expect(ids).toEqual(['cool-roofs']);
  });

  it('never recommends anything for non-actionable factors such as elevation', () => {
    const result = recommend(input({ contributions: { elevation: 3 } }));
    expect(result).toEqual([]);
  });

  it('only uses factors present in the data', () => {
    const result = recommend(input({ features: FEATURES.filter((f) => f.key !== 'ndvi') }));
    const trees = result.find((r) => r.id === 'shade-trees');
    expect(trees?.reasons.map((r) => r.key)).toEqual(['tree']);
  });

  it('ignores a heating factor whose value is on the harmless side of the city mean', () => {
    const roads = feature('roads', 'Плотность дорог', 'км/км²');
    const result = recommend({
      features: [roads],
      values: { roads: 5 },
      cityMeans: { roads: 11 },
      contributions: { roads: 1.5 },
    });
    expect(result).toEqual([]);
  });

  it('caps the expected effect by the heating it is meant to remove', () => {
    const [water] = recommend(input({ contributions: { water_dist: 0.6 } }));
    expect(water?.effect.max).toBeCloseTo(0.6);
    expect(water?.effect.min).toBeLessThanOrEqual(water?.effect.max ?? 0);
  });

  it('keeps the literature range when the place heats strongly', () => {
    const [bare] = recommend(input({ values: { bare: 60 }, contributions: { bare: 4.2 } }));
    expect(bare?.effect).toEqual({ min: 1, max: 3 });
    expect(plain(bare?.reasons[0]?.text)).toBe('Открытый грунт 60 %, в 10 раз выше среднего по городу (6 %)');
  });
});

describe('compareWithCity', () => {
  const pct = feature('built', 'Застройка', '% площади');

  it('says "on par" for small deviations', () => {
    expect(plain(compareWithCity(pct, 52, 50))).toBe('на уровне среднего по городу (50 %)');
  });

  it('uses percentages for moderate deviations', () => {
    expect(plain(compareWithCity(pct, 65, 50))).toBe('на 30 % выше среднего по городу (50 %)');
  });

  it('handles an almost absent factor', () => {
    expect(plain(compareWithCity(pct, 0, 50))).toBe('почти нет, в среднем по городу 50 %');
  });
});

describe('formatRatio', () => {
  it.each([
    [2, 'в 2 раза'],
    [3.04, 'в 3 раза'],
    [5, 'в 5 раз'],
    [1.6, 'в 1,6 раза'],
    [12, 'в 12 раз'],
    [22, 'в 22 раза'],
  ])('%s → %s', (ratio, text) => {
    expect(formatRatio(ratio)).toBe(text);
  });
});

describe('formatEffect', () => {
  it('formats a whole-degree range', () => {
    expect(formatEffect({ min: 1, max: 3 })).toBe('1–3°');
  });

  it('keeps one decimal when needed', () => {
    expect(formatEffect({ min: 0.5, max: 2 })).toBe('0,5–2,0°');
  });

  it('collapses an equal range to an upper bound', () => {
    expect(formatEffect({ min: 0.4, max: 0.4 })).toBe('до 0,4°');
  });
});
