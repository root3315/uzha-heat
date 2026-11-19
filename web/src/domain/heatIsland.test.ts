import { describe, expect, it } from 'vitest';
import { heatIslandIntensity, insideMask, referenceIsland } from './heatIsland';

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

describe('referenceIsland', () => {
  // 40 city cells at 45 °C; a ring of 40 dry cells at 42 °C and 40 irrigated fields at 36 °C.
  const city = Array.from({ length: 40 }, () => 45);
  const dry = Array.from({ length: 40 }, () => 42);
  const fields = Array.from({ length: 40 }, () => 36);
  const lst = [...city, ...dry, ...fields];
  const inside = lst.map((_, i) => i < 40);
  const values = {
    ndvi: [...city.map(() => 0.2), ...dry.map(() => 0.15), ...fields.map(() => 0.7)],
    built: [...city.map(() => 80), ...dry.map(() => 2), ...fields.map(() => 1)],
    elevation: lst.map(() => 450),
  };

  it('leaves irrigated fields out of the reference, and says how much that moves the island', () => {
    const result = referenceIsland(lst, values, inside);
    expect(result.island?.intensity).toBe(3); // 45 against the dry ring only
    const irrigated = result.rules.find((rule) => rule.id === 'irrigated');
    expect(irrigated?.removed).toBe(40);
    expect(irrigated?.island?.intensity).toBe(3);
    expect(result.rules.find((rule) => rule.id === 'water')?.removed).toBe(0);
  });

  it('never removes a city cell', () => {
    const result = referenceIsland(lst, values, inside);
    expect(result.island?.insideCount).toBe(40);
  });
});
