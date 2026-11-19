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
    expect(v?.cities.tashkent?.aqua?.day?.r).toBe(0.85);
    expect(v?.cities.tashkent?.aqua?.heatIsland.night).toEqual({ '1km': 2.24, '5km': null });
    expect(v?.cities.tashkent?.terra).toBeUndefined();
  });

  it('reads the agreement inside the city outline, and leaves it null in an older file without it', () => {
    const inside = { n: 734, r: 0.85, bias: 0.4, rmse: 1.69 };
    expect(parseValidation({ cities: { tashkent: { aqua: { ...platform, dayInsideCity: inside } } } })?.cities.tashkent?.aqua?.dayInsideCity).toEqual(inside);
    expect(parseValidation({ cities: { tashkent: { aqua: platform } } })?.cities.tashkent?.aqua?.dayInsideCity).toBeNull();
  });

  it('keeps the heat island when the day comparison is missing', () => {
    const v = parseValidation({ cities: { bukhara: { aqua: { ...platform, day: { n: 2, r: null, bias: null, rmse: null } } } } });
    expect(v?.cities.bukhara?.aqua?.day).toBeNull();
    expect(v?.cities.bukhara?.aqua?.heatIsland.day).toEqual({ '1km': 1.76 });
  });

  it('drops a malformed platform and rejects a document without cities', () => {
    expect(parseValidation({ cities: { tashkent: { aqua: { day: {} } } } })?.cities.tashkent?.aqua).toBeUndefined();
    expect(parseValidation({})).toBeNull();
  });
});
