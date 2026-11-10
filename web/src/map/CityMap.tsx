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
  type PaddingOptions,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './worker';
import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react';
import type { CityModel } from '../domain/cityModel';
import type { FoundName } from '../domain/placeName';
import type { Site } from '../domain/sites';
import { geometryBounds } from '../domain/stats';
import type { LonLat, Transect } from '../domain/transect';
import { patternImage } from '../ui/patterns';
import type { FacilityType } from '../data/contract';
import { facilityImage, facilityImageId } from './facilityImages';
import { IsothermLabelLayer } from './isothermLabels';
import { nameFromBasemap, siteFromBasemap } from './placeNames';
import { LAYER, SOURCE, bandOpacity, buildStyle } from './style';
import { readTokens, type MapTokens } from './tokens';

export type MapMode = 'temperature' | 'causes';

/** What the map shows and allows at this point of the page. */
export interface MapView {
  isolines: boolean;
  transect: boolean;
  /** Pan, zoom and drag the ends of the section. Off while the page is telling the story. */
  interactive: boolean;
}

export interface CityMapHandle {
  nameAt(point: LonLat, district: string | null): FoundName | null;
  /** An airfield or a rail yard under the point, from the basemap. */
  siteAt(point: LonLat): Site | null;
}

interface CityMapProps {
  model: CityModel;
  view: MapView;
  /** Room kept free around the city for text and panels over the map, px. */
  padding: PaddingOptions;
  transect: Transect;
  onTransectChange(transect: Transect): void;
  /** "Новый разрез" is armed: the next drag draws a line instead of panning. */
  drawing: boolean;
  onDrawingEnd(): void;
  place: LonLat | null;
  onPick(point: LonLat): void;
  probe: LonLat | null;
  /** Hot quarters already found in the opening game. */
  found: LonLat[];
  mode: MapMode;
  /** People living on each cell as dots, and schools and clinics on the hottest cells. */
  people?: boolean;
  /** Text of the small readout under the pointer, or null where there is nothing to say. */
  describe(point: LonLat): string | null;
  /** The basemap finished loading tiles for the current view. */
  onIdle(): void;
  /** Overlays drawn over the map: chips, toolbars, hints. */
  children?: ReactNode;
}

/** Below this pointer travel, px, a press is a click, not a drag. */
const CLICK_SLOP_PX = 6;
const HINT_KEY = 'uzha.handles-hinted';
const HINT_MS = 2600;
const TAP_TIP_MS = 2400;
const EMPTY = { type: 'FeatureCollection' as const, features: [] };
const FACILITY_TYPES: FacilityType[] = ['school', 'kindergarten', 'clinic', 'hospital'];

const lineOf = (transect: Transect) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: transect } });
const pointOf = (point: LonLat | null) => (point ? { type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: point } } : EMPTY);
const pointsOf = (points: LonLat[]) => ({
  type: 'FeatureCollection' as const,
  features: points.map((coordinates) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates } })),
});

function setData(map: MapLibreMap, source: string, data: Parameters<GeoJSONSource['setData']>[0]): void {
  (map.getSource(source) as GeoJSONSource | undefined)?.setData(data);
}

