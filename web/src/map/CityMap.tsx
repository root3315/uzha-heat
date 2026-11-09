import {
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  type GeoJSONSource,
  type LngLatBoundsLike,
  type MapMouseEvent,
  type MapTouchEvent,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './worker';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { CityModel } from '../domain/cityModel';
import type { FoundName } from '../domain/placeName';
import { geometryBounds } from '../domain/stats';
import type { LonLat, Transect } from '../domain/transect';
import { patternImage } from '../ui/patterns';
import { IsothermLabelLayer } from './isothermLabels';
import { nameFromBasemap } from './placeNames';
import { snapshotMap } from './snapshot';
import { LAYER, SOURCE, bandOpacity, buildStyle } from './style';
import { readTokens, type MapTokens } from './tokens';

export type MapMode = 'temperature' | 'causes';

export interface CityMapHandle {
  snapshot(): Promise<string | null>;
  nameAt(point: LonLat, district: string | null): FoundName | null;
}

interface CityMapProps {
  model: CityModel;
  transect: Transect;
  onTransectChange(transect: Transect): void;
  /** "Новый разрез" is armed: the next drag draws a line instead of panning. */
  drawing: boolean;
  onDrawingEnd(): void;
  place: LonLat | null;
  onPick(point: LonLat): void;
  probe: LonLat | null;
  mode: MapMode;
  /** The basemap finished loading tiles for the current view. */
  onIdle(): void;
}

/** Below this pointer travel, px, a press is a click, not a drag. */
const CLICK_SLOP_PX = 6;
const HINT_KEY = 'uzha.handles-hinted';
const HINT_MS = 2600;
const EMPTY = { type: 'FeatureCollection' as const, features: [] };

const lineOf = (transect: Transect) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: transect } });
const pointOf = (point: LonLat | null) => (point ? { type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: point } } : EMPTY);

function setData(map: MapLibreMap, source: string, data: Parameters<GeoJSONSource['setData']>[0]): void {
  (map.getSource(source) as GeoJSONSource | undefined)?.setData(data);
}

function boundsOf(model: CityModel): LngLatBoundsLike {
  const [w, s, e, n] = geometryBounds(model.outline ?? model.isotherms.coverage);
  return [w, s, e, n];
}

function wasHinted(): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberHinted(): void {
  try {
    window.localStorage.setItem(HINT_KEY, '1');
  } catch {
    /* private mode: the hint simply shows again next time */
  }
}

function handleElement(letter: string): HTMLDivElement {
  const element = document.createElement('div');
  element.className = 'handle';
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', `Конец разреза ${letter}`);
  const mark = document.createElement('span');
  mark.className = 'handle__mark';
  mark.textContent = letter;
  const hint = document.createElement('span');
  hint.className = 'handle__hint';
  hint.textContent = 'тяните';
  element.append(mark, hint);
  return element;
}

