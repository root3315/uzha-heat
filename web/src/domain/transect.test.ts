import { describe, expect, it } from 'vitest';
import { defaultTransect, dominantCause, hottestPatch, mergeSegments, sampleAt, sampleTransect, smoothTags, type TransectSource } from './transect';

/**
 * A flat test city in plain metres (lon = x, lat = y), 10 km wide, 1 cell per 100 m.
 * It is hot in the middle (x 4–6 km) because of `ndvi`, and cooled by `water` near x = 9 km.
 */
function planarCity(width = 10_000): TransectSource {
  return {
    toMetres: ([x, y]) => [x, y],
    fromMetres: ([x, y]) => [x, y],
    cellAt: ([x, y]) => (x >= 0 && x <= width && y >= 0 && y <= width ? Math.floor(x / 100) : -1),
    inside: ([x]) => x >= 500,
    temperatureAt: ([x]) => (x > 4000 && x < 6000 ? 50 : 42),
    contributionsOf: (cell) => {
      const x = cell * 100;
      if (x > 4000 && x < 6000) return { ndvi: 4, water: 0.5 };
      if (x > 8800) return { ndvi: 0.2, water: -2 };
      return { ndvi: 0.3, water: 0.1 };
    },
  };
}

describe('dominantCause', () => {
  it('takes the largest contribution by size, either sign', () => {
    expect(dominantCause({ a: 1, b: -3, c: 2 })).toEqual({ key: 'b', value: -3 });
    expect(dominantCause({})).toBeNull();
  });
});

describe('smoothTags', () => {
  it('replaces an isolated flip with the local majority and keeps gaps', () => {
    expect(smoothTags(['a', 'a', 'b', 'a', 'a', null], 2)).toEqual(['a', 'a', 'a', 'a', 'a', null]);
  });
});

describe('mergeSegments', () => {
  const d = [0, 100, 200, 300, 400, 500, 600, 700, 800];

  it('turns runs of one tag into stretches that meet end to end', () => {
    const tags = ['a:heats', 'a:heats', 'a:heats', 'a:heats', 'b:cools', 'b:cools', 'b:cools', 'b:cools', 'b:cools'];
    expect(mergeSegments(d, tags, 50)).toEqual([
      { key: 'a', heats: true, d0: 0, d1: 400 },
      { key: 'b', heats: false, d0: 400, d1: 800 },
    ]);
  });

  it('folds a sliver into the stretch before it', () => {
    const tags = ['a:heats', 'a:heats', 'a:heats', 'b:heats', 'a:heats', 'a:heats', 'a:heats', 'a:heats', 'a:heats'];
    expect(mergeSegments(d, tags, 150)).toEqual([{ key: 'a', heats: true, d0: 0, d1: 800 }]);
  });

  it('folds a leading sliver into the stretch after it', () => {
    const tags = ['b:heats', 'a:heats', 'a:heats', 'a:heats', 'a:heats', 'a:heats', 'a:heats', 'a:heats', 'a:heats'];
    expect(mergeSegments(d, tags, 150)).toEqual([{ key: 'a', heats: true, d0: 0, d1: 800 }]);
  });

  it('leaves gaps where there is no data', () => {
    const tags = [null, null, 'a:heats', 'a:heats', 'a:heats', 'a:heats', null, null, null];
    expect(mergeSegments(d, tags, 50)).toEqual([{ key: 'a', heats: true, d0: 200, d1: 600 }]);
  });
});

describe('sampleTransect', () => {
  const source = planarCity();
  const profile = sampleTransect(source, [[0, 50], [10_000, 50]], { stepM: 50, smoothWindow: 2, minSegmentM: 300 });

  it('samples evenly along the line and measures it in metres', () => {
    expect(profile.length).toBe(10_000);
    expect(profile.samples).toHaveLength(201);
    expect(profile.samples[1]?.d).toBeCloseTo(50);
  });

  it('marks samples outside the city as outside and gives them no cause', () => {
    expect(profile.samples[0]?.inside).toBe(false);
    expect(profile.samples[0]?.cause).toBeNull();
    expect(profile.samples[20]?.inside).toBe(true);
  });

  it('reads the hot middle as heated by ndvi and the far end as cooled by water', () => {
    const middle = profile.segments.find((s) => s.d0 < 5000 && s.d1 > 5000);
    expect(middle).toMatchObject({ key: 'ndvi', heats: true });
    expect(profile.segments[profile.segments.length - 1]).toMatchObject({ key: 'water', heats: false });
  });

  it('finds the nearest sample to a distance', () => {
    expect(sampleAt(profile, 5020)?.d).toBe(5000);
    expect(sampleAt(profile, 99_999)?.d).toBe(10_000);
  });
});

describe('defaultTransect', () => {
  it('keeps both ends inside and crosses the hot middle along the biggest swing', () => {
    const source = planarCity(20_000);
    const [a, b] = defaultTransect(source, [5000, 5000], { halfLengthsM: [3000], angleStepDeg: 45 });
    expect(source.inside(a) && source.inside(b)).toBe(true);
    expect(Math.abs(a[1] - b[1])).toBeLessThan(1);
  });
});

describe('hottestPatch', () => {
  it('finds the centre of the hottest neighbourhood among allowed pixels', () => {
    const w = 20;
    const values = Array.from({ length: w * w }, (_, i) => (Math.abs((i % w) - 14) < 3 && Math.abs(Math.floor(i / w) - 6) < 3 ? 50 : 40));
    expect(hottestPatch(values, w, w, () => true, 2, 1)).toEqual([14, 6]);
    expect(hottestPatch(values, w, w, () => false, 2, 1)).toBeNull();
  });
});
