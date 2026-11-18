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
} as const;

/** OpenMapTiles vector tiles from OpenFreeMap: no key, no glyphs needed (labels are drawn by the app). */
const BASEMAP_TILES = 'https://tiles.openfreemap.org/planet';

const EMPTY = { type: 'FeatureCollection' as const, features: [] };

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

/** In 3D the buildings carry the colour; the ground under them steps back so they stand out. */
const THREE_D_GROUND = 0.35;

export function bandOpacity(tokens: MapTokens, mode: 'temperature' | 'causes', threeD = false): ExpressionSpecification {
  const scale = (mode === 'causes' ? CAUSES_DIM : 1) * (threeD ? THREE_D_GROUND : 1);
  return ['match', ['get', 'k'], ...tokens.classOpacity.flatMap((o, k) => [k, o * scale]), scale] as unknown as ExpressionSpecification;
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
    sources: {
      [SOURCE.basemap]: { type: 'vector', url: BASEMAP_TILES, attribution: '© OpenStreetMap, OpenFreeMap' },
      [SOURCE.bands]: { type: 'geojson', data: model.isotherms.bands },
      [SOURCE.isolines]: { type: 'geojson', data: model.isotherms.lines },
      [SOURCE.causes]: { type: 'geojson', data: model.causeAreas },
      [SOURCE.outsideData]: { type: 'geojson', data: outsideOf(model.isotherms.coverage) },
      [SOURCE.outsideCity]: { type: 'geojson', data: outline ? outsideOf(outline) : EMPTY },
      [SOURCE.outline]: { type: 'geojson', data: outline ? { type: 'Feature', properties: {}, geometry: outline } : EMPTY },
      [SOURCE.transect]: { type: 'geojson', data: EMPTY },
      [SOURCE.probe]: { type: 'geojson', data: EMPTY },
      [SOURCE.place]: { type: 'geojson', data: EMPTY },
      [SOURCE.found]: { type: 'geojson', data: EMPTY },
      [SOURCE.people]: { type: 'geojson', data: peopleData(model) },
      [SOURCE.facilities]: { type: 'geojson', data: facilityData(model) },
      // Filled from the basemap's building layer only in 3D, each building coloured by the surface under it.
      [SOURCE.buildings]: { type: 'geojson', data: EMPTY },
    },
    layers: [
      { id: 'ground', type: 'background', paint: { 'background-color': tokens.ground } },
      {
        id: LAYER.bands,
        type: 'fill',
        source: SOURCE.bands,
        paint: { 'fill-color': classColor, 'fill-opacity': bandOpacity(tokens, 'temperature'), 'fill-antialias': false },
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
      // The city in 3D: every building in the colour of the surface under it, a heat model of the city.
      {
        id: LAYER.buildings,
        type: 'fill-extrusion',
        source: SOURCE.buildings,
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': ['match', ['get', 'k'], ...tokens.classes.flatMap((color, k) => [k, color]), tokens.building] as unknown as ExpressionSpecification,
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': 0.95,
          'fill-extrusion-vertical-gradient': true,
        },
      },
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
    ],
  };
}
