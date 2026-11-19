import { describe, expect, it } from 'vitest';
import { parsePlanUncertainty, spreadFor } from './planUncertainty';

describe('parsePlanUncertainty', () => {
  const file = { tashkent: { replicates: 50, places: [{ cell: 7, cooling: 4.67, low: 3, median: 4, high: 5.1 }, { cell: 'x' }] } };

  it('reads the places and drops a malformed one', () => {
    expect(parsePlanUncertainty(file).tashkent?.places).toHaveLength(1);
  });

  it('finds the spread only for the very cell in that city', () => {
    const parsed = parsePlanUncertainty(file);
    expect(spreadFor(parsed, 'tashkent', 7)?.low).toBe(3);
    expect(spreadFor(parsed, 'tashkent', 8)).toBeUndefined();
    expect(spreadFor(parsed, 'bukhara', 7)).toBeUndefined();
    expect(spreadFor(null, 'tashkent', 7)).toBeUndefined();
  });

  it('gives nothing for a file that is not an object', () => {
    expect(parsePlanUncertainty(null)).toEqual({});
  });
});
