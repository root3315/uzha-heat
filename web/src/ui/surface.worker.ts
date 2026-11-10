/// <reference lib="webworker" />
import { parseCityBytes } from '../data/load';
import { citySurface, type CitySurface, type Outline } from '../domain/cityModel';

export interface SurfaceRequest {
  id: number;
  bytes: ArrayBuffer;
  outline: Outline | null;
}

export type SurfaceReply = { id: number; surface: CitySurface } | { id: number; error: string };

declare const self: DedicatedWorkerGlobalScope;

/** The city's surface off the main thread: parse the file, contour it, post the plain result back. */
self.onmessage = ({ data }: MessageEvent<SurfaceRequest>) => {
  try {
    const surface = citySurface(parseCityBytes(new Uint8Array(data.bytes)), data.outline);
    const { field } = surface;
    const reply: SurfaceReply = { id: data.id, surface };
    self.postMessage(reply, [field.values.buffer, field.coverage.buffer, field.grid.index.buffer]);
  } catch (error) {
    const reply: SurfaceReply = { id: data.id, error: error instanceof Error ? error.message : String(error) };
    self.postMessage(reply);
  }
};
