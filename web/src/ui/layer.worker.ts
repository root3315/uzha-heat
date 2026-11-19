/// <reference lib="webworker" />
import type { CellGrid } from '../domain/grid';
import { fluxContours, type ContourOverlay, type FluxLayer } from '../domain/layers';

export interface LayerRequest {
  id: number;
  grid: CellGrid;
  values: number[];
  layer: FluxLayer;
}

export type LayerReply = { id: number; overlay: ContourOverlay } | { id: number; error: string };

declare const self: DedicatedWorkerGlobalScope;

/** A flux layer's contours off the main thread: half a second for Tashkent, which would freeze the map. */
self.onmessage = ({ data }: MessageEvent<LayerRequest>) => {
  try {
    const reply: LayerReply = { id: data.id, overlay: fluxContours(data.grid, data.values, data.layer) };
    self.postMessage(reply);
  } catch (error) {
    const reply: LayerReply = { id: data.id, error: error instanceof Error ? error.message : String(error) };
    self.postMessage(reply);
  }
};
