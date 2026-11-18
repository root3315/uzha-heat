import type { Feature } from 'geojson';
import { describe, expect, it } from 'vitest';
import { buildingsUrl, classify, collect, covers, isFlatGeobuf, viewRect } from './buildingsData';

const square: Feature = {
  type: 'Feature',
  properties: { h: 15, conf: 0.6, src: 1 },
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] },
};

async function* stream(n: number): AsyncGenerator<Feature> {
  for (let i = 0; i < n; i += 1) yield square;
}

describe('isFlatGeobuf', () => {
  it('knows the file by its magic bytes and not the HTML a missing file comes back as', () => {
    expect(isFlatGeobuf(new Uint8Array([0x66, 0x67, 0x62, 3, 0, 0x66, 0x67, 0x62]))).toBe(true);
    expect(isFlatGeobuf(new TextEncoder().encode('<!doctype html>'))).toBe(false);
    expect(isFlatGeobuf(new Uint8Array([]))).toBe(false);
  });
});

describe('viewRect', () => {
  it('keeps a small view as it is', () => {
    expect(viewRect([69.2, 41.3, 69.21, 41.31], [69.205, 41.305])).toEqual({ minX: 69.2, minY: 41.3, maxX: 69.21, maxY: 41.31 });
  });

  it('cuts a view reaching the horizon to a square around the centre', () => {
    const rect = viewRect([68, 40, 70, 42], [69, 41], 1113.2);
    expect(rect.maxY - rect.minY).toBeCloseTo(0.02, 6);
    expect(rect.maxX - rect.minX).toBeCloseTo(0.02 / Math.cos((41 * Math.PI) / 180), 6);
  });
});

describe('covers', () => {
  it('says whether the loaded area already holds the view', () => {
    const loaded = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(covers(loaded, { minX: 1, minY: 1, maxX: 9, maxY: 9 })).toBe(true);
    expect(covers(loaded, { minX: 1, minY: 1, maxX: 11, maxY: 9 })).toBe(false);
    expect(covers(null, loaded)).toBe(false);
  });
});

describe('classify', () => {
  it('adds the temperature class under the building and keeps its height', () => {
    const building = classify(square, () => 47, (t) => (t > 45 ? 6 : 0));
    expect(building?.properties).toEqual({ h: 15, conf: 0.6, src: 1, k: 6 });
  });

  it('skips anything that is not a polygon', () => {
    expect(classify({ ...square, geometry: { type: 'Point', coordinates: [0, 0] } }, () => 40, () => 3)).toBeNull();
  });
});

describe('collect', () => {
  it('stops at the cap', async () => {
    const out = await collect(stream(10), (f) => f, 4, new AbortController().signal);
    expect(out).toHaveLength(4);
  });

  it('gives nothing for a view the reader has already left', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await collect(stream(10), (f) => f, 4, controller.signal)).toBeNull();
  });
});

it('builds the file URL under the app base', () => {
  expect(buildingsUrl('/uzha/', 'samarkand')).toBe('/uzha/data/buildings/samarkand.fgb');
});
