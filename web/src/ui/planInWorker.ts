import type { CityDetail, TreeModel } from '../data/contract';
import { plantingPlan, type PlantingPlace } from '../domain/plantingPlan';
import type { PlanReply, PlanRequest } from './plan.worker';

let worker: Worker | null | undefined;
let nextRequest = 0;

function planWorker(): Worker | null {
  if (worker === undefined) {
    try {
      worker = typeof Worker === 'undefined' ? null : new Worker(new URL('./plan.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      worker = null;
    }
  }
  return worker;
}

/** The plan from the worker; null when there is no worker to ask or it failed, so the caller computes it itself. */
function askWorker(model: TreeModel, detail: CityDetail, inside: readonly boolean[], count: number): Promise<PlantingPlace[] | null> {
  const target = planWorker();
  if (!target) return Promise.resolve(null);
  const id = ++nextRequest;
  return new Promise((resolve) => {
    const done = (plan: PlantingPlace[] | null) => {
      target.removeEventListener('message', onMessage);
      target.removeEventListener('error', onError);
      resolve(plan);
    };
    const onMessage = ({ data }: MessageEvent<PlanReply>) => {
      if (data.id === id) done('plan' in data ? data.plan : null);
    };
    // A worker that cannot start (old browser, strict CSP) is not an error: the page computes the plan itself.
    const onError = () => {
      worker = null;
      done(null);
    };
    target.addEventListener('message', onMessage);
    target.addEventListener('error', onError);
    const { pop, lon, lat, values } = detail.cells;
    // The model without its check rows, and only the columns the plan reads: less to copy.
    const request: PlanRequest = {
      id,
      model: { features: model.features, baseScore: model.baseScore, trees: model.trees },
      cells: { pop, lon, lat, values },
      inside,
      count,
    };
    target.postMessage(request);
  });
}

/**
 * "Where to plant first" for a city, computed off the main thread where the browser allows it: the whole city through
 * the model takes a second on a laptop and several on a phone, and the map must not freeze meanwhile.
 */
export async function computePlan(model: TreeModel, detail: CityDetail, inside: readonly boolean[], count: number): Promise<PlantingPlace[]> {
  return (await askWorker(model, detail, inside, count)) ?? plantingPlan(model, detail, inside, count);
}
