import type { Feature } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { LonLat } from '../domain/transect';
import { MAX_BUILDINGS, MAX_HALF_SPAN_M, classify, collect, collection, covers, isFlatGeobuf, viewRect, type Rect } from './buildingsData';

/** Wait this long after the camera stops before reading: a fling ends in several moveends. */
const REFRESH_DELAY_MS = 200;

const probes = new Map<string, Promise<boolean>>();

/** The first bytes of a response, without downloading the rest when a server ignores the Range header. */
async function firstBytes(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer());
  const { value } = await reader.read();
  void reader.cancel();
  return value ?? new Uint8Array();
}

/**
 * Whether the city's .fgb is there, asked once per URL with an 8-byte range request. A missing file comes back as a
 * 404 or, from a dev server or an SPA fallback, as the app's HTML: neither starts with the FlatGeobuf magic.
 * A network error is not an answer: it is forgotten, so the next 3D toggle asks again.
 */
export function hasBuildingsFile(url: string): Promise<boolean> {
  let probe = probes.get(url);
  if (!probe) {
    probe = fetch(url, { headers: { Range: 'bytes=0-7' } }).then(
      async (response) => response.ok && isFlatGeobuf(await firstBytes(response)),
      () => {
        probes.delete(url);
        return false;
      },
    );
    probes.set(url, probe);
  }
  return probe;
}

/** Squares tried around the view centre, m: when the widest holds too many buildings, a smaller one holds them all. */
const HALF_SPANS_M = [MAX_HALF_SPAN_M, MAX_HALF_SPAN_M / 2, MAX_HALF_SPAN_M / 4];

interface Options {
  url: string;
  source: string;
  minZoom: number;
  temperatureAt(point: LonLat): number;
  classOf(t: number): number;
  /** The file failed mid-way: show the basemap's buildings instead. */
  onFail(): void;
  /** The first buildings from the file are on the map: time to hide the basemap's. */
  onData(): void;
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
    const box: [number, number, number, number] = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
    const center = map.getCenter().toArray() as LonLat;
    // Stop a read for a view left behind first: back over what is loaded, it would still land and replace it.
    controller?.abort();
    controller = null;
    if (covers(loaded, viewRect(box, center, HALF_SPANS_M[HALF_SPANS_M.length - 1]))) return;
    const current = new AbortController();
    controller = current;
    try {
      // Loaded on first use: the reader is only needed in 3D.
      const { deserialize } = await import('flatgeobuf/geojson');
      // The file's index order is not distance from the centre: a capped read would leave holes in the middle of the
      // view. So read the widest square that fits under the cap whole, stepping in when a dense centre overflows it.
      for (const halfSpan of HALF_SPANS_M) {
        const rect = viewRect(box, center, halfSpan);
        const stream = deserialize(options.url, { rect }) as AsyncIterable<Feature>;
        const features = await collect(stream, (f) => classify(f, options.temperatureAt, options.classOf), MAX_BUILDINGS, current.signal);
        if (!features) return;
        const whole = features.length < MAX_BUILDINGS;
        if (!whole && halfSpan !== HALF_SPANS_M[HALF_SPANS_M.length - 1]) continue;
        loaded = rect;
        (map.getSource(options.source) as GeoJSONSource | undefined)?.setData(collection(features));
        options.onData();
        return;
      }
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
