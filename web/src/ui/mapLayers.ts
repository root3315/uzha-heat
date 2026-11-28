import { useEffect, useState } from 'react';
import type { GroundImage, LandCover } from '../data/landcover';
import { loadLandCover, loadNight, loadPhoto } from '../data/load';
import type { NightGrid } from '../data/night';
import type { CityModel } from '../domain/cityModel';
import { fluxContours, isFluxLayer, nightPixels, type FluxLayer, type MapLayer, type MapOverlay } from '../domain/layers';
import type { LayerReply, LayerRequest } from './layer.worker';

/** Past this the worker is taken as lost and the page draws the layer itself. */
const LAYER_TIMEOUT_MS = 20_000;

let worker: Worker | null | undefined;
let nextRequest = 0;

function layerWorker(): Worker | null {
  if (worker === undefined) {
    try {
      worker = typeof Worker === 'undefined' ? null : new Worker(new URL('./layer.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      worker = null;
    }
  }
  return worker;
}

/** The contours from the worker; null when there is none to ask or it failed, and the page computes them itself. */
function contoursInWorker(model: CityModel, values: number[], layer: FluxLayer): Promise<MapOverlay | null> {
  const target = layerWorker();
  if (!target) return Promise.resolve(null);
  const id = ++nextRequest;
  return new Promise((resolve) => {
    const done = (overlay: MapOverlay | null) => {
      clearTimeout(timer);
      target.removeEventListener('message', onMessage);
      target.removeEventListener('error', onError);
      target.removeEventListener('messageerror', onError);
      resolve(overlay);
    };
    const onMessage = ({ data }: MessageEvent<LayerReply>) => {
      if (data.id === id) done('overlay' in data ? data.overlay : null);
    };
    const onError = () => {
      target.terminate();
      worker = null;
      done(null);
    };
    const timer = setTimeout(() => {
      target.terminate();
      if (worker === target) worker = undefined;
      done(null);
    }, LAYER_TIMEOUT_MS);
    target.addEventListener('message', onMessage);
    target.addEventListener('error', onError);
    target.addEventListener('messageerror', onError);
    const request: LayerRequest = { id, grid: model.grid, values, layer };
    target.postMessage(request);
  });
}

/** One drawing per city and layer for the whole page: switching back to a layer is instant. */
const overlays = new WeakMap<CityModel, Map<MapLayer, Promise<MapOverlay | null>>>();

function overlayOf(model: CityModel, layer: MapLayer, night: NightGrid | null): Promise<MapOverlay | null> {
  if (layer === 'lst' || (layer === 'night' && !night)) return Promise.resolve(null);
  const byLayer = overlays.get(model) ?? new Map<MapLayer, Promise<MapOverlay | null>>();
  overlays.set(model, byLayer);
  let pending = byLayer.get(layer);
  if (!pending) {
    if (night && layer === 'night') pending = Promise.resolve(nightPixels(night));
    else if (isFluxLayer(layer)) {
      const values = model.detail.cells.energy?.[layer];
      pending = values
        ? contoursInWorker(model, values, layer).then((overlay) => overlay ?? fluxContours(model.grid, values, layer))
        : Promise.resolve(null);
    } else pending = Promise.resolve(null);
    // A layer that fails to draw shows the temperature instead, and is tried again next time rather than kept failed.
    pending = pending.catch(() => {
      byLayer.delete(layer);
      return null;
    });
    byLayer.set(layer, pending);
  }
  return pending;
}

/** The city's night grid, null while it loads or when the city has none. */
export function useNight(cityId: string): NightGrid | null {
  const [night, setNight] = useState<{ id: string; grid: NightGrid | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadNight(cityId).then((grid) => !cancelled && setNight({ id: cityId, grid }));
    return () => {
      cancelled = true;
    };
  }, [cityId]);
  return night?.id === cityId ? night.grid : null;
}

/** A city's file once it is in; null before, and for a city without one. */
function useCityFile<T>(cityId: string, load: (id: string) => Promise<T | null>): T | null {
  const [file, setFile] = useState<{ id: string; value: T | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void load(cityId).then((value) => !cancelled && setFile({ id: cityId, value }));
    return () => {
      cancelled = true;
    };
  }, [cityId, load]);
  return file?.id === cityId ? file.value : null;
}

export const useLandCover = (cityId: string): LandCover | null => useCityFile(cityId, loadLandCover);
export const usePhoto = (cityId: string): GroundImage | null => useCityFile(cityId, loadPhoto);

/** What the map draws for the chosen layer: null for the surface temperature, and while another layer is being drawn. */
export function useOverlay(model: CityModel, layer: MapLayer, night: NightGrid | null): MapOverlay | null {
  const [state, setState] = useState<{ model: CityModel; layer: MapLayer; overlay: MapOverlay | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void overlayOf(model, layer, night).then((overlay) => !cancelled && setState({ model, layer, overlay }));
    return () => {
      cancelled = true;
    };
  }, [model, layer, night]);
  return state?.model === model && state.layer === layer ? state.overlay : null;
}
