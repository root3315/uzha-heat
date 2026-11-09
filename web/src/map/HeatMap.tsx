import { Map as MapLibreMap, NavigationControl, type LngLatBoundsLike, type MapGeoJSONFeature, type MapMouseEvent, type Point } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './worker';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { CityDetail } from '../data/contract';
import { formatTemp } from '../domain/format';
import type { Selection } from '../domain/places';
import { geometryBounds } from '../domain/stats';
import { cellsToGeoJson, districtsToGeoJson } from './geojson';
import { fillColorExpression, type Granularity, type MapMode, type MapScales } from './mapMode';
import { BASEMAP_STYLE, FALLBACK_STYLE, LAYER, SOURCE, addDataLayers, tuneBasemap } from './layers';

export interface HeatMapHandle {
  snapshot(): Promise<string | null>;
}

interface HeatMapProps {
  detail: CityDetail;
  scales: MapScales;
  mode: MapMode;
  granularity: Granularity;
  selection: Selection | null;
  onSelect(selection: Selection | null): void;
}

interface HoverReadout {
  x: number;
  y: number;
  title: string;
  lst: number;
}

const NOTHING_SELECTED = -1;
const CELL_FOCUS_ZOOM = 12.4;
const BASEMAP_TIMEOUT_MS = 6000;

/** On narrow screens the panel is a bottom sheet over the map; keep in sync with app.css. */
const SHEET_SHARE = 0.48;

function bottomInset(container: HTMLElement): number {
  return window.matchMedia('(max-width: 720px)').matches ? container.clientHeight * SHEET_SHARE : 0;
}

/** The drawing buffer is only valid inside the frame that drew it, so read it from the render event. */
function captureCanvas(map: MapLibreMap): Promise<string> {
  return new Promise((resolve) => {
    map.once('render', () => resolve(map.getCanvas().toDataURL('image/png')));
    map.triggerRepaint();
  });
}

