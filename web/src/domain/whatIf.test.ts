import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TreeModel } from '../data/contract';
import { parseTreeModel } from '../data/parse';
import { balanceCover, factorRanges, leversFor, predict, predictRow, whatIf } from './whatIf';

/**
 * Two stumps by hand: tree < 10 → +2 else −1; ndvi < 0.3 → +1 else −0.5 (missing ndvi goes right).
 * Base 40, so a bare hot cell is 43 and a green one 38.5.
 */
const TOY: TreeModel = {
  features: ['tree', 'ndvi', 'built'],
  baseScore: 40,
  trees: [
    { feature: [0, -1, -1], value: [10, 2, -1], left: [1, -1, -1], defaultLeft: [1, 0, 0] },
    { feature: [1, -1, -1], value: [0.3, 1, -0.5], left: [1, -1, -1], defaultLeft: [0, 0, 0] },
  ],
};

describe('predict', () => {
  it('walks every tree and adds the base score', () => {
    expect(predict(TOY, { tree: 0, ndvi: 0.1, built: 90 })).toBe(43);
    expect(predict(TOY, { tree: 30, ndvi: 0.5, built: 10 })).toBe(38.5);
  });

  it('goes right on equality, like XGBoost (x < threshold goes left)', () => {
    expect(predict(TOY, { tree: 10, ndvi: 0.3, built: 0 })).toBe(38.5);
  });

  it('compares in float32: a value equal to the threshold after rounding to float32 goes right', () => {
    // 0.3 as a double is a hair below its float32 (0.30000001192…), but XGBoost sees both as the same float32.
    expect(predictRow(TOY, [0, 0.3, 0])).toBe(40 + 2 - 0.5);
  });

  it('sends a missing value the default way', () => {
    expect(predict(TOY, { built: 0 })).toBe(40 + 2 - 0.5);
  });

  it('treats a row shorter than the factor list as missing the rest', () => {
    expect(predictRow(TOY, [0])).toBe(40 + 2 - 0.5);
  });

  it('gives the same answer from the second call on, when the trees are already packed', () => {
    const row = [3, 0.1, 50];
    expect(predictRow(TOY, row)).toBe(predictRow(TOY, row));
    expect(predictRow(TOY, row)).toBe(43);
  });
});

describe('whatIf', () => {
  const cell = { tree: 0, ndvi: 0.1, built: 90 };

  it('returns the model before and after, and the difference', () => {
    expect(whatIf(TOY, cell, { tree: 25 })).toEqual({ before: 43, after: 40, delta: -3 });
  });

  it('clamps a change to the range the city has', () => {
    const ranges = { tree: [0, 8] as const };
    expect(whatIf(TOY, cell, { tree: 25 }, ranges).delta).toBe(0);
  });

  it('changes nothing for an empty change', () => {
    expect(whatIf(TOY, cell, {}).delta).toBe(0);
  });

  it('lets a cell already past the range keep its value and move only back into the range', () => {
    const ranges = { tree: [0, 8] as const };
    const lush = { tree: 30, ndvi: 0.5, built: 0 };
    expect(whatIf(TOY, lush, { tree: 30 }, ranges).delta).toBe(0);
    expect(whatIf(TOY, lush, { tree: 50 }, ranges).after).toBe(predict(TOY, lush));
    expect(whatIf(TOY, lush, { tree: 5 }, ranges).delta).toBe(3);
  });
});

