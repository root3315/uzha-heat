import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';
import type { CityModel } from '../domain/cityModel';
import { outsideOf } from '../domain/isotherms';
import { hotFacilities } from '../domain/people';
import { facilityImageId } from './facilityImages';
import { withAlpha, type MapTokens } from './tokens';

export const SOURCE = {
  basemap: 'omt',
  bands: 'bands',
  isolines: 'isolines',
  causes: 'causes',
  outsideData: 'outside-data',
  outsideCity: 'outside-city',
  outline: 'outline',
  transect: 'transect',
  probe: 'probe',
  place: 'place',
  found: 'found',
  people: 'people',
  facilities: 'facilities',
  buildings: 'buildings',
  overlayBands: 'overlay-bands',
  overlayLines: 'overlay-lines',
  night: 'night',
} as const;

export const LAYER = {
  causes: 'causes',
  bands: 'bands',
  isolines: 'isolines',
  transect: 'transect',
  transectCasing: 'transect-casing',
  people: 'people',
  facilities: 'facilities',
  buildings: 'buildings-3d',
  buildingsFile: 'buildings-3d-file',
  overlayBands: 'overlay-bands',
  overlayLines: 'overlay-lines',
  night: 'night',
} as const;

/** OpenMapTiles vector tiles from OpenFreeMap: no key, no glyphs needed (labels are drawn by the app). */
const BASEMAP_TILES = 'https://tiles.openfreemap.org/planet';

const EMPTY = { type: 'FeatureCollection' as const, features: [] };

/** Height when the basemap gives none, and the least we draw: one storey. */
const DEFAULT_BUILDING_M = 6;
const MIN_BUILDING_M = 3;
/** Buildings come in the basemap tiles from this zoom; below it the city is too small to read in 3D anyway. */
export const BUILDINGS_MIN_ZOOM = 13;

/** With causes hatched over it, the temperature recedes to half strength. */
const CAUSES_DIM = 0.5;

/** Cells with fewer people than this get no dot: a farm house is not a neighbourhood. */
const MIN_PEOPLE = 5;

/** One dot per cell, its area growing with the people living there; `r` is 0–1 of the most crowded cell. */
function peopleData(model: CityModel) {
  const { pop, lon, lat } = model.detail.cells;
  if (!pop) return EMPTY;
  const most = pop.reduce((m, p) => Math.max(m, p), 1);
  return {
    type: 'FeatureCollection' as const,
    features: pop.flatMap((p, i) =>
      p >= MIN_PEOPLE
        ? [{ type: 'Feature' as const, properties: { r: Math.sqrt(p / most) }, geometry: { type: 'Point' as const, coordinates: [lon[i] ?? 0, lat[i] ?? 0] } }]
        : [],
    ),
  };
}

/** Schools, kindergartens and clinics on the hottest tenth. */
function facilityData(model: CityModel) {
  return {
    type: 'FeatureCollection' as const,
    features: hotFacilities(model.detail, model.source.cellAt).map((f) => ({
      type: 'Feature' as const,
      properties: { image: facilityImageId(f.type) },
      geometry: { type: 'Point' as const, coordinates: [f.lon, f.lat] },
    })),
  };
}

/** In 3D the buildings carry the colour; the ground keeps only a trace of it, so no hot area lies over them as a slab. */
const THREE_D_GROUND = 0.14;

/** Colour and strength of a shape on an extra layer by its palette step `c` (the layer has already turned its scale round). */
function stepColor(tokens: MapTokens): ExpressionSpecification {
  return ['match', ['get', 'c'], ...tokens.classes.flatMap((color, c) => [c, color]), tokens.ground] as unknown as ExpressionSpecification;
}

function stepOpacity(tokens: MapTokens): ExpressionSpecification {
  return ['match', ['get', 'c'], ...tokens.classOpacity.flatMap((o, c) => [c, o]), 1] as unknown as ExpressionSpecification;
}

function classOpacity(tokens: MapTokens, scale: number): ExpressionSpecification {
  return ['match', ['get', 'k'], ...tokens.classOpacity.flatMap((o, k) => [k, o * scale]), scale] as unknown as ExpressionSpecification;
}

/** Ground colour strength. In 3D it fades only where buildings are drawn, so zooming out never leaves a washed-out map. */
export function bandOpacity(tokens: MapTokens, mode: 'temperature' | 'causes', threeD = false): ExpressionSpecification {
  const scale = mode === 'causes' ? CAUSES_DIM : 1;
  if (!threeD) return classOpacity(tokens, scale);
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    BUILDINGS_MIN_ZOOM - 0.3,
    classOpacity(tokens, scale),
    BUILDINGS_MIN_ZOOM + 0.2,
    classOpacity(tokens, scale * THREE_D_GROUND),
  ] as unknown as ExpressionSpecification;
}

/** A building in the colour of its temperature class `k`; plain where the satellite has no reading (k = −1). */
function buildingColor(tokens: MapTokens, k: ExpressionSpecification): ExpressionSpecification {
  return ['match', k, ...tokens.classes.flatMap((color, i) => [i, color]), tokens.building] as unknown as ExpressionSpecification;
}

