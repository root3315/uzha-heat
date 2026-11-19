import type { CityDetail, TreeModel } from '../data/contract';
import { plantingPlan, type PlantingPlace } from '../domain/plantingPlan';
import type { PlanReply, PlanRequest } from './plan.worker';

/**
 * How long one plan may take in the worker, counted from when the worker starts on it (it gets one request at a
 * time). Past it the worker is taken as lost, as when a phone kills it for memory.
 */
export const WORKER_TIMEOUT_MS = 30_000;

export class PlanTimeoutError extends Error {
  constructor() {
    super('the plan took too long');
  }
}

interface Job {
  request: PlanRequest;
  /** null: no worker to ask, the caller computes the plan itself. */
  resolve: (plan: PlantingPlace[] | null) => void;
  reject: (error: Error) => void;
}

/** The worker; null once it could not start (old browser, strict CSP): every plan is then computed on the page. */
let worker: Worker | null | undefined;
const queue: Job[] = [];
let running: { job: Job; timer: ReturnType<typeof setTimeout> } | null = null;
let nextRequest = 0;

function finish(settle: (job: Job) => void): void {
  if (!running) return;
  clearTimeout(running.timer);
  settle(running.job);
  running = null;
  pump();
}

function startWorker(): Worker | null {
  try {
    if (typeof Worker === 'undefined') return null;
    const created = new Worker(new URL('./plan.worker.ts', import.meta.url), { type: 'module' });
    created.addEventListener('message', ({ data }: MessageEvent<PlanReply>) => {
      if (running?.job.request.id !== data.id) return;
      // An error inside the worker is a bug in one plan, not a lost worker: the page tries that plan itself.
      finish((job) => job.resolve('plan' in data ? data.plan : null));
    });
    // A worker that cannot start or cannot pass its answer back is not an error: the page computes the plans itself.
    const giveUp = () => {
      created.terminate();
      worker = null;
      finish((job) => job.resolve(null));
    };
    created.addEventListener('error', giveUp);
    created.addEventListener('messageerror', giveUp);
    return created;
  } catch {
    return null;
  }
}

/** Sends the next waiting plan to the worker once it is free. */
function pump(): void {
  if (running || !queue.length) return;
  if (worker === undefined) worker = startWorker();
  const target = worker;
  if (!target) {
    queue.splice(0).forEach((job) => job.resolve(null));
    return;
  }
  const job = queue.shift() as Job;
  // Silent past the limit: stop that worker (a fresh one takes the next plan) and report the plan as failed, rather
  // than run the whole city on the page and freeze it, which is what the worker is there to avoid.
  const timer = setTimeout(() => {
    target.terminate();
    if (worker === target) worker = undefined;
    finish((stuck) => stuck.reject(new PlanTimeoutError()));
  }, WORKER_TIMEOUT_MS);
  running = { job, timer };
  target.postMessage(job.request);
}

function askWorker(model: TreeModel, detail: CityDetail, inside: readonly boolean[], count: number): Promise<PlantingPlace[] | null> {
  const { pop, lon, lat, values } = detail.cells;
  // The model without its check rows, and only the columns the plan reads: less to copy.
  const request: PlanRequest = {
    id: ++nextRequest,
    model: { features: model.features, baseScore: model.baseScore, trees: model.trees },
    cells: { pop, lon, lat, values },
    inside,
    count,
  };
  return new Promise((resolve, reject) => {
    queue.push({ request, resolve, reject });
    pump();
  });
}

/**
 * "Where to plant first" for a city, computed off the main thread where the browser allows it: the whole city through
 * the model takes a second on a laptop and several on a phone, and the map must not freeze meanwhile. Rejects with
 * PlanTimeoutError when the worker went silent.
 */
export async function computePlan(model: TreeModel, detail: CityDetail, inside: readonly boolean[], count: number): Promise<PlantingPlace[]> {
  return (await askWorker(model, detail, inside, count)) ?? plantingPlan(model, detail, inside, count);
}