export const HeatMap = forwardRef<HeatMapHandle, HeatMapProps>(function HeatMap(
  { detail, scales, mode, granularity, selection, onSelect },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const hoveredRef = useRef<{ source: string; id: number } | null>(null);
  const onSelectRef = useRef(onSelect);
  const granularityRef = useRef(granularity);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<HoverReadout | null>(null);

  onSelectRef.current = onSelect;
  granularityRef.current = granularity;

  const cellsGeoJson = useMemo(() => cellsToGeoJson(detail), [detail]);
  const districtsGeoJson = useMemo(() => districtsToGeoJson(detail), [detail]);

  useImperativeHandle(ref, () => ({
    snapshot: async () => (mapRef.current ? captureCanvas(mapRef.current) : null),
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = new MapLibreMap({
      container,
      style: BASEMAP_STYLE,
      bounds: detail.city.bbox as LngLatBoundsLike,
      fitBoundsOptions: { padding: { top: 64, left: 16, right: 16, bottom: 16 + bottomInset(container) } },
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-left');
    mapRef.current = map;

    let dataAdded = false;
    let basemapFailed = false;
    map.once('style.load', () => {
      tuneBasemap(map);
      addDataLayers(map, cellsGeoJson, districtsGeoJson);
      dataAdded = true;
      setReady(true);
    });
    const fallBackToPlainStyle = () => {
      if (dataAdded || basemapFailed) return;
      basemapFailed = true;
      map.setStyle(FALLBACK_STYLE, { diff: false });
    };
    const basemapTimeout = window.setTimeout(fallBackToPlainStyle, BASEMAP_TIMEOUT_MS);
    map.on('error', fallBackToPlainStyle);

    const clearHover = () => {
      const hovered = hoveredRef.current;
      if (hovered) map.setFeatureState(hovered, { hover: false });
      hoveredRef.current = null;
      setHover(null);
      map.getCanvas().style.cursor = '';
    };

    const activeLayer = () => (granularityRef.current === 'cells' ? LAYER.cellsFill : LAYER.districtsFill);
    const featureAt = (point: Point): MapGeoJSONFeature | undefined =>
      map.getLayer(activeLayer()) ? map.queryRenderedFeatures(point, { layers: [activeLayer()] })[0] : undefined;

    map.on('mousemove', (event: MapMouseEvent) => {
      const feature = featureAt(event.point);
      if (!feature || typeof feature.id !== 'number') {
        clearHover();
        return;
      }
      const source = granularityRef.current === 'cells' ? SOURCE.cells : SOURCE.districts;
      const hovered = hoveredRef.current;
      if (!hovered || hovered.id !== feature.id || hovered.source !== source) {
        if (hovered) map.setFeatureState(hovered, { hover: false });
        hoveredRef.current = { source, id: feature.id };
        map.setFeatureState(hoveredRef.current, { hover: true });
      }
      map.getCanvas().style.cursor = 'pointer';
      const name = feature.properties.name;
      setHover({
        x: event.point.x,
        y: event.point.y,
        title: typeof name === 'string' ? name : '',
        lst: Number(feature.properties.lst),
      });
    });
    map.on('mouseout', clearHover);

    map.on('click', (event: MapMouseEvent) => {
      const feature = featureAt(event.point);
      if (!feature || typeof feature.id !== 'number') return;
      onSelectRef.current({ kind: granularityRef.current === 'cells' ? 'cell' : 'district', index: feature.id });
    });

    return () => {
      window.clearTimeout(basemapTimeout);
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [detail, cellsGeoJson, districtsGeoJson]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const color = fillColorExpression(mode, scales);
    map.setPaintProperty(LAYER.cellsFill, 'fill-color', color);
    if (map.getLayer(LAYER.districtsFill)) map.setPaintProperty(LAYER.districtsFill, 'fill-color', color);
  }, [ready, mode, scales]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const showCells = granularity === 'cells';
    map.setLayoutProperty(LAYER.cellsFill, 'visibility', showCells ? 'visible' : 'none');
    map.setLayoutProperty(LAYER.cellsHover, 'visibility', showCells ? 'visible' : 'none');
    if (map.getLayer(LAYER.districtsFill)) {
      map.setLayoutProperty(LAYER.districtsFill, 'visibility', showCells ? 'none' : 'visible');
      map.setPaintProperty(LAYER.districtsLine, 'line-opacity', showCells ? 0.32 : 0.7);
    }
    if (map.getLayer(LAYER.districtsLabel)) map.setLayoutProperty(LAYER.districtsLabel, 'visibility', showCells ? 'none' : 'visible');
  }, [ready, granularity]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const cellId = selection?.kind === 'cell' ? selection.index : NOTHING_SELECTED;
    const districtId = selection?.kind === 'district' ? selection.index : NOTHING_SELECTED;
    map.setFilter(LAYER.cellsSelectedHalo, ['==', ['id'], cellId]);
    map.setFilter(LAYER.cellsSelected, ['==', ['id'], cellId]);
    if (map.getLayer(LAYER.districtsSelected)) map.setFilter(LAYER.districtsSelected, ['==', ['id'], districtId]);

    if (selection?.kind === 'district') {
      const district = detail.districts[selection.index];
      if (district) {
        const [w, s, e, n] = geometryBounds(district.geometry);
        map.fitBounds([w, s, e, n], { padding: { top: 48, left: 48, right: 48, bottom: 48 + bottomInset(map.getContainer()) }, duration: 900 });
      }
    } else if (selection?.kind === 'cell') {
      const center: [number, number] = [detail.cells.lon[selection.index] ?? 0, detail.cells.lat[selection.index] ?? 0];
      map.easeTo({
        center,
        zoom: Math.max(map.getZoom(), CELL_FOCUS_ZOOM),
        padding: { top: 0, left: 0, right: 0, bottom: bottomInset(map.getContainer()) },
        duration: 800,
      });
    }
  }, [ready, selection, detail]);

  return (
    <div className="map" aria-label={`Карта температуры поверхности: ${detail.city.name}`} role="region">
      <div ref={containerRef} className="map__canvas" />
      {hover && (
        <div className="map__readout" style={{ transform: `translate(${hover.x + 14}px, ${hover.y + 14}px)` }} aria-hidden>
          {hover.title && <span className="map__readout-title">{hover.title}</span>}
          <span className="map__readout-value">{formatTemp(hover.lst)}</span>
        </div>
      )}
    </div>
  );
});