function roadLayer(id: string, classes: string[], width: number, color: string): LayerSpecification {
  return {
    id,
    type: 'line',
    source: SOURCE.basemap,
    'source-layer': 'transportation',
    filter: ['match', ['get', 'class'], classes, true, false],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, width, 15, width * 3] },
  };
}

export function buildStyle(model: CityModel, tokens: MapTokens): StyleSpecification {
  const classColor: ExpressionSpecification = ['match', ['get', 'k'], ...tokens.classes.flatMap((color, k) => [k, color]), tokens.ground] as unknown as ExpressionSpecification;
  const majorOr = (major: number, minor: number): ExpressionSpecification => ['case', ['get', 'major'], major, minor];
  const outline = model.outline;

  return {
    version: 8,
    // Soft light from the south-west, high: walls facing it are lighter, the others darker, so 3D blocks read as volumes.
    light: { anchor: 'map', position: [1.4, 210, 35], intensity: 0.45, color: '#ffffff' },
    sources: {
      [SOURCE.basemap]: { type: 'vector', url: BASEMAP_TILES, attribution: '© OpenStreetMap, OpenFreeMap' },
      [SOURCE.bands]: { type: 'geojson', data: model.isotherms.bands },
      [SOURCE.isolines]: { type: 'geojson', data: model.isotherms.lines },
      [SOURCE.causes]: { type: 'geojson', data: model.causeAreas },
      [SOURCE.outsideData]: { type: 'geojson', data: outsideOf(model.isotherms.coverage) },
      [SOURCE.outsideCity]: { type: 'geojson', data: outline ? outsideOf(outline) : EMPTY },
      [SOURCE.outline]: { type: 'geojson', data: outline ? { type: 'Feature', properties: {}, geometry: outline } : EMPTY },
      [SOURCE.transect]: { type: 'geojson', data: EMPTY },
      [SOURCE.buildings]: { type: 'geojson', data: EMPTY },
      [SOURCE.probe]: { type: 'geojson', data: EMPTY },
      [SOURCE.place]: { type: 'geojson', data: EMPTY },
      [SOURCE.found]: { type: 'geojson', data: EMPTY },
      [SOURCE.people]: { type: 'geojson', data: peopleData(model) },
      [SOURCE.facilities]: { type: 'geojson', data: facilityData(model) },
      [SOURCE.overlayBands]: { type: 'geojson', data: EMPTY },
      [SOURCE.overlayLines]: { type: 'geojson', data: EMPTY },
      [SOURCE.night]: { type: 'geojson', data: EMPTY },
    },
    layers: [
      { id: 'ground', type: 'background', paint: { 'background-color': tokens.ground } },
      {
        id: LAYER.bands,
        type: 'fill',
        source: SOURCE.bands,
        paint: { 'fill-color': classColor, 'fill-opacity': bandOpacity(tokens, 'temperature'), 'fill-antialias': false },
      },
      // A flux of the energy balance, drawn as the temperature is: stepped bands over a smooth surface. Off until chosen.
      {
        id: LAYER.overlayBands,
        type: 'fill',
        source: SOURCE.overlayBands,
        layout: { visibility: 'none' },
        paint: { 'fill-color': stepColor(tokens), 'fill-opacity': stepOpacity(tokens), 'fill-antialias': false },
      },
      {
        id: LAYER.causes,
        type: 'fill',
        source: SOURCE.causes,
        layout: { visibility: 'none' },
        paint: { 'fill-pattern': ['concat', 'hatch-', ['get', 'key'], '-heats'] },
      },
      {
        id: LAYER.isolines,
        type: 'line',
        layout: { 'line-join': 'round', visibility: 'none' },
        source: SOURCE.isolines,
        paint: { 'line-color': tokens.ink, 'line-opacity': majorOr(0.42, 0.28), 'line-width': majorOr(1, 0.6) },
      },
      {
        id: LAYER.overlayLines,
        type: 'line',
        layout: { 'line-join': 'round', visibility: 'none' },
        source: SOURCE.overlayLines,
        paint: { 'line-color': tokens.ink, 'line-opacity': majorOr(0.42, 0.28), 'line-width': majorOr(1, 0.6) },
      },
      // People as quiet ink dots, never as colour: colour stays temperature.
      {
        id: LAYER.people,
        type: 'circle',
        source: SOURCE.people,
        layout: { visibility: 'none' },
        paint: {
          'circle-color': tokens.ink,
          'circle-opacity': 0.34,
          'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 10, ['+', 0.5, ['*', ['get', 'r'], 1]], 15, ['+', 1, ['*', ['get', 'r'], 24]]],
        },
      },
      // Inside the city but without a satellite reading: a flat shade, so a gap never reads as a temperature.
      { id: 'outside-data', type: 'fill', source: SOURCE.outsideData, paint: { 'fill-color': tokens.shade } },
      { id: 'outside-city', type: 'fill', source: SOURCE.outsideCity, paint: { 'fill-color': tokens.ground } },
      // The night from MODIS: one square per 1 km pixel, over the countryside too, since the night island is the city
      // against it. Above the masks, under the water and the roads; a faint hairline between pixels shows the grid.
      {
        id: LAYER.night,
        type: 'fill',
        source: SOURCE.night,
        layout: { visibility: 'none' },
        paint: { 'fill-color': stepColor(tokens), 'fill-opacity': stepOpacity(tokens), 'fill-outline-color': withAlpha(tokens.ink, 0.12) },
      },
      { id: 'water', type: 'fill', source: SOURCE.basemap, 'source-layer': 'water', paint: { 'fill-color': tokens.water } },
      {
        id: 'waterway',
        type: 'line',
        source: SOURCE.basemap,
        'source-layer': 'waterway',
        paint: { 'line-color': withAlpha(tokens.ink, 0.22), 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 15, 1.6] },
      },
      roadLayer('roads-minor', ['minor', 'service'], 0.3, withAlpha(tokens.ink, 0.08)),
      roadLayer('roads-major', ['primary', 'secondary', 'tertiary', 'trunk'], 0.6, withAlpha(tokens.ink, 0.16)),
      roadLayer('roads-motorway', ['motorway'], 0.9, withAlpha(tokens.ink, 0.22)),
      {
        id: 'rail',
        type: 'line',
        source: SOURCE.basemap,
        'source-layer': 'transportation',
        filter: ['match', ['get', 'class'], ['rail', 'transit'], true, false],
        paint: { 'line-color': withAlpha(tokens.ink, 0.2), 'line-width': 0.6, 'line-dasharray': [3, 2] },
      },
      { id: 'outline', type: 'line', source: SOURCE.outline, paint: { 'line-color': tokens.ink, 'line-width': 1, 'line-opacity': 0.65 } },
      {
        id: LAYER.facilities,
        type: 'symbol',
        source: SOURCE.facilities,
        layout: { visibility: 'none', 'icon-image': ['get', 'image'], 'icon-allow-overlap': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 14, 1] },
      },
      {
        id: LAYER.transectCasing,
        type: 'line',
        source: SOURCE.transect,
        layout: { 'line-cap': 'round', visibility: 'none' },
        paint: { 'line-color': tokens.ground, 'line-width': 5 },
      },
      { id: LAYER.transect, type: 'line', source: SOURCE.transect, layout: { 'line-cap': 'round', visibility: 'none' }, paint: { 'line-color': tokens.ink, 'line-width': 1.8 } },
      {
        id: 'probe',
        type: 'circle',
        source: SOURCE.probe,
        paint: { 'circle-radius': 4.5, 'circle-color': tokens.ground, 'circle-stroke-color': tokens.ink, 'circle-stroke-width': 1.5 },
      },
      {
        id: 'place-ring',
        type: 'circle',
        source: SOURCE.place,
        paint: { 'circle-radius': 11, 'circle-opacity': 0, 'circle-stroke-color': tokens.ink, 'circle-stroke-width': 1.5 },
      },
      { id: 'place-dot', type: 'circle', source: SOURCE.place, paint: { 'circle-radius': 2.4, 'circle-color': tokens.ink } },
      {
        id: 'found',
        type: 'circle',
        source: SOURCE.found,
        paint: { 'circle-radius': 5, 'circle-color': tokens.noon, 'circle-stroke-color': tokens.ink, 'circle-stroke-width': 1.5 },
      },
      // The city in 3D: the basemap's own buildings, each in the colour of the surface under it (feature state `k`, set by
      // the map as buildings come into view). Last, so their walls hide what lies behind them.
      {
        id: LAYER.buildings,
        type: 'fill-extrusion',
        source: SOURCE.basemap,
        'source-layer': 'building',
        minzoom: BUILDINGS_MIN_ZOOM,
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': buildingColor(tokens, ['coalesce', ['feature-state', 'k'], -1]),
          'fill-extrusion-height': ['max', ['coalesce', ['get', 'render_height'], DEFAULT_BUILDING_M], MIN_BUILDING_M],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.95,
          'fill-extrusion-vertical-gradient': true,
        },
      },
      // The same city from our own footprints (OSM plus Microsoft's, heights tagged or modelled), read for the view from
      // buildings/<city>.fgb; it replaces the basemap's buildings when the file is there. Class `k` is set as it loads.
      {
        id: LAYER.buildingsFile,
        type: 'fill-extrusion',
        source: SOURCE.buildings,
        minzoom: BUILDINGS_MIN_ZOOM,
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': buildingColor(tokens, ['get', 'k']),
          'fill-extrusion-height': ['max', ['coalesce', ['get', 'h'], DEFAULT_BUILDING_M], MIN_BUILDING_M],
          'fill-extrusion-opacity': 0.95,
          'fill-extrusion-vertical-gradient': true,
        },
      },
    ],
  };
}
