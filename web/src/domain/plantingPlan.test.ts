import { describe, expect, it } from 'vitest';
import type { CityDetail, TreeModel } from '../data/contract';
import { plantingPlan } from './plantingPlan';

/** One stump: tree < 10 → +2 else −1, so greening a bare cell up to 10 % crowns cools it by 3°. */
const STUMP: TreeModel = {
  features: ['tree'],
  baseScore: 40,
  trees: [{ feature: [0, -1, -1], value: [10, 2, -1], left: [1, -1, -1], defaultLeft: [1, 0, 0] }],
};

/** Cells in a row along the equator, 0.01° (≈1.1 km) apart. */
function city(tree: number[], pop: number[] | undefined): CityDetail {
  return {
    cells: { lon: tree.map((_, i) => i * 0.01), lat: tree.map(() => 0), lst: tree.map(() => 45), values: { tree }, shap: {}, pop },
  } as unknown as CityDetail;
}

// The city's own 95th percentile of tree cover is well above 10, so the bare cells can be greened past the split.
const tree = [0, 0, 0, 30, 0, 40, 50, 60, 70, 80];
const pop = [100, 4000, 900, 9000, 0, 5000, 5000, 5000, 5000, 5000];
const all = tree.map(() => true);

describe('plantingPlan', () => {
  it('ranks places by degrees of cooling times people, so a crowded block beats a hotter empty one', () => {
    const plan = plantingPlan(STUMP, city(tree, pop), all);
    expect(plan.map((p) => p.cell)).toEqual([1, 2, 0]);
    expect(plan[0]).toMatchObject({ cell: 1, cooling: 3, people: 4000 });
  });

  it('skips cells that are already green: the model has nothing to give there', () => {
    const plan = plantingPlan(STUMP, city(tree, pop), all);
    expect(plan.some((p) => p.cell === 3)).toBe(false);
  });

  it('skips empty cells and cells outside the city outline', () => {
    const inside = tree.map((_, i) => i !== 1);
    const plan = plantingPlan(STUMP, city(tree, pop), inside);
    expect(plan.map((p) => p.cell)).toEqual([2, 0]);
  });

  it('keeps places apart, so the list is different neighbourhoods and not one block counted twice', () => {
    const plan = plantingPlan(STUMP, city(tree, pop), all, 5, 2000);
    expect(plan.map((p) => p.cell)).toEqual([1]);
  });

  it('stops at the asked count', () => {
    expect(plantingPlan(STUMP, city(tree, pop), all, 2)).toHaveLength(2);
  });

  it('is empty without population data', () => {
    expect(plantingPlan(STUMP, city(tree, undefined), all)).toEqual([]);
  });
});