export const CityMap = forwardRef<CityMapHandle, CityMapProps>(function CityMap(props, ref) {
  const { model, transect, drawing, place, probe, mode } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<SVGSVGElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const labelLayerRef = useRef<IsothermLabelLayer | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const tokensRef = useRef<MapTokens | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useImperativeHandle(ref, () => ({
    async snapshot() {
      const map = mapRef.current;
      const tokens = tokensRef.current;
      if (!map || !tokens) return null;
      return snapshotMap(map, labelLayerRef.current?.current() ?? [], latest.current.transect, tokens);
    },
    nameAt(point, district) {
      return mapRef.current ? nameFromBasemap(mapRef.current, point, district) : null;
    },
  }));

  useEffect(() => {
    const container = containerRef.current;
    const labelSvg = labelsRef.current;
    if (!container || !labelSvg) return;
    const tokens = readTokens();
    tokensRef.current = tokens;
    const map = new MapLibreMap({
      container,
      style: buildStyle(model, tokens),
      bounds: boundsOf(model),
      fitBoundsOptions: { padding: 28 },
      attributionControl: false,
      boxZoom: false,
      dragRotate: false,
      pitchWithRotate: false,
      maxZoom: 16,
      minZoom: 8,
      locale: {
        'NavigationControl.ZoomIn': 'Приблизить',
        'NavigationControl.ZoomOut': 'Отдалить',
        'ScaleControl.Meters': 'м',
        'ScaleControl.Kilometers': 'км',
        'AttributionControl.ToggleAttribution': 'Источники карты',
      },
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new ScaleControl({ maxWidth: 96, unit: 'metric' }), 'bottom-left');
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    mapRef.current = map;

    const addPatterns = () => {
      for (const { properties } of model.causeAreas.features) {
        const id = `hatch-${properties.key}-heats`;
        const image = patternImage(properties.key, 'heats', tokens.hatchHeats, 2);
        if (image && !map.hasImage(id)) map.addImage(id, image, { pixelRatio: 2 });
      }
    };

    const { source } = model;
    const anchors = model.isotherms.anchors.filter((a) => source.cellAt(a.at as LonLat) >= 0 && source.inside(a.at as LonLat));
    const labels = new IsothermLabelLayer(map, labelSvg, anchors);
    labelLayerRef.current = labels;
    const updateLabels = () => labels.update();
    map.on('move', updateLabels);
    map.on('resize', updateLabels);
    map.on('idle', () => latest.current.onIdle());

    const handles = ['А', 'Б'].map((letter, i) => {
      const element = handleElement(letter);
      const marker = new Marker({ element, draggable: true }).setLngLat(latest.current.transect[i] ?? [0, 0]).addTo(map);
      marker.on('drag', () => {
        const [a, b] = markersRef.current.map((m) => m.getLngLat().toArray() as LonLat);
        if (a && b) latest.current.onTransectChange([a, b]);
      });
      element.addEventListener('mouseenter', () => {
        if (wasHinted()) return;
        rememberHinted();
        element.classList.add('is-hinting');
        window.setTimeout(() => element.classList.remove('is-hinting'), HINT_MS);
      });
      return marker;
    });
    markersRef.current = handles;

    let draft: { start: LonLat; x: number; y: number; moved: boolean } | null = null;
    let suppressClick = false;
    const startDraft = (event: MapMouseEvent | MapTouchEvent) => {
      event.preventDefault();
      draft = { start: event.lngLat.toArray() as LonLat, x: event.point.x, y: event.point.y, moved: false };
    };
    const moveDraft = (event: MapMouseEvent | MapTouchEvent) => {
      if (!draft) return;
      if (!draft.moved && Math.hypot(event.point.x - draft.x, event.point.y - draft.y) < CLICK_SLOP_PX) return;
      draft.moved = true;
      latest.current.onTransectChange([draft.start, event.lngLat.toArray() as LonLat]);
    };
    const endDraft = () => {
      if (!draft) return;
      if (draft.moved) {
        suppressClick = true;
        latest.current.onDrawingEnd();
      }
      draft = null;
    };
    map.on('mousedown', (event) => {
      if (latest.current.drawing || event.originalEvent.shiftKey) startDraft(event);
    });
    map.on('touchstart', (event) => {
      if (latest.current.drawing && event.points.length === 1) startDraft(event);
    });
    map.on('mousemove', moveDraft);
    map.on('touchmove', moveDraft);
    map.on('touchend', endDraft);
    window.addEventListener('mouseup', endDraft);

    map.on('click', (event) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      if (latest.current.drawing) return;
      latest.current.onPick(event.lngLat.toArray() as LonLat);
    });

    const onShift = (event: KeyboardEvent) => container.classList.toggle('is-shift', event.shiftKey);
    window.addEventListener('keydown', onShift);
    window.addEventListener('keyup', onShift);

    map.once('load', () => {
      addPatterns();
      setData(map, SOURCE.transect, lineOf(latest.current.transect));
      updateLabels();
    });

    return () => {
      window.removeEventListener('mouseup', endDraft);
      window.removeEventListener('keydown', onShift);
      window.removeEventListener('keyup', onShift);
      handles.forEach((marker) => marker.remove());
      map.remove();
      mapRef.current = null;
      labelLayerRef.current = null;
      labelSvg.replaceChildren();
    };
  }, [model]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((marker, i) => {
      const end = transect[i];
      if (end) marker.setLngLat(end);
    });
    if (map.getSource(SOURCE.transect)) setData(map, SOURCE.transect, lineOf(transect));
  }, [transect]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getSource(SOURCE.place)) setData(map, SOURCE.place, pointOf(place));
  }, [place]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getSource(SOURCE.probe)) setData(map, SOURCE.probe, pointOf(probe));
  }, [probe]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      map.setLayoutProperty(LAYER.causes, 'visibility', mode === 'causes' ? 'visible' : 'none');
      if (tokensRef.current) map.setPaintProperty(LAYER.bands, 'fill-opacity', bandOpacity(tokensRef.current, mode));
    };
    if (map.getLayer(LAYER.causes)) apply();
    else map.once('load', apply);
  }, [mode]);

  useEffect(() => {
    containerRef.current?.classList.toggle('is-drawing', drawing);
  }, [drawing]);

  return (
    <div className="map" role="region" aria-label={`Карта температуры поверхности: ${model.detail.city.name}`}>
      <div ref={containerRef} className="map__canvas" />
      <svg ref={labelsRef} className="map__labels" aria-hidden="true" />
    </div>
  );
});
