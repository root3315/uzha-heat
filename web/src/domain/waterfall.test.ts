import { describe, expect, it } from 'vitest';
import type { FeatureMeta } from '../data/contract';
import type { PlaceProfile } from './places';
import { OTHER_FACTORS_KEY, buildWaterfall } from './waterfall';

const features: FeatureMeta[] = ['a', 'b', 'c', 'd'].map((key) => ({ key, label: key.toUpperCase(), unit: 'м', description: '' }));

const place: PlaceProfile = {
  kind: 'cell',
  title: 'test',
  lst: 47,
  cellCount: 1,
  values: {},
  contributions: { a: 0.2, b: -1.5, c: 3, d: 0.1 },
};

describe('buildWaterfall', () => {
  it('walks from the base value to the prediction, largest contributions first', () => {
    const w = buildWaterfall(place, features, 44);
    expect(w.steps.map((s) => s.key)).toEqual(['c', 'b', 'a', 'd']);
    expect(w.steps[0]?.start).toBe(44);
    expect(w.predicted).toBeCloseTo(45.8);
    expect(w.residual).toBeCloseTo(1.2);
  });

  it('chains steps so each starts where the previous ended', () => {
    const w = buildWaterfall(place, features, 44);
    w.steps.slice(1).forEach((step, i) => expect(step.start).toBeCloseTo(w.steps[i]?.end ?? Number.NaN));
  });

  it('folds the smallest contributions into one row without changing the total', () => {
    const w = buildWaterfall(place, features, 44, 3);
    expect(w.steps.map((s) => s.key)).toEqual(['c', 'b', OTHER_FACTORS_KEY]);
    expect(w.steps[2]?.delta).toBeCloseTo(0.3);
    expect(w.predicted).toBeCloseTo(45.8);
  });
});
