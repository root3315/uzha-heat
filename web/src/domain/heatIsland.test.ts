import { describe, expect, it } from 'vitest';
import { heatIslandIntensity, insideMask } from './heatIsland';

const square = { type: 'Polygon' as const, coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };

describe('insideMask', () => {
  it('marks the cells inside the outline', () => {
    expect(insideMask([5, 15, 1], [5, 5, 9], square)).toEqual([true, false, true]);
  });

  it('counts everything as inside without an outline', () => {
    expect(insideMask([5, 15], [5, 5], null)).toEqual([true, true]);
  });
});

describe('heatIslandIntensity', () => {
  const sides = (inside: number[], outside: number[]) => ({
    lst: [...inside, ...outside],
    mask: [...inside.map(() => true), ...outside.map(() => false)],
  });
  const many = (value: number, n = 40) => Array.from({ length: n }, (_, i) => value + (i % 5) - 2);

  it('is the inside median minus the outside median', () => {
    const { lst, mask } = sides(many(45), many(43));
    const island = heatIslandIntensity(lst, mask);
    expect(island?.inside).toBeCloseTo(45);
    expect(island?.outside).toBeCloseTo(43);
    expect(island?.intensity).toBeCloseTo(2);
  });

  it('is negative when the city is cooler than its surroundings', () => {
    const { lst, mask } = sides(many(40), many(42.5));
    expect(heatIslandIntensity(lst, mask)?.intensity).toBeCloseTo(-2.5);
  });

  it('is not moved by a few extreme cells, unlike a mean', () => {
    const { lst, mask } = sides([...many(45), 70, 70, 70], many(43));
    expect(heatIslandIntensity(lst, mask)?.intensity).toBeCloseTo(2, 0);
  });

  it('skips missing readings and refuses a side that is too small', () => {
    const { lst, mask } = sides([...many(45), Number.NaN], many(43, 10));
    expect(heatIslandIntensity(lst, mask)).toBeNull();
  });
});
