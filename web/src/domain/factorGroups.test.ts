import { describe, expect, it } from 'vitest';
import type { CityDetail } from '../data/contract';
import { groupShares } from './factorGroups';

const detail = (shap: Record<string, number[]>) => ({ cells: { lst: [40, 50], shap } }) as unknown as CityDetail;

describe('groupShares', () => {
  it('sums members before taking the size, so opposite pulls inside a group cancel', () => {
    const shares = groupShares(detail({ ndvi: [2, -1], tree: [-2, 1], built: [1, 1] }));
    expect(shares.map((g) => [g.id, g.meanAbs])).toEqual([['built', 1]]);
  });

  it('splits the explained part between groups', () => {
    const shares = groupShares(detail({ ndvi: [3, 3], built: [1, 1] }));
    expect(shares.map((g) => [g.id, g.share])).toEqual([
      ['green', 0.75],
      ['built', 0.25],
    ]);
  });
});
