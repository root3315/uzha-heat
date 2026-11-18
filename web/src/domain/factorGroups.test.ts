import { describe, expect, it } from 'vitest';
import type { CityDetail } from '../data/contract';
import { groupShares } from './factorGroups';

const detail = (shap: Record<string, number[]>) => ({ cells: { lst: [40, 50], shap } }) as unknown as CityDetail;

describe('groupShares', () => {
  it('sums members before taking the size, so opposite pulls inside a group cancel', () => {
    const shares = groupShares(detail({ ndvi: [2, -1], tree: [-2, 1], built: [1, 1] }));
    expect(shares.map((g) => [g.id, g.meanAbs])).toEqual([['built', 1]]);
  });

  it('counts only the cells inside the outline when given a mask', () => {
    const shares = groupShares(detail({ ndvi: [3, 0], built: [0, 1] }), [true, false]);
    expect(shares.map((g) => [g.id, g.share])).toEqual([['green', 1]]);
  });

  it('splits the mean magnitude between groups', () => {
    const shares = groupShares(detail({ ndvi: [3, 3], built: [1, 1] }));
    expect(shares.map((g) => [g.id, g.share])).toEqual([
      ['green', 0.75],
      ['built', 0.25],
    ]);
  });
});
