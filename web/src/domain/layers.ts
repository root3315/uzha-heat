import type { FeatureCollection, LineString, MultiPolygon, Polygon, Position } from 'geojson';
import type { CityDetail } from '../data/contract';
import type { NightGrid } from '../data/night';
import { buildField } from './field';
import type { CellGrid } from './grid';
import { CLASS_COUNT, classOf, isothermGeometry, isothermLevels, type IsolineProperties, type IsothermLevels, type LabelAnchor } from './isotherms';
import { quantile } from './stats';

/** What the map can colour: the surface temperature, where the midday sunlight goes, or the night. */
export const MAP_LAYERS = ['lst', 'h', 'le', 'g', 'night'] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];
export type FluxLayer = 'h' | 'le' | 'g';

export const isFluxLayer = (layer: MapLayer): layer is FluxLayer => layer === 'h' || layer === 'le' || layer === 'g';

/** Evaporation cools: the more of it, the cooler the colour, so its scale runs the other way round. */
export const reversedLayer = (layer: MapLayer): boolean => layer === 'le';

/** The layers this city has data for, in the order of the switch. Temperature always. */
export function availableLayers(detail: CityDetail, night: NightGrid | null): MapLayer[] {
  return MAP_LAYERS.filter((layer) => layer === 'lst' || (isFluxLayer(layer) ? detail.cells.energy !== undefined : night !== null));
}

/** The palette step (`--t0` … `--t6`) a class is drawn in. */
export const colourOf = (layer: MapLayer, k: number): number => (reversedLayer(layer) ? CLASS_COUNT - 1 - k : k);

/** Round multiples of a power of ten a step may take: 20, 25, 30, 40, 50, 60, 80 W/m² all read as round numbers. */
const NICE = [1, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** The smallest round step (`NICE` times a power of ten) that is at least `raw`; 1 for nothing to span. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const nice = NICE.find((m) => m * power >= raw * (1 - 1e-9)) ?? 10;
  return nice * power;
}

/** Share of the cells left outside the scale at each end: a few extreme cells must not flatten the rest. */
const TAIL = 0.05;

/**
 * Classes of a flux, W/m²: CLASS_COUNT − 1 thresholds on round values, centred on the middle 90% of the cells and
 * spanning it. Every second threshold is major (a heavier line, labelled first).
 */
export function fluxLevels(values: readonly number[]): IsothermLevels {
  const finite = values.filter((v) => Number.isFinite(v));
  const lo = quantile(finite, TAIL);
  const hi = quantile(finite, 1 - TAIL);
  const count = CLASS_COUNT - 1;
  const step = niceStep((hi - lo) / (count - 1));
  const middle = (lo + hi) / 2;
  const first = Number.isFinite(middle) ? Math.round((middle - ((count - 1) / 2) * step) / step) * step : 0;
  const thresholds = Array.from({ length: count }, (_, i) => first + i * step);
  const major = thresholds.filter((t) => Math.round(t / step) % 2 === 0);
  const median = quantile(finite, 0.5);
  return { thresholds, neutral: Number.isFinite(median) ? classOf({ thresholds, neutral: 0, major }, median) : 0, major };
}

/** Night classes: 1° steps around the median night, the median in the quiet middle step as on the day map. */
export const nightLevels = (night: NightGrid): IsothermLevels => isothermLevels(night.median, 1);

export interface LegendClass {
  /** Palette step, 0–6. */
  colour: number;
  /** Floor and ceiling of the class; null at the open ends. */
  from: number | null;
  to: number | null;
}

/** The legend of a layer: its classes from low to high values, each with its colour. */
export function legendClasses(layer: MapLayer, levels: IsothermLevels): LegendClass[] {
  const { thresholds } = levels;
  return Array.from({ length: thresholds.length + 1 }, (_, k) => ({
    colour: colourOf(layer, k),
    from: k === 0 ? null : (thresholds[k - 1] ?? null),
    to: k === thresholds.length ? null : (thresholds[k] ?? null),
  }));
}

