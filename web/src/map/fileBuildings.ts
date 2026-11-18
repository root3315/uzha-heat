import type { Feature } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { LonLat } from '../domain/transect';
import { MAX_BUILDINGS, classify, collect, collection, covers, isFlatGeobuf, viewRect, type Rect } from './buildingsData';

/** Wait this long after the camera stops before reading: a fling ends in several moveends. */
const REFRESH_DELAY_MS = 200;

const probes = new Map<string, Promise<boolean>>();

/** Whether the city's .fgb is there, asked once per URL with an 8-byte range request. A missing file comes back as a
 * 404 or, from a dev server or an SPA fallback, as the app's HTML: neither starts with the FlatGeobuf magic. */
export function hasBuildingsFile(url: string): Promise<boolean> {
  let probe = probes.get(url);
  if (!probe) {
    probe = fetch(url, { headers: { Range: 'bytes=0-7' } })
      .then(async (response) => response.ok && isFlatGeobuf(new Uint8Array(await response.arrayBuffer())))
      .catch(() => false);
    probes.set(url, probe);
  }
  return probe;
}

interface Options {
  url: string;
  source: string;
  minZoom: number;
  temperatureAt(point: LonLat): number;
  classOf(t: number): number;
  /** The file failed mid-way: show the basemap's buildings instead. */
  onFail(): void;
}

/**
 * Keep the source filled with the buildings of the current view, read from the FlatGeobuf by HTTP range requests
 * through its spatial index. Returns the function that stops it.
 */
export function followView(map: MapLibreMap, options: Options): () => void {
  let loaded: Rect | null = null;
  let controller: AbortController | null = null;
  let timer = 0;

  const load = async () => {
    if (map.getZoom() < options.minZoom) return;
    const bounds = map.getBounds();
    const rect = viewRect([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], map.getCenter().toArray() as LonLat);
    if (covers(loaded, rect)) return;
    controller?.abort();
    const current = new AbortController();
    controller = current;
    try {
      // Loaded on first use: the reader is only needed in 3D.
      const { deserialize } = await import('flatgeobuf/geojson');
      const stream = deserialize(options.url, { rect }) as AsyncIterable<Feature>;
      const features = await collect(stream, (f) => classify(f, options.temperatureAt, options.classOf), MAX_BUILDINGS, current.signal);
      if (!features) return;
      // A capped read does not hold the whole rectangle, so the next move reads again.
      loaded = features.length < MAX_BUILDINGS ? rect : null;
      (map.getSource(options.source) as GeoJSONSource | undefined)?.setData(collection(features));
    } catch {
      if (!current.signal.aborted) options.onFail();
    }
  };

  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void load(), REFRESH_DELAY_MS);
  };
  map.on('moveend', schedule);
  schedule();
  return () => {
    map.off('moveend', schedule);
    window.clearTimeout(timer);
    controller?.abort();
    (map.getSource(options.source) as GeoJSONSource | undefined)?.setData(collection([]));
  };
}
