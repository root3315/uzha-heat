import type { MultiPolygon, Polygon } from 'geojson';
import { boundaryGeometry } from './boundary';
import type { CityDetail, CitySummary, TreeModel } from './contract';
import { parseCities, parseCityDetail, parseTreeModel } from './parse';
import { parseValidation, type Validation } from './validation';

const BASE = import.meta.env.BASE_URL;
const DATA_ROOT = `${BASE}data`;
const BOUNDARY_ROOT = `${BASE}boundaries`;

export class MissingDataError extends Error {
  constructor(path: string) {
    super(`Нет файла ${path}`);
    this.name = 'MissingDataError';
  }
}

/** Bytes received so far and, when known, how many there will be in all. */
export interface Download {
  received: number;
  total: number | null;
}

const dataUrl = (file: string): string => `${DATA_ROOT}/${file}`;

async function fetchOk(path: string): Promise<Response> {
  const response = await fetch(dataUrl(path));
  // A dev server answers a missing file with the app's own HTML, so check the type as well as the status.
  const isHtml = response.headers.get('content-type')?.includes('text/html') ?? false;
  if (!response.ok || isHtml) throw new MissingDataError(path);
  return response;
}

/**
 * The size of the body as it will arrive after decoding. Content-Length counts compressed bytes,
 * so it is only trusted for an uncompressed response; otherwise the size measured at build time.
 */
function expectedBytes(response: Response, known: number | undefined): number | null {
  const length = Number(response.headers.get('content-length'));
  if (!response.headers.get('content-encoding') && length > 0) return length;
  return known ?? null;
}

/** The whole body as bytes, reporting progress as it streams in. */
export async function readWithProgress(response: Response, total: number | null, onProgress: (download: Download) => void): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  onProgress({ received, total });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress({ received, total: total === null ? null : Math.max(total, received) });
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchJson(path: string): Promise<unknown> {
  return (await fetchOk(path)).json();
}

let validation: Promise<Validation | null> | null = null;

/**
 * The MODIS check, if the pipeline wrote one; null when it is missing or unreadable, the page goes on without it.
 * One file for every city, fetched once per session.
 */
export function loadValidation(): Promise<Validation | null> {
  validation ??= fetchJson('validation.json').then(parseValidation, () => null);
  return validation;
}

const treeModels = new Map<string, Promise<TreeModel>>();

/** The city's XGBoost model for "что если", `model-<id>.json`: fetched once, only when the reader opens the block. */
export function loadTreeModel(id: string): Promise<TreeModel> {
  let model = treeModels.get(id);
  if (!model) {
    model = fetchJson(`model-${encodeURIComponent(id)}.json`).then(parseTreeModel);
    // A failed download may be retried on the next open.
    model.catch(() => treeModels.delete(id));
    treeModels.set(id, model);
  }
  return model;
}

export async function loadCities(): Promise<CitySummary[]> {
  return parseCities(await fetchJson('cities.json'));
}

/** The raw city file, with download progress. Parsed separately, so a worker can parse its own copy. */
export async function loadCityBytes(id: string, onProgress: (download: Download) => void = () => undefined): Promise<Uint8Array> {
  const response = await fetchOk(`${encodeURIComponent(id)}.json`);
  return readWithProgress(response, expectedBytes(response, __DATA_BYTES__[id]), onProgress);
}

export function parseCityBytes(bytes: Uint8Array): CityDetail {
  return parseCityDetail(JSON.parse(new TextDecoder().decode(bytes)));
}

/**
 * The city outline shipped with the app, `public/boundaries/<id>.geojson`.
 * Missing or unreadable: null, and the map is simply not clipped.
 */
export async function loadBoundary(id: string): Promise<Polygon | MultiPolygon | null> {
  try {
    const response = await fetch(`${BOUNDARY_ROOT}/${encodeURIComponent(id)}.geojson`);
    if (!response.ok) return null;
    return boundaryGeometry(await response.json());
  } catch {
    return null;
  }
}