describe('balanceCover', () => {
  it('takes added crowns from bare ground first, then from built-up', () => {
    const cell = { tree: 5, built: 80, bare: 10, ndvi: 0.2 };
    // 5 + 80 + 10 = 95 %: crowns to 25 % leave 15 points too many, 10 from bare ground and 5 from built-up.
    expect(balanceCover(cell, { ...cell, tree: 25 })).toEqual({ tree: 25, built: 75, bare: 0, ndvi: 0.2 });
    expect(balanceCover(cell, { ...cell, tree: 12 })).toEqual({ tree: 12, built: 80, bare: 8, ndvi: 0.2 });
  });

  it('leaves room that is already free alone', () => {
    const cell = { tree: 5, built: 50, bare: 10 };
    expect(balanceCover(cell, { ...cell, tree: 25 })).toEqual({ tree: 25, built: 50, bare: 10 });
  });

  it('keeps a cell whose shares already passed 100 % at its own sum', () => {
    const cell = { tree: 10, built: 85, bare: 10 };
    expect(balanceCover(cell, { ...cell, tree: 20 })).toEqual({ tree: 20, built: 85, bare: 0 });
  });

  it('keeps the sum when the reader also lowered built-up', () => {
    const cell = { tree: 0, built: 93, bare: 7 };
    // Built-up already at 92 by hand: bare gives 7, built-up gives 5 more (93 − 25 = 68 is its floor).
    expect(balanceCover(cell, { ...cell, tree: 20, built: 92 })).toEqual({ tree: 20, built: 80, bare: 0 });
  });

  it('never takes built-up past the 25-point cut; the crowns get only the room there is', () => {
    const cell = { tree: 0, built: 100, bare: 0 };
    expect(balanceCover(cell, { ...cell, tree: 34 })).toEqual({ tree: 25, built: 75, bare: 0 });
    expect(balanceCover(cell, { ...cell, tree: 34, built: 75 })).toEqual({ tree: 25, built: 75, bare: 0 });
  });

  it('never leaves the shares over 100 %', () => {
    for (const cell of [{ tree: 0, built: 100, bare: 0 }, { tree: 3, built: 60, bare: 37 }, { tree: 10, built: 88, bare: 2 }]) {
      for (const tree of [10, 20, 34]) {
        for (const built of [cell.built, cell.built - 10, cell.built - 25]) {
          const out = balanceCover(cell, { ...cell, tree, built });
          expect((out.tree ?? 0) + (out.built ?? 0) + (out.bare ?? 0)).toBeLessThanOrEqual(100 + 1e-9);
          expect(out.built ?? 0).toBeGreaterThanOrEqual(cell.built - 25 - 1e-9);
        }
      }
    }
  });

  it('is applied by whatIf', () => {
    const shares: TreeModel = { ...TOY, features: ['tree', 'built', 'bare'], trees: [{ feature: [2, -1, -1], value: [5, 40, 45], left: [1, -1, -1], defaultLeft: [1, 0, 0] }], baseScore: 0 };
    // Bare ground under 5 % predicts 40, else 45: planting on a cell with 10 % bare and no free room takes the bare first.
    expect(whatIf(shares, { tree: 0, built: 90, bare: 10 }, { tree: 20 }).after).toBe(40);
  });
});

describe('factorRanges', () => {
  it('takes the 5th and 95th percentile of each column, skipping non-numbers', () => {
    const column = [...Array.from({ length: 101 }, (_, i) => i), Number.NaN];
    expect(factorRanges({ tree: column, ndvi: [] })).toEqual({ tree: [5, 95] });
  });

  it('takes other percentiles when asked', () => {
    expect(factorRanges({ tree: [3, 0, 40] }, [0, 1])).toEqual({ tree: [0, 40] });
  });
});

