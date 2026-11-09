import { Map as MapLibreMap } from 'maplibre-gl';
import type { CityModel } from '../domain/cityModel';
import type { FoundName } from '../domain/placeName';
import { districtAt } from '../domain/places';
import type { Site } from '../domain/sites';
import { geometryBounds } from '../domain/stats';
import type { LonLat, Transect } from '../domain/transect';
import { placeLabels } from './isothermLabels';
import { nameFromBasemap, siteFromBasemap } from './placeNames';
import { LAYER, buildStyle } from './style';
import type { MapTokens } from './tokens';

export interface ReportMap {
  /** PNG data URL, or null when the map could not be drawn. */
  image: string | null;
  /** Names for the asked points, read from the same basemap. */
  names: (FoundName | null)[];
  sites: (Site | null)[];
}

/** The report map's width, CSS px; its height follows the city's shape. */
const WIDTH = 720;
const PADDING = 22;
const MIN_ASPECT = 0.62;
const MAX_ASPECT = 1.15;
/** A basemap tile that never comes should not hold the report forever. */
const IDLE_TIMEOUT_MS = 9000;

const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/** The city and both ends of the section, so neither handle is cut off at the edge. */
function frameOf(model: CityModel, transect: Transect): [number, number, number, number] {
  const [w, s, e, n] = geometryBounds(model.outline ?? model.isotherms.coverage);
  const lons = [w, e, ...transect.map((p) => p[0])];
  const lats = [s, n, ...transect.map((p) => p[1])];
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

function heightFor([w, s, e, n]: [number, number, number, number]): number {
  const aspect = (mercatorY(n) - mercatorY(s)) / (((e - w) * Math.PI) / 180 || 1);
  const inner = WIDTH - PADDING * 2;
  return Math.round(inner * Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, aspect)) + PADDING * 2);
}

function whenIdle(map: MapLibreMap): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, IDLE_TIMEOUT_MS);
    map.once('idle', () => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}

/** Isotherm labels in the page's mono and the section А–Б, drawn over the map image. */
function drawOverlay(ctx: CanvasRenderingContext2D, map: MapLibreMap, model: CityModel, transect: Transect, tokens: MapTokens): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  const anchors = model.isotherms.anchors.filter((a) => model.source.cellAt(a.at as LonLat) >= 0 && model.source.inside(a.at as LonLat));
  const sorted = [...anchors].sort((a, b) => Number(b.major) - Number(a.major));
  for (const label of placeLabels(map, sorted)) {
    ctx.save();
    ctx.translate(label.x, label.y);
    ctx.rotate((label.angle * Math.PI) / 180);
    ctx.font = `${label.major ? 600 : 400} 10px 'Martian Mono Variable'`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = tokens.ground;
    ctx.strokeText(label.text, 0, 0);
    ctx.fillStyle = tokens.ink;
    ctx.fillText(label.text, 0, 0);
    ctx.restore();
  }

  const ends = transect.map((end) => map.project(end));
  const [a, b] = ends;
  if (a && b) {
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = tokens.ground;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = tokens.ink;
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }
  ends.forEach((end, i) => {
    ctx.beginPath();
    ctx.arc(end.x, end.y, 11, 0, Math.PI * 2);
    ctx.fillStyle = tokens.ink;
    ctx.fill();
    ctx.fillStyle = tokens.ground;
    ctx.font = "600 11px 'Martian Mono Variable'";
    ctx.fillText(i === 0 ? 'А' : 'Б', end.x, end.y + 0.5);
  });
}

const nothing = (points: readonly LonLat[]): ReportMap => ({ image: null, names: points.map(() => null), sites: points.map(() => null) });

/**
 * The map for the report, drawn on its own off-screen map so the screen keeps its zoom and mode:
 * temperature only (no cause hatching), framed tightly on the city, with the section А–Б on it.
 * The same basemap names the given points, so the report's places read like the map's.
 */
export async function renderReportMap(model: CityModel, transect: Transect, tokens: MapTokens, points: readonly LonLat[] = []): Promise<ReportMap> {
  const frame = frameOf(model, transect);
  const height = heightFor(frame);
  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  Object.assign(container.style, { position: 'fixed', left: '-10000px', top: '0', width: `${WIDTH}px`, height: `${height}px`, pointerEvents: 'none' });
  document.body.appendChild(container);

  let map: MapLibreMap | null = null;
  try {
    const created = new MapLibreMap({
      container,
      style: buildStyle(model, tokens),
      bounds: frame,
      fitBoundsOptions: { padding: PADDING },
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      pixelRatio: 2,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    map = created;
    await new Promise<void>((resolve) => created.once('load', () => resolve()));
    created.setLayoutProperty(LAYER.isolines, 'visibility', 'visible');
    await whenIdle(created);

    const source = created.getCanvas();
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return nothing(points);
    ctx.drawImage(source, 0, 0);
    ctx.scale(canvas.width / WIDTH, canvas.height / height);
    drawOverlay(ctx, created, model, transect, tokens);

    return {
      image: canvas.toDataURL('image/png'),
      names: points.map((point) => nameFromBasemap(created, point, districtAt(model.detail, point))),
      sites: points.map((point) => siteFromBasemap(created, point)),
    };
  } catch {
    return nothing(points);
  } finally {
    map?.remove();
    container.remove();
  }
}
