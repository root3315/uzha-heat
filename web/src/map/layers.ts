import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import type { FeatureCollection, Geometry } from 'geojson';
import type { CellProperties } from './geojson';

export const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

export const SOURCE = { cells: 'cells', districts: 'districts' } as const;

export const LAYER = {
  cellsFill: 'cells-fill',
  cellsHover: 'cells-hover',
  cellsSelectedHalo: 'cells-selected-halo',
  cellsSelected: 'cells-selected',
  districtsFill: 'districts-fill',
  districtsLine: 'districts-line',
  districtsSelected: 'districts-selected',
  districtsLabel: 'districts-label',
} as const;

const INK = '#17191b';
/** Basemap labels kept over the data: places and water. Road names and shields are noise here. */
const KEPT_LABEL_PREFIXES = ['label_city', 'label_town', 'label_village', 'water_name', 'waterway_line_label'];
const PAPER = '#f1efe9';
/** Opaque, because neighbouring cells overlap slightly (see CELL_OVERLAP). */
const DATA_OPACITY = 1;

/** Used when the basemap cannot be loaded: a plain paper background, no tiles and no glyphs. */
export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': PAPER } }],
};

/** Pulls the basemap towards the paper tone and quietens it so the data reads first. */
export function tuneBasemap(map: MapLibreMap): void {
  for (const layer of map.getStyle().layers) {
    if (layer.type === 'background') map.setPaintProperty(layer.id, 'background-color', PAPER);
    if (layer.type === 'symbol' && !KEPT_LABEL_PREFIXES.some((prefix) => layer.id.startsWith(prefix))) {
      map.setLayoutProperty(layer.id, 'visibility', 'none');
    } else if (layer.type === 'symbol') {
      map.setPaintProperty(layer.id, 'text-color', '#4a4d50');
      map.setPaintProperty(layer.id, 'text-halo-color', PAPER);
    }
  }
}

function firstSymbolLayerId(map: MapLibreMap): string | undefined {
  return map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id;
}

export function addDataLayers(
  map: MapLibreMap,
  cells: FeatureCollection<Geometry, CellProperties>,
  districts: FeatureCollection<Geometry, CellProperties>,
): void {
  const beforeLabels = firstSymbolLayerId(map);
  map.addSource(SOURCE.cells, { type: 'geojson', data: cells });

  map.addLayer(
    {
      id: LAYER.cellsFill,
      type: 'fill',
      source: SOURCE.cells,
      paint: { 'fill-color': PAPER, 'fill-opacity': DATA_OPACITY, 'fill-antialias': false },
    },
    beforeLabels,
  );
  map.addLayer(
    {
      id: LAYER.cellsHover,
      type: 'line',
      source: SOURCE.cells,
      paint: {
        'line-color': INK,
        'line-width': 1.2,
        'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.9, 0],
      },
    },
    beforeLabels,
  );
  map.addLayer(
    {
      id: LAYER.cellsSelectedHalo,
      type: 'line',
      source: SOURCE.cells,
      filter: ['==', ['id'], -1],
      paint: { 'line-color': PAPER, 'line-width': 5 },
    },
    beforeLabels,
  );
  map.addLayer(
    {
      id: LAYER.cellsSelected,
      type: 'line',
      source: SOURCE.cells,
      filter: ['==', ['id'], -1],
      paint: { 'line-color': INK, 'line-width': 2.4 },
    },
    beforeLabels,
  );

  if (districts.features.length === 0) return;
  map.addSource(SOURCE.districts, { type: 'geojson', data: districts });
  map.addLayer(
    {
      id: LAYER.districtsFill,
      type: 'fill',
      source: SOURCE.districts,
      layout: { visibility: 'none' },
      paint: {
        'fill-color': PAPER,
        'fill-opacity': DATA_OPACITY,
      },
    },
    LAYER.cellsHover,
  );
  map.addLayer(
    {
      id: LAYER.districtsLine,
      type: 'line',
      source: SOURCE.districts,
      paint: { 'line-color': INK, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 14, 1.4], 'line-opacity': 0.32 },
    },
    beforeLabels,
  );
  map.addLayer(
    {
      id: LAYER.districtsSelected,
      type: 'line',
      source: SOURCE.districts,
      filter: ['==', ['id'], -1],
      paint: { 'line-color': INK, 'line-width': 2.6 },
    },
    beforeLabels,
  );
  if (!map.getStyle().glyphs) return;
  map.addLayer({
    id: LAYER.districtsLabel,
    type: 'symbol',
    source: SOURCE.districts,
    layout: {
      visibility: 'none',
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 11,
      'text-max-width': 8,
    },
    paint: { 'text-color': INK, 'text-halo-color': PAPER, 'text-halo-width': 1.4 },
  });
}
