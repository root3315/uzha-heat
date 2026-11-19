import { describe, expect, it } from 'vitest';
import type { CityDetail } from '../data/contract';
import { groupShares, islandBudget } from './factorGroups';

const detail = (shap: Record<string, number[]>) => ({ cells: { lst: [40, 50], shap } }) as unknown as CityDetail;

describe('groupShares', () => {
  it('sums members before taking the size, so opposite pulls inside a group cancel', () => {
    const shares = groupShares(detail({ ndvi: [2, -1], tree: [-2, 1], built: [1, 1] }), 'ru');
    expect(shares.map((g) => [g.id, g.meanAbs])).toEqual([['built', 1]]);
  });

  it('counts only the cells inside the outline when given a mask', () => {
    const shares = groupShares(detail({ ndvi: [3, 0], built: [0, 1] }), 'ru', [true, false]);
    expect(shares.map((g) => [g.id, g.share])).toEqual([['green', 1]]);
  });

  it('splits the mean magnitude between groups', () => {
    const shares = groupShares(detail({ ndvi: [3, 3], built: [1, 1] }), 'ru');
    expect(shares.map((g) => [g.id, g.share])).toEqual([
      ['green', 0.75],
      ['built', 0.25],
    ]);
  });
});

describe('islandBudget', () => {
  // Two cells inside, two around. The model: base 40 + SHAP; the satellite reads 1° more in the first city cell.
  const city = {
    cells: { lst: [46, 44, 40, 41], shap: { ndvi: [3, 2, 0, 0], built: [2, 1, 0, 1], albedo: [0, 0, 0, 0] } },
  } as unknown as CityDetail;
  const inside = [true, true, false, false];

  it('splits the mean difference between city and ring by group, and keeps what the model misses as Other', () => {
    const budget = islandBudget(city, 'en', inside, 1);
    expect(budget?.observed).toBeCloseTo(4.5);
    expect(budget?.groups.map((g) => [g.id, g.contribution])).toEqual([
      ['green', 2.5],
      ['built', 1],
      ['surface', 0],
    ]);
    expect(budget?.other).toBeCloseTo(1); // 4.5 observed − 3.5 explained
  });

  it('gives nothing with too few cells on a side', () => {
    expect(islandBudget(city, 'en', inside, 3)).toBeNull();
  });
});