function boundsOf(model: CityModel): LngLatBoundsLike {
  const [w, s, e, n] = geometryBounds(model.outline ?? model.isotherms.coverage);
  return [w, s, e, n];
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

function setInteractive(map: MapLibreMap, markers: Marker[], on: boolean): void {
  for (const handler of [map.dragPan, map.scrollZoom, map.doubleClickZoom, map.touchZoomRotate, map.keyboard]) {
    if (on) handler.enable();
    else handler.disable();
  }
  markers.forEach((marker) => marker.setDraggable(on));
}

export const CityMap = forwardRef<CityMapHandle, CityMapProps>(function CityMap(props, ref) {
  const { model, view, padding, transect, drawing, place, probe, found, mode, people = false } = props;
  const frameRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<SVGSVGElement>(null);
  const tipRef = useRef<HTMLParagraphElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const tokensRef = useRef<MapTokens | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useImperativeHandle(ref, () => ({
    nameAt(point, district) {
      return mapRef.current ? nameFromBasemap(mapRef.current, point, district) : null;
    },
    siteAt(point) {
      return mapRef.current ? siteFromBasemap(mapRef.current, point) : null;
    },
  }));

  useEffect(() => {
    const container = containerRef.current;
    const labelSvg = labelsRef.current;
    const tip = tipRef.current;
    if (!container || !labelSvg || !tip) return;
    const tokens = readTokens();
    tokensRef.current = tokens;
    const map = new MapLibreMap({
      container,
      style: buildStyle(model, tokens),
      bounds: boundsOf(model),
      fitBoundsOptions: { padding: latest.current.padding },
      attributionControl: false,
      boxZoom: false,
      dragRotate: false,
      pitchWithRotate: false,
      cooperativeGestures: true,
      maxZoom: 16,
      minZoom: 8,
      locale: {
        'NavigationControl.ZoomIn': 'Приблизить',
        'NavigationControl.ZoomOut': 'Отдалить',
        'ScaleControl.Meters': 'м',
        'ScaleControl.Kilometers': 'км',
        'AttributionControl.ToggleAttribution': 'Источники карты',
        'CooperativeGesturesHandler.WindowsHelpText': 'Чтобы приблизить карту, крутите колесо с зажатым Ctrl',
        'CooperativeGesturesHandler.MacHelpText': 'Чтобы приблизить карту, крутите колесо с зажатым ⌘',
        'CooperativeGesturesHandler.MobileHelpText': 'Двигайте карту двумя пальцами',
      },
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new ScaleControl({ maxWidth: 96, unit: 'metric' }), 'bottom-left');
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    mapRef.current = map;
    // A failed basemap tile is not worth an error screen: the isotherms are local data and stay.
    map.on('error', () => noticeRef.current?.classList.add('is-on'));

    const addPatterns = () => {
      for (const { properties } of model.causeAreas.features) {
        const id = `hatch-${properties.key}-heats`;
        const image = patternImage(properties.key, 'heats', tokens.hatchHeats, 2);
        if (image && !map.hasImage(id)) map.addImage(id, image, { pixelRatio: 2 });
      }
      for (const type of FACILITY_TYPES) {
        const image = facilityImage(type, tokens, 2);
        if (image && !map.hasImage(facilityImageId(type))) map.addImage(facilityImageId(type), image, { pixelRatio: 2 });
      }
    };

    const { source } = model;
    const anchors = model.isotherms.anchors.filter((a) => source.cellAt(a.at as LonLat) >= 0 && source.inside(a.at as LonLat));
    const labels = new IsothermLabelLayer(map, labelSvg, anchors);
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
        if (wasHinted() || !latest.current.view.interactive) return;
        rememberHinted();
        element.classList.add('is-hinting');
        window.setTimeout(() => element.classList.remove('is-hinting'), HINT_MS);
      });
      return marker;
    });
    markersRef.current = handles;
    setInteractive(map, handles, latest.current.view.interactive);

    // The readout under the pointer is plain DOM, moved directly: no React render per mouse move.
    let tapTimer = 0;
    const showTip = (event: MapMouseEvent) => {
      const text = latest.current.describe(event.lngLat.toArray() as LonLat);
      if (!text) {
        tip.classList.remove('is-on');
        return;
      }
      tip.textContent = text;
      const flip = event.point.x > container.clientWidth - 200;
      tip.style.transform = `translate(${Math.round(event.point.x + (flip ? -14 : 14))}px, ${Math.round(event.point.y - 14)}px) translate(${flip ? '-100%' : '0'}, -100%)`;
      tip.classList.add('is-on');
    };
    const hideTip = () => tip.classList.remove('is-on');
    map.on('mousemove', (event) => {
      if (!draft) showTip(event);
    });
    map.on('mouseout', hideTip);
    map.on('movestart', hideTip);

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
    const canDraw = () => latest.current.view.interactive;
    map.on('mousedown', (event) => {
      if (canDraw() && (latest.current.drawing || event.originalEvent.shiftKey)) startDraft(event);
    });
    map.on('touchstart', (event) => {
      if (canDraw() && latest.current.drawing && event.points.length === 1) startDraft(event);
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
      showTip(event);
      window.clearTimeout(tapTimer);
      tapTimer = window.setTimeout(hideTip, TAP_TIP_MS);
      latest.current.onPick(event.lngLat.toArray() as LonLat);
    });

    const onShift = (event: KeyboardEvent) => container.classList.toggle('is-shift', event.shiftKey);
    window.addEventListener('keydown', onShift);
    window.addEventListener('keyup', onShift);

    map.once('load', () => {
      addPatterns();
      setData(map, SOURCE.transect, lineOf(latest.current.transect));
      setData(map, SOURCE.found, pointsOf(latest.current.found));
      updateLabels();
    });

    return () => {
      window.clearTimeout(tapTimer);
      window.removeEventListener('mouseup', endDraft);
      window.removeEventListener('keydown', onShift);
      window.removeEventListener('keyup', onShift);
      handles.forEach((marker) => marker.remove());
      map.remove();
      mapRef.current = null;
      labelSvg.replaceChildren();
    };
  }, [model]);

  const paddingKey = `${padding.top} ${padding.right} ${padding.bottom} ${padding.left}`;
  const firstFit = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (firstFit.current) {
      firstFit.current = false;
      return;
    }
    map.fitBounds(boundsOf(model), { padding: latest.current.padding, duration: reducedMotion() ? 0 : 1100, essential: false });
  }, [paddingKey, model]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setInteractive(map, markersRef.current, view.interactive);
    frameRef.current?.classList.toggle('is-locked', !view.interactive);
  }, [view.interactive]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const show = (id: string, on: boolean) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      show(LAYER.isolines, view.isolines);
      show(LAYER.transect, view.transect);
      show(LAYER.transectCasing, view.transect);
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
    frameRef.current?.classList.toggle('has-isolines', view.isolines);
    frameRef.current?.classList.toggle('has-transect', view.transect);
  }, [view.isolines, view.transect, model]);

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
    if (map?.getSource(SOURCE.found)) setData(map, SOURCE.found, pointsOf(found));
  }, [found]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      map.setLayoutProperty(LAYER.causes, 'visibility', mode === 'causes' ? 'visible' : 'none');
      if (tokensRef.current) map.setPaintProperty(LAYER.bands, 'fill-opacity', bandOpacity(tokensRef.current, mode));
    };
    if (map.getLayer(LAYER.causes)) apply();
    else map.once('load', apply);
  }, [mode, model]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      map.setLayoutProperty(LAYER.people, 'visibility', people ? 'visible' : 'none');
      map.setLayoutProperty(LAYER.facilities, 'visibility', people ? 'visible' : 'none');
    };
    if (map.getLayer(LAYER.people)) apply();
    else map.once('load', apply);
  }, [people, model]);

  useEffect(() => {
    containerRef.current?.classList.toggle('is-drawing', drawing);
  }, [drawing]);

  return (
    <div ref={frameRef} className="map" role="region" aria-label={`Карта температуры поверхности: ${model.detail.city.name}`}>
      <div ref={containerRef} className="map__canvas" />
      <svg ref={labelsRef} className="map__labels" aria-hidden="true" />
      <p ref={tipRef} className="map__tip" aria-hidden="true" />
      <p ref={noticeRef} className="map__notice" role="status">
        Подложка карты загрузилась не вся, изотермы на месте.
      </p>
      {props.children}
    </div>
  );
});
