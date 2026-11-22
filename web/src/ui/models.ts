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

/** Past this the surface worker is taken as lost and the page computes the surface itself. */
const SURFACE_TIMEOUT_MS = 30_000;

let worker: Worker | null | undefined;
let nextRequest = 0;

function surfaceWorker(): Worker | null {
  if (worker === undefined) {
    try {
      worker = typeof Worker === 'undefined' ? null : startWorker();
    } catch {
      worker = null;
    }
  }
  return worker;
}

/**
 * The worker is started before it is asked anything, so a script that fails to load (old browser, strict CSP) may
 * say so while nobody listens: it is dropped then, and the next request computes on the page instead of timing out.
 */
function startWorker(): Worker {
  const started = new Worker(new URL('./surface.worker.ts', import.meta.url), { type: 'module' });
  started.addEventListener('error', () => {
    if (worker !== started) return;
    started.terminate();
    worker = null;
  });
  return started;
}

/**
 * One request at a time: the worker answers in order, so a request posted behind others would spend its timeout
 * waiting, and a timeout terminates the worker under the requests still in it. Each one is posted when the last is done.
 */
let surfaceQueue: Promise<unknown> = Promise.resolve();

/** The surface computed in the worker from its own copy of the file; null when there is no worker to ask. */
function surfaceInWorker(bytes: Uint8Array, outline: Outline | null): Promise<CitySurface | null> {
  const run = surfaceQueue.then(() => askSurfaceWorker(bytes, outline));
  surfaceQueue = run.catch(() => null);
  return run;
}

function askSurfaceWorker(bytes: Uint8Array, outline: Outline | null): Promise<CitySurface | null> {
  const target = surfaceWorker();
  if (!target) return Promise.resolve(null);
  const id = ++nextRequest;
  return new Promise((resolve) => {
    const done = (surface: CitySurface | null) => {
      clearTimeout(timer);
      target.removeEventListener('message', onMessage);
      target.removeEventListener('error', onError);
      target.removeEventListener('messageerror', onError);
      resolve(surface);
    };
    const onMessage = ({ data }: MessageEvent<SurfaceReply>) => {
      if (data.id === id) done('surface' in data ? data.surface : null);
    };
    // A worker that cannot start (old browser, strict CSP) or cannot pass its answer back is not an error: the page
    // computes the surface itself.
    const onError = () => {
      target.terminate();
      worker = null;
      done(null);
    };
    // Silent too long (a phone may kill it for memory): the page computes the surface itself rather than load forever.
    const timer = setTimeout(() => {
      target.terminate();
      if (worker === target) worker = undefined;
      done(null);
    }, SURFACE_TIMEOUT_MS);
    target.addEventListener('message', onMessage);
    target.addEventListener('error', onError);
    target.addEventListener('messageerror', onError);
    const copy = bytes.slice().buffer;
    const request: SurfaceRequest = { id, bytes: copy, outline };
    target.postMessage(request, [copy]);
  });
}

const nextTask = () => new Promise((resolve) => window.setTimeout(resolve, 0));

async function build(id: string): Promise<CityModel | null> {
  report(id, { outline: null, download: null, building: false });
  // Start the worker while the file downloads: its script loads and compiles now, not after the last byte arrives.
  surfaceWorker();
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
