import { describe, expect, it } from 'vitest';
import { parseValidation } from './validation';

const platform = {
  product: 'MYD11A2',
  overpassLocal: { day: '~13:30', night: '~01:30' },
  composites: 25,
  day: { n: 913, r: 0.85, bias: 0.41, rmse: 1.66 },
  heatIsland: { day: { '1km': 1.76 }, night: { '1km': 2.24, '5km': null } },
};

describe('parseValidation', () => {
  it('reads a city and keeps missing rings as null', () => {
    const v = parseValidation({ period: 'лето', cities: { tashkent: { aqua: platform } } });
    expect(v?.cities.tashkent?.aqua?.day.r).toBe(0.85);
    expect(v?.cities.tashkent?.aqua?.heatIsland.night).toEqual({ '1km': 2.24, '5km': null });
    expect(v?.cities.tashkent?.terra).toBeUndefined();
  });

  it('drops a malformed platform and rejects a document without cities', () => {
    expect(parseValidation({ cities: { tashkent: { aqua: { day: { r: 'x' } } } } })?.cities.tashkent?.aqua).toBeUndefined();
    expect(parseValidation({})).toBeNull();
  });
});
