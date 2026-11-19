/// <reference lib="webworker" />
import type { TreeModel } from '../data/contract';
import { plantingPlan, type PlanCells, type PlantingPlace } from '../domain/plantingPlan';

export interface PlanRequest {
  id: number;
  model: TreeModel;
  /** Only what the plan reads from the city, so the copy into the worker stays small. */
  cells: PlanCells;
  inside: readonly boolean[];
  count: number;
}

export type PlanReply = { id: number; plan: PlantingPlace[] } | { id: number; error: string };

declare const self: DedicatedWorkerGlobalScope;

/** "Where to plant first" off the main thread: the whole city through the model takes seconds on a phone. */
self.onmessage = ({ data }: MessageEvent<PlanRequest>) => {
  try {
    const plan = plantingPlan(data.model, { cells: data.cells }, data.inside, data.count);
    self.postMessage({ id: data.id, plan } satisfies PlanReply);
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) } satisfies PlanReply);
  }
};