/** A shape on an extra layer: its class `k` and the palette step `c` it is drawn in. */
export interface OverlayClass {
  k: number;
  c: number;
}

/** A flux as the temperature is drawn: stepped bands and their lines over a smooth surface. */
export interface ContourOverlay {
  kind: 'contours';
  layer: FluxLayer;
  levels: IsothermLevels;
  bands: FeatureCollection<MultiPolygon, OverlayClass>;
  lines: FeatureCollection<LineString, IsolineProperties>;
  anchors: LabelAnchor[];
}

/** The night as MODIS gives it: one square per 1 km pixel, never smoothed. */
export interface PixelOverlay {
  kind: 'pixels';
  layer: 'night';
  levels: IsothermLevels;
  pixels: FeatureCollection<Polygon, OverlayClass & { t: number }>;
}

export type MapOverlay = ContourOverlay | PixelOverlay;

/** A flux over the city's cells (`values` in cell order, W/m²) as smooth stepped bands; heavy, so best in a worker. */
export function fluxContours(grid: CellGrid, values: readonly number[], layer: FluxLayer): ContourOverlay {
  const levels = fluxLevels(values);
  const geometry = isothermGeometry(buildField(grid, values), levels);
  return {
    kind: 'contours',
    layer,
    levels,
    bands: {
      type: 'FeatureCollection',
      features: geometry.bands.features.map((band) => ({ ...band, properties: { k: band.properties.k, c: colourOf(layer, band.properties.k) } })),
    },
    lines: geometry.lines,
    anchors: geometry.anchors,
  };
}

/** A point of the sinusoidal grid in degrees. */
export function sinusoidalToLonLat(night: NightGrid, x: number, y: number): Position {
  const lat = y / night.radiusM;
  return [((x / (night.radiusM * Math.cos(lat))) * 180) / Math.PI, (lat * 180) / Math.PI];
}

export function lonLatToSinusoidal(night: NightGrid, lon: number, lat: number): [number, number] {
  const phi = (lat * Math.PI) / 180;
  return [night.radiusM * ((lon * Math.PI) / 180) * Math.cos(phi), night.radiusM * phi];
}

/** Every pixel with a value as its own quadrilateral, corners exact on the sinusoidal grid. */
export function nightPixels(night: NightGrid): PixelOverlay {
  const levels = nightLevels(night);
  const { x0, y0, pixelM, nx, ny, values } = night;
  const features: PixelOverlay['pixels']['features'] = [];
  for (let row = 0; row < ny; row++) {
    for (let col = 0; col < nx; col++) {
      const t = values[row * nx + col] ?? Number.NaN;
      if (Number.isNaN(t)) continue;
      const left = x0 + col * pixelM;
      const top = y0 - row * pixelM;
      const corner = (dx: number, dy: number) => sinusoidalToLonLat(night, left + dx * pixelM, top - dy * pixelM);
      const ring = [corner(0, 0), corner(0, 1), corner(1, 1), corner(1, 0), corner(0, 0)];
      const k = classOf(levels, t);
      features.push({ type: 'Feature', properties: { k, c: colourOf('night', k), t }, geometry: { type: 'Polygon', coordinates: [ring] } });
    }
  }
  return { kind: 'pixels', layer: 'night', levels, pixels: { type: 'FeatureCollection', features } };
}

/** The night temperature of the pixel under a point; NaN off the grid or where MODIS has no value. */
export function nightAt(night: NightGrid, lon: number, lat: number): number {
  const [x, y] = lonLatToSinusoidal(night, lon, lat);
  const col = Math.floor((x - night.x0) / night.pixelM);
  const row = Math.floor((night.y0 - y) / night.pixelM);
  if (col < 0 || row < 0 || col >= night.nx || row >= night.ny) return Number.NaN;
  return night.values[row * night.nx + col] ?? Number.NaN;
}

/** The value of a flux layer in one cell, W/m²; NaN without the energy step. */
export function fluxAt(detail: CityDetail, layer: FluxLayer, cell: number): number {
  return detail.cells.energy?.[layer][cell] ?? Number.NaN;
}
