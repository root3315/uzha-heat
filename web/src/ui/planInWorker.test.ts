import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CityDetail, TreeModel } from '../data/contract';
import { plantingPlan } from '../domain/plantingPlan';
import type { PlanReply, PlanRequest } from './plan.worker';

const STUMP: TreeModel = {
  features: ['tree'],
  baseScore: 40,
  trees: [{ feature: [0, -1, -1], value: [10, 2, -1], left: [1, -1, -1], defaultLeft: [1, 0, 0] }],
};
const tree = [0, 0, 30, 0, 40, 50, 60];
const detail = {
  cells: { lon: tree.map((_, i) => i * 0.01), lat: tree.map(() => 0), lst: tree.map(() => 45), values: { tree }, shap: {}, pop: [100, 4000, 0, 900, 50, 50, 50] },
} as unknown as CityDetail;
const all = tree.map(() => true);
const expected = plantingPlan(STUMP, detail, all, 2);

interface Fake extends EventTarget {
  terminated: boolean;
  reply(data: PlanReply): void;
}

/** A stand-in for the browser's Worker that answers each request the way `answer` says. */
function fakeWorker(answer: (request: PlanRequest, worker: Fake) => void) {
  const created: Fake[] = [];
  class FakeWorker extends EventTarget implements Fake {
    terminated = false;
    constructor() {
      super();
      created.push(this);
    }
    postMessage(request: PlanRequest) {
      queueMicrotask(() => answer(request, this));
    }
    reply(data: PlanReply) {
      this.dispatchEvent(new MessageEvent('message', { data }));
    }
    terminate() {
      this.terminated = true;
    }
  }
  return { FakeWorker, created };
}

async function freshComputePlan() {
  vi.resetModules();
  return (await import('./planInWorker')).computePlan;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('computePlan', () => {
  it('computes the plan itself where there is no worker, as in an old browser', async () => {
    const computePlan = await freshComputePlan();
    expect(typeof Worker).toBe('undefined');
    const plan = await computePlan(STUMP, detail, all, 2);
    expect(plan).toEqual(expected);
    expect(plan.map((p) => p.cell)).toEqual([1, 3]);
  });

  it('takes the plan the worker sends back for its own request, sending it only the columns it needs', async () => {
    let sent: PlanRequest | undefined;
    const { FakeWorker } = fakeWorker((request, worker) => {
      sent = request;
      worker.reply({ id: request.id + 1, plan: [] }); // someone else's answer: ignored
      worker.reply({ id: request.id, plan: expected });
    });
    vi.stubGlobal('Worker', FakeWorker);
    const computePlan = await freshComputePlan();
    expect(await computePlan(STUMP, detail, all, 2)).toEqual(expected);
    expect(Object.keys(sent?.cells ?? {}).sort()).toEqual(['lat', 'lon', 'pop', 'values']);
  });

  it('computes the plan itself when the worker answers with an error', async () => {
    const { FakeWorker } = fakeWorker((request, worker) => worker.reply({ id: request.id, error: 'broken' }));
    vi.stubGlobal('Worker', FakeWorker);
    const computePlan = await freshComputePlan();
    expect(await computePlan(STUMP, detail, all, 2)).toEqual(expected);
  });

  it('stops a worker that fails and starts a fresh one for the next request', async () => {
    const { FakeWorker, created } = fakeWorker((_, worker) => worker.dispatchEvent(new Event('error')));
    vi.stubGlobal('Worker', FakeWorker);
    const computePlan = await freshComputePlan();
    expect(await computePlan(STUMP, detail, all, 2)).toEqual(expected);
    expect(created[0]?.terminated).toBe(true);
    await computePlan(STUMP, detail, all, 2);
    expect(created).toHaveLength(2);
  });

  it('gives up on a worker that never answers', async () => {
    vi.useFakeTimers();
    const { FakeWorker, created } = fakeWorker(() => undefined);
    vi.stubGlobal('Worker', FakeWorker);
    vi.resetModules();
    const { computePlan, WORKER_TIMEOUT_MS } = await import('./planInWorker');
    const pending = computePlan(STUMP, detail, all, 2);
    await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS);
    expect(await pending).toEqual(expected);
    expect(created[0]?.terminated).toBe(true);
  });
});
