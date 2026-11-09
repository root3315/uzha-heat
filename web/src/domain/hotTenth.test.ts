import { describe, expect, it } from 'vitest';
import type { CityDetail, FeatureMeta } from '../data/contract';
import { dominantShares, hotTenthPattern, secondCause } from './hotTenth';

const feature = (key: string, label: string, unit: string): FeatureMeta => ({ key, label, unit, description: '' });

/** Four hot cells (0–3) and six others; `values` and `shap` per factor. */
function detail(values: Record<string, number[]>, shap: Record<string, number[]>): CityDetail {
  const lst = [50, 50, 50, 50, 40, 40, 40, 40, 40, 40];
  return {
    features: [feature('ndvi', 'Растительность', 'NDVI'), feature('built', 'Застройка', '% площади'), feature('bare', 'Открытый грунт', '% площади')],
    cells: { lon: lst.map(() => 0), lat: lst.map(() => 0), lst, values, shap },
  } as unknown as CityDetail;
}
const HOT = [0, 1, 2, 3];
const all = (v: number) => Array.from({ length: 10 }, () => v);

describe('dominantShares', () => {
  it('counts how often each factor heats a hot cell most', () => {
    const d = detail({}, { ndvi: [3, 3, 3, 0, ...all(0).slice(4)], bare: [1, 1, 1, 2, ...all(0).slice(4)], built: all(0) });
    expect(dominantShares(d, HOT)).toEqual([
      { key: 'ndvi', share: 0.75 },
      { key: 'bare', share: 0.25 },
    ]);
  });
});

describe('secondCause', () => {
  const shap = { ndvi: [3, 3, 3, 0, ...all(0).slice(4)], built: [0, 0, 0, 2, ...all(0).slice(4)], bare: all(0) };

  it('names a runner-up that sits on its problem side', () => {
    const d = detail({ ndvi: all(0.2), built: [90, 90, 90, 90, 30, 30, 30, 30, 30, 30], bare: all(0) }, shap);
    expect(secondCause(d, HOT, dominantShares(d, HOT))).toEqual({ key: 'built', share: 0.25 });
  });

  it('drops a runner-up that "heats" while on the harmless side, like sparse building on bare outskirts', () => {
    const d = detail({ ndvi: all(0.2), built: [5, 5, 5, 5, 80, 80, 80, 80, 80, 80], bare: all(0) }, shap);
    expect(secondCause(d, HOT, dominantShares(d, HOT))).toBeNull();
  });
});

describe('hotTenthPattern', () => {
  const shap = { ndvi: all(1), built: all(0), bare: all(0) };

  it('tells open, barely built land from dense building', () => {
    const outskirts = detail({ built: [5, 5, 5, 5, 80, 80, 80, 80, 80, 80], bare: [20, 20, 20, 20, 1, 1, 1, 1, 1, 1] }, shap);
    const inside = [false, false, false, true, true, true, true, true, true, true];
    expect(hotTenthPattern(outskirts, HOT, inside)).toMatchObject({ kind: 'open', outsideShare: 0.75 });

    const dense = detail({ built: [90, 90, 90, 90, 30, 30, 30, 30, 30, 30], bare: all(1) }, shap);
    expect(hotTenthPattern(dense, HOT, all(1).map(() => true)).kind).toBe('dense');

    const both = detail({ built: [90, 90, 90, 90, 30, 30, 30, 30, 30, 30], bare: [12, 12, 12, 12, 1, 1, 1, 1, 1, 1] }, shap);
    expect(hotTenthPattern(both, HOT, all(1).map(() => true)).kind).toBe('dense-bare');
  });
});
