import type { Feature } from 'geojson';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { followView } from './fileBuildings';

/** Each read waits until the test lets it go, so a slow request can be overtaken by a camera move. */
const reads: Array<{ release: () => void }> = [];

vi.mock('flatgeobuf/geojson', () => ({
  deserialize: () =>
    (async function* stream(): AsyncGenerator<Feature> {
      await new Promise<void>((resolve) => reads.push({ release: resolve }));
      yield { type: 'Feature', properties: { h: 10 }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } };
    })(),
}));

/** A map whose view is a small square around its centre, with a source that records what it was given. */
function fakeMap() {
  let center: [number, number] = [69.2, 41.3];
  const handlers: Array<() => void> = [];
  const setData = vi.fn();
  const map = {
    getZoom: () => 16,
    getCenter: () => ({ toArray: () => center }),
    getBounds: () => ({
      getWest: () => center[0] - 0.001,
      getSouth: () => center[1] - 0.001,
      getEast: () => center[0] + 0.001,
      getNorth: () => center[1] + 0.001,
    }),
    getSource: () => ({ setData }),
    on: (_: string, handler: () => void) => handlers.push(handler),
    off: () => undefined,
  };
  const moveTo = (next: [number, number]) => {
    center = next;
    handlers.forEach((handler) => handler());
  };
  return { map: map as unknown as MapLibreMap, setData, moveTo };
}

/** Let the queued timer fire, then the dynamic import and the stream settle. */
async function settle() {
  await vi.advanceTimersByTimeAsync(500);
  await vi.dynamicImportSettled();
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}

describe('followView', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('window', globalThis);
    reads.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('drops a read for a view left behind when the camera comes back over the loaded buildings', async () => {
    const { map, setData, moveTo } = fakeMap();
    const options = { url: 'x.fgb', source: 'b', minZoom: 14, temperatureAt: () => 40, classOf: () => 1, onData: vi.fn(), onFail: vi.fn() };
    const stop = followView(map, options);
    await settle();
    reads.shift()?.release();
    await settle();
    expect(setData).toHaveBeenCalledTimes(1);

    moveTo([69.5, 41.5]);
    await settle();
    expect(reads).toHaveLength(1);
    moveTo([69.2, 41.3]);
    await settle();
    reads.shift()?.release();
    await settle();

    expect(setData).toHaveBeenCalledTimes(1);
    expect(options.onFail).not.toHaveBeenCalled();
    stop();
  });
});
