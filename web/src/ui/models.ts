import { MissingDataError, loadBoundary, loadCityBytes, parseCityBytes, type Download } from '../data/load';
import { assembleCityModel, citySurface, type CityModel, type CitySurface, type Outline } from '../domain/cityModel';
import type { SurfaceReply, SurfaceRequest } from './surface.worker';

/** Where the loading of one city is: its outline as soon as it is known, then the download, then the build. */
export interface LoadStage {
  outline: Outline | null;
  download: Download | null;
  building: boolean;
}

type Listener = (stage: LoadStage) => void;

const cache = new Map<string, Promise<CityModel | null>>();
const stages = new Map<string, LoadStage>();
const listeners = new Map<string, Set<Listener>>();

function report(id: string, change: Partial<LoadStage>): void {
  const stage = { ...(stages.get(id) ?? { outline: null, download: null, building: false }), ...change };
  stages.set(id, stage);
  listeners.get(id)?.forEach((listener) => listener(stage));
}

/** Follow the loading of a city; called at once with what is known so far. Returns the unsubscribe. */
export function watchLoad(id: string, listener: Listener): () => void {
  const set = listeners.get(id) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(id, set);
  const stage = stages.get(id);
  if (stage) listener(stage);
  return () => set.delete(listener);
}

let worker: Worker | null | undefined;
let nextRequest = 0;

function surfaceWorker(): Worker | null {
  if (worker === undefined) {
    try {
      worker = typeof Worker === 'undefined' ? null : new Worker(new URL('./surface.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      worker = null;
    }
  }
  return worker;
}

/** The surface computed in the worker from its own copy of the file; null when there is no worker to ask. */
function surfaceInWorker(bytes: Uint8Array, outline: Outline | null): Promise<CitySurface | null> {
  const target = surfaceWorker();
  if (!target) return Promise.resolve(null);
  const id = ++nextRequest;
  return new Promise((resolve) => {
    const done = (surface: CitySurface | null) => {
      target.removeEventListener('message', onMessage);
      target.removeEventListener('error', onError);
      resolve(surface);
    };
    const onMessage = ({ data }: MessageEvent<SurfaceReply>) => {
      if (data.id === id) done('surface' in data ? data.surface : null);
    };
    // A worker that cannot start (old browser, strict CSP) is not an error: the page computes the surface itself.
    const onError = () => {
      worker = null;
      done(null);
    };
    target.addEventListener('message', onMessage);
    target.addEventListener('error', onError);
    const copy = bytes.slice().buffer;
    const request: SurfaceRequest = { id, bytes: copy, outline };
    target.postMessage(request, [copy]);
  });
}

const nextTask = () => new Promise((resolve) => window.setTimeout(resolve, 0));

async function build(id: string): Promise<CityModel | null> {
  report(id, { outline: null, download: null, building: false });
  const outlined = loadBoundary(id).then((outline) => {
    report(id, { outline });
    return outline;
  });
  const bytes = await loadCityBytes(id, (download) => report(id, { download })).catch((error: unknown) => {
    if (error instanceof MissingDataError) return null;
    throw error;
  });
  if (!bytes) return null;
  const outline = await outlined;
  report(id, { building: true });
  // Let the build line paint before the main thread parses its own copy.
  await nextTask();
  const pending = surfaceInWorker(bytes, outline);
  const detail = parseCityBytes(bytes);
  const surface = (await pending) ?? citySurface(detail, outline);
  return assembleCityModel(detail, outline, surface);
}

/** One model per city for the whole page: the map, the city rows and the method share it. Null: no data yet. */
export function cityModel(id: string): Promise<CityModel | null> {
  let pending = cache.get(id);
  if (!pending) {
    pending = build(id);
    pending.catch(() => cache.delete(id));
    cache.set(id, pending);
  }
  return pending;
}
