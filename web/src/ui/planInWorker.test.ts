import { describe, expect, it } from 'vitest';
import type { CityDetail, TreeModel } from '../data/contract';
import { plantingPlan } from '../domain/plantingPlan';
import { computePlan } from './planInWorker';

const STUMP: TreeModel = {
  features: ['tree'],
  baseScore: 40,
  trees: [{ feature: [0, -1, -1], value: [10, 2, -1], left: [1, -1, -1], defaultLeft: [1, 0, 0] }],
};
const tree = [0, 0, 30, 0, 40, 50, 60];
const detail = {
  cells: { lon: tree.map((_, i) => i * 0.01), lat: tree.map(() => 0), lst: tree.map(() => 45), values: { tree }, shap: {}, pop: [100, 4000, 0, 900, 50, 50, 50] },
} as unknown as CityDetail;

describe('computePlan', () => {
  it('computes the plan itself where there is no worker, as in an old browser', async () => {
    const all = tree.map(() => true);
    expect(typeof Worker).toBe('undefined');
    const plan = await computePlan(STUMP, detail, all, 2);
    expect(plan).toEqual(plantingPlan(STUMP, detail, all, 2));
    expect(plan.map((p) => p.cell)).toEqual([1, 3]);
  });
});