describe('leversFor', () => {
  const ranges = { tree: [0, 60], ndvi: [0, 0.8], built: [0, 100] } as const;

  /** TOY plus a tree on built-up: below 70 % it is 1° cooler. */
  const WITH_BUILT: TreeModel = {
    ...TOY,
    trees: [...TOY.trees, { feature: [2, -1, -1], value: [70, -0.5, 0.5], left: [1, -1, -1], defaultLeft: [1, 0, 0] }],
  };

  it('offers each factor in its sensible direction, always in the same order', () => {
    const levers = leversFor(WITH_BUILT, { tree: 0, ndvi: 0.1, built: 90 }, { tree: 0.4, ndvi: 1.5, built: 0.9 }, ranges);
    expect(levers.map((l) => [l.lever.key, l.from, Number(l.to.toFixed(6)), l.bound])).toEqual([
      ['tree', 0, 60, 'city'],
      ['ndvi', 0.1, 0.8, 'city'],
      ['built', 90, 65, 'cut'],
    ]);
  });

  it('cuts built-up by at most 25 points, and not below the city range', () => {
    const cell = { tree: 0, ndvi: 0.1, built: 80 };
    const built = (range: readonly [number, number]) => leversFor(WITH_BUILT, cell, { built: 0.9 }, { ...ranges, built: range }).find((l) => l.lever.key === 'built');
    expect(built([0, 100])).toMatchObject({ to: 55, bound: 'cut' });
    expect(built([60, 100])).toMatchObject({ to: 60, bound: 'city' });
  });

  it('ends an upward slider on the last whole step from the cell, so its end is reachable', () => {
    const [ndvi] = leversFor(TOY, { tree: 60, ndvi: 0.137, built: 0 }, { ndvi: 1 }, { ndvi: [0, 0.8715] });
    expect(ndvi?.to).toBeCloseTo(0.867, 9);
  });

  it('offers less built-up only where it heats the cell and its removal cools it by the model', () => {
    const cell = { tree: 0, ndvi: 0.1, built: 90 };
    expect(leversFor(TOY, cell, { built: 0.9 }, ranges).map((l) => l.lever.key)).not.toContain('built');
    expect(leversFor(WITH_BUILT, cell, { built: -0.2 }, ranges).map((l) => l.lever.key)).not.toContain('built');
  });

  it('starts at the cell when it is already past the range, and then offers no move that way', () => {
    const levers = leversFor(WITH_BUILT, { tree: 75, ndvi: 0.1, built: 3 }, { built: 0.9 }, { ...ranges, built: [10, 95] });
    expect(levers.map((l) => l.lever.key)).toEqual(['ndvi']);
  });

  it('offers nothing where the range has no width, as with trees in a city that has almost none', () => {
    expect(leversFor(TOY, { tree: 0, ndvi: 0.9, built: 0 }, {}, { tree: [0, 0], ndvi: [0, 0.8] })).toEqual([]);
  });

  it('never offers albedo: in these cities it marks open ground rather than a surface one could lighten', () => {
    const withAlbedo: TreeModel = { ...TOY, features: [...TOY.features, 'albedo'] };
    const levers = leversFor(withAlbedo, { tree: 0, ndvi: 0.1, built: 0, albedo: 0.15 }, {}, { ...ranges, albedo: [0.1, 0.4] });
    expect(levers.map((l) => l.lever.key)).not.toContain('albedo');
  });

  it('leaves out a lever with no room left and a factor the model lacks', () => {
    const levers = leversFor(TOY, { tree: 60, ndvi: 0.1, built: 0, albedo: 0.2 }, {}, { ...ranges, albedo: [0.1, 0.4] });
    expect(levers.map((l) => l.lever.key)).toEqual(['ndvi']);
  });
});

describe('model files from the pipeline', () => {
  const dataDir = join(__dirname, '../../public/data');
  for (const city of ['tashkent', 'samarkand', 'bukhara']) {
    const path = join(dataDir, `model-${city}.json`);
    it.runIf(existsSync(path))(`${city}: reproduces the booster's predictions on its check rows to 1e-5`, () => {
      const model = parseTreeModel(JSON.parse(readFileSync(path, 'utf-8')));
      const { rows, prediction } = model.check ?? { rows: [], prediction: [] };
      expect(rows.length).toBeGreaterThan(0);
      rows.forEach((row, i) => expect(Math.abs(predictRow(model, row) - (prediction[i] ?? Number.NaN))).toBeLessThan(1e-5));
    });
  }
});
