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
import { cityName } from '../domain/dataTexts';
import type { FoundName } from '../domain/placeName';
import type { Site } from '../domain/sites';
import { geometryBounds } from '../domain/stats';
import type { LonLat, Transect } from '../domain/transect';
import { useLocale } from '../ui/locale';
import { patternImage } from '../ui/patterns';
import type { FacilityType } from '../data/contract';
import { classOf, type LabelAnchor } from '../domain/isotherms';
import type { MapOverlay } from '../domain/layers';
import { facilityImage, facilityImageId } from './facilityImages';
import { buildingsUrl } from './buildingsData';
import { followView, hasBuildingsFile } from './fileBuildings';
import { buildingClass } from './heatBuildings';
import { IsothermLabelLayer } from './isothermLabels';
import { MAP_TEXTS, type MapTexts } from './map.texts';
import { nameFromBasemap, siteFromBasemap } from './placeNames';
import { BUILDINGS_MIN_ZOOM, LAYER, SOURCE, bandOpacity, buildStyle } from './style';
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
  /** Frames these points, so marks that crowd each other at the city's zoom stand apart. */
  frame(points: readonly LonLat[]): void;
}

export interface MapMark {
  point: LonLat;
  /** What the mark shows: a rank, one or two characters. */
  label: string;
  /** What a screen reader says for it. */
  name: string;
}

const NO_MARKS: readonly MapMark[] = [];

interface CityMapProps {
  model: CityModel;
  view: MapView;
  /** Room kept free around the city for text and panels over the map, px. */
  padding: PaddingOptions;
  transect: Transect;
  onTransectChange(transect: Transect): void;
  /** "New section" is armed: the next drag draws a line instead of panning. */
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
  /** Tilt the camera and raise the buildings over the temperature map. */
  threeD?: boolean;
  /** Numbered places over the map (the planting list); a click opens the place, as the list does. */
  marks?: readonly MapMark[];
  /** Another quantity drawn instead of the surface temperature: a flux of the energy balance, or the night. */
  overlay?: MapOverlay | null;
  /** Text of the small readout under the pointer, or null where there is nothing to say. */
  describe(point: LonLat): string | null;
  /** The basemap finished loading tiles for the current view. */
  onIdle(): void;
  /** Overlays drawn over the map: chips, toolbars, hints. */
  children?: ReactNode;
}

/** The 3D view: tilted and turned a little, close enough for the buildings in the basemap tiles to show. */
const THREE_D_PITCH = 52;
const THREE_D_BEARING = -20;
const THREE_D_ZOOM = BUILDINGS_MIN_ZOOM + 0.4;
/** Cause hatching under the 3D buildings. */
const THREE_D_HATCH_OPACITY = 0.45;
/** Basemap tiles come in bursts; buildings are coloured once the burst settles. */
const PAINT_DELAY_MS = 150;
/** The section line steps back in 3D, the buildings are the subject there. */
const THREE_D_TRANSECT_OPACITY = 0.55;

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

/** In 3D, our own buildings from the city's .fgb when it is there, else the basemap's; flat, neither. */
function showBuildings(map: MapLibreMap, threeD: boolean, fromFile: boolean): void {
  map.setLayoutProperty(LAYER.buildings, 'visibility', threeD && !fromFile ? 'visible' : 'none');
  map.setLayoutProperty(LAYER.buildingsFile, 'visibility', threeD && fromFile ? 'visible' : 'none');
}

function boundsOf(model: CityModel): LngLatBoundsLike {
  const [w, s, e, n] = geometryBounds(model.outline ?? model.isotherms.coverage);
  return [w, s, e, n];
}

/** Room around framed marks, beyond the map's own padding, and how close framing may come. */
const FRAME_MARGIN = 36;
const FRAME_MAX_ZOOM = 14;

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

function handleElement(letter: string, t: MapTexts): HTMLDivElement {
  const element = document.createElement('div');
  element.className = 'handle';
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', t.handle(letter));
  const mark = document.createElement('span');
  mark.className = 'handle__mark';
  mark.textContent = letter;
  const hint = document.createElement('span');
  hint.className = 'handle__hint';
  hint.textContent = t.drag;
  element.append(mark, hint);
  return element;
}

/** MapLibre moves the marker element by its transform, so the look and the hover scale live on an inner span. */
function markElement(mark: MapMark): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'mark';
  element.setAttribute('aria-label', mark.name);
  const face = document.createElement('span');
  face.className = 'mark__face num';
  face.textContent = mark.label;
  element.append(face);
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
  const { model, view, padding, transect, drawing, place, probe, found, mode, people = false, threeD = false, marks = NO_MARKS, overlay = null } = props;
  const frameRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<SVGSVGElement>(null);
  const tipRef = useRef<HTMLParagraphElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  // A drag that drew a section ends in a click; neither the map nor a mark may treat it as picking a place.
  const suppressClickRef = useRef(false);
  const tokensRef = useRef<MapTokens | null>(null);
  const labelLayerRef = useRef<IsothermLabelLayer | null>(null);
  /** The isotherm labels of the temperature, kept to come back to from another layer. */
  const isothermAnchorsRef = useRef<LabelAnchor[]>([]);
  const locale = useLocale();
  const t = MAP_TEXTS[locale];
  const latest = useRef(props);
  latest.current = props;

  useImperativeHandle(ref, () => ({
    nameAt(point, district) {
      return mapRef.current ? nameFromBasemap(mapRef.current, point, district, locale) : null;
    },
    siteAt(point) {
      return mapRef.current ? siteFromBasemap(mapRef.current, point, locale) : null;
    },
    frame(points) {
      const map = mapRef.current;
      if (!map || !points.length) return;
      const lons = points.map(([lon]) => lon);
      const lats = points.map(([, lat]) => lat);
      const { top = 0, right = 0, bottom = 0, left = 0 } = latest.current.padding;
      map.fitBounds([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], {
        padding: { top: top + FRAME_MARGIN, right: right + FRAME_MARGIN, bottom: bottom + FRAME_MARGIN, left: left + FRAME_MARGIN },
        maxZoom: FRAME_MAX_ZOOM,
        duration: reducedMotion() ? 0 : 900,
        essential: false,
      });
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
      locale: t.controls,
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new ScaleControl({ maxWidth: 96, unit: 'metric' }), 'bottom-left');
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    mapRef.current = map;
    // A failed basemap tile is not worth an error screen: the isotherms are local data and stay. The note shows while
    // tiles keep failing and goes once the map settles without a new error (one lost tile at one zoom is not an outage).
    let failedSinceIdle = false;
    map.on('error', () => {
      failedSinceIdle = true;
      noticeRef.current?.classList.add('is-on');
    });
    map.on('idle', () => {
      if (!failedSinceIdle) noticeRef.current?.classList.remove('is-on');
      failedSinceIdle = false;
    });

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
    labelLayerRef.current = labels;
    isothermAnchorsRef.current = anchors;
    const updateLabels = () => labels.update();
    map.on('move', updateLabels);
    map.on('resize', updateLabels);
    map.on('idle', () => latest.current.onIdle());

    const handles = t.ends.map((letter, i) => {
      const element = handleElement(letter, t);
      const marker = new Marker({ element, draggable: true }).setLngLat(latest.current.transect[i] ?? [0, 0]).addTo(map);
      marker.on('drag', () => {
        const [a, b] = markersRef.current.map((m) => m.getLngLat().toArray() as LonLat);
        if (a && b) latest.current.onTransectChange([a, b]);
      });
      element.addEventListener('mouseenter', () => {
        if (wasHinted() || !latest.current.view.interactive) return;
        rememberHinted();
        // Near the right edge the hint goes to the left of the end, or the map's frame would cut it.
        const frame = map.getContainer().getBoundingClientRect();
        element.classList.toggle('is-hint-left', element.getBoundingClientRect().right > frame.left + frame.width / 2);
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
        suppressClickRef.current = true;
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
    // A cancelled touch is followed by no click to swallow: just disarm, or the next move would go on drawing.
    map.on('touchcancel', () => {
      draft = null;
    });
    window.addEventListener('mouseup', endDraft);

    map.on('click', (event) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
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
      // Set before the style finished loading, these found no source yet: a place from a link, a probe kept
      // across a language switch.
      setData(map, SOURCE.place, pointOf(latest.current.place));
      setData(map, SOURCE.probe, pointOf(latest.current.probe));
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
      labelLayerRef.current = null;
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
    if (latest.current.threeD) return;
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
    const contours = overlay?.kind === 'contours' ? overlay : null;
    const pixels = overlay?.kind === 'pixels' ? overlay : null;
    const apply = () => {
      const show = (id: string, on: boolean) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      setData(map, SOURCE.overlayBands, contours ? contours.bands : EMPTY);
      setData(map, SOURCE.overlayLines, contours ? contours.lines : EMPTY);
      setData(map, SOURCE.night, pixels ? pixels.pixels : EMPTY);
      show(LAYER.bands, !overlay);
      show(LAYER.isolines, view.isolines && !overlay);
      show(LAYER.overlayBands, contours !== null);
      show(LAYER.overlayLines, view.isolines && contours !== null);
      show(LAYER.night, pixels !== null);
      show(LAYER.transect, view.transect);
      show(LAYER.transectCasing, view.transect);
      // Flux lines carry bare numbers, the legend gives the unit; the night pixels need no lines to read.
      if (overlay) labelLayerRef.current?.show(contours ? contours.anchors : [], '');
      else labelLayerRef.current?.show(isothermAnchorsRef.current, '°');
    };
    // Not isStyleLoaded: right after a layer switch its source is still loading, and the load event will not come again.
    if (map.getLayer(LAYER.night)) apply();
    else map.once('load', apply);
    frameRef.current?.classList.toggle('has-isolines', view.isolines);
    frameRef.current?.classList.toggle('has-transect', view.transect);
    return () => {
      map.off('load', apply);
    };
  }, [view.isolines, view.transect, model, overlay]);

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
    // With a place open, the planting marks step back so the picked place is the one thing the eye lands on.
    frameRef.current?.classList.toggle('has-place', place !== null);
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
    const placed = marks.map((mark, i) => {
      const element = markElement(mark);
      // In rank order for the keyboard and screen readers; where two marks overlap, the higher rank stays on top.
      element.style.zIndex = String(marks.length - i);
      element.addEventListener('click', (event) => {
        // The mark sits inside the map's canvas container: the map must not also pick the cell under the cursor.
        event.stopPropagation();
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        if (latest.current.drawing) return;
        latest.current.onPick(mark.point);
      });
      return new Marker({ element }).setLngLat(mark.point).addTo(map);
    });
    return () => placed.forEach((marker) => marker.remove());
  }, [marks, model]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      map.setLayoutProperty(LAYER.causes, 'visibility', mode === 'causes' ? 'visible' : 'none');
      if (tokensRef.current) map.setPaintProperty(LAYER.bands, 'fill-opacity', bandOpacity(tokensRef.current, mode, threeD));
      // Under the buildings the hatching only has to say which cause; at full strength it fights the walls.
      map.setPaintProperty(LAYER.causes, 'fill-opacity', threeD ? THREE_D_HATCH_OPACITY : 1);
    };
    if (map.getLayer(LAYER.causes)) apply();
    else map.once('load', apply);
  }, [mode, model, threeD]);

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

  // In 3D, read the buildings of the view from the city's own file; the basemap's stay as the fallback.
  const fromFile = useRef(false);
  /** Colours the basemap's buildings now; set by the paint effect, called when the file fails and they take over. */
  const paintBasemap = useRef<(() => void) | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !threeD) return undefined;
    const url = buildingsUrl(import.meta.env.BASE_URL, model.detail.city.id);
    let stop: (() => void) | null = null;
    let cancelled = false;
    const use = (on: boolean) => {
      fromFile.current = on;
      if (map.getLayer(LAYER.buildingsFile)) showBuildings(map, true, on);
    };
    // The basemap's buildings stay on until the file has delivered: on a slow server the reader sees a city in 3D at once,
    // and the exact buildings replace it when they arrive.
    const start = () => {
      if (cancelled) return;
      stop = followView(map, {
        url,
        source: SOURCE.buildings,
        minZoom: BUILDINGS_MIN_ZOOM,
        temperatureAt: model.source.temperatureAt,
        classOf: (t) => classOf(model.levels, t),
        onData: () => {
          if (!fromFile.current) use(true);
        },
        onFail: () => {
          stop?.();
          stop = null;
          use(false);
          paintBasemap.current?.();
        },
      });
    };
    void hasBuildingsFile(url).then((ok) => {
      if (!ok || cancelled) return;
      if (map.getLayer(LAYER.buildingsFile)) start();
      else map.once('load', start);
    });
    return () => {
      cancelled = true;
      map.off('load', start);
      stop?.();
      fromFile.current = false;
    };
  }, [threeD, model]);

  // Colour the basemap's buildings as they come into view: one feature state per building id, never recomputed.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !threeD) return undefined;
    const painted = new Set<string | number>();
    const classOfT = (t: number) => classOf(model.levels, t);
    const paint = () => {
      if (map.getZoom() < BUILDINGS_MIN_ZOOM || fromFile.current) return;
      for (const feature of map.querySourceFeatures(SOURCE.basemap, { sourceLayer: 'building' })) {
        const { id } = feature;
        if (id === undefined || painted.has(id)) continue;
        painted.add(id);
        map.setFeatureState({ source: SOURCE.basemap, sourceLayer: 'building', id }, { k: buildingClass(feature.geometry, model.source.temperatureAt, classOfT) });
      }
    };
    // Whenever the basemap has finished loading the tiles for the view, a moment later, so a burst is painted once.
    let timer = 0;
    const onData = (event: { sourceId?: string; isSourceLoaded?: boolean }) => {
      if (event.sourceId !== SOURCE.basemap || !event.isSourceLoaded) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(paint, PAINT_DELAY_MS);
    };
    map.on('sourcedata', onData);
    paintBasemap.current = paint;
    if (map.isStyleLoaded()) paint();
    return () => {
      map.off('sourcedata', onData);
      window.clearTimeout(timer);
      paintBasemap.current = null;
    };
  }, [threeD, model]);

  // Tilt into 3D and back. Only on a real change for this map: a flat map's first render must not start a camera
  // animation, and a new map (another city) opened in 3D must tilt again.
  const tiltedMap = useRef<MapLibreMap | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const apply = () => {
      showBuildings(map, threeD, fromFile.current);
      map.setPaintProperty(LAYER.transect, 'line-opacity', threeD ? THREE_D_TRANSECT_OPACITY : 1);
      // Isotherm labels are flat SVG over the map: in a tilted view they float over the buildings, so they rest.
      frameRef.current?.classList.toggle('is-3d', threeD);
      if (threeD === (tiltedMap.current === map)) return;
      tiltedMap.current = threeD ? map : null;
      const duration = reducedMotion() ? 0 : 1200;
      if (threeD) {
        map.dragRotate.enable();
        map.touchZoomRotate.enableRotation();
        // From the whole-city view, fly to the hottest neighbourhood; if the reader has already come close, stay there.
        const overview = map.getZoom() < THREE_D_ZOOM;
        map.easeTo({ pitch: THREE_D_PITCH, bearing: THREE_D_BEARING, zoom: overview ? THREE_D_ZOOM : map.getZoom(), ...(overview ? { center: model.threeDCenter } : {}), duration });
      } else {
        map.dragRotate.disable();
        map.touchZoomRotate.disableRotation();
        map.easeTo({ pitch: 0, bearing: 0, duration });
      }
    };
    if (map.getLayer(LAYER.buildings)) apply();
    else map.once('load', apply);
    return () => {
      map.off('load', apply);
    };
  }, [threeD, model]);

  useEffect(() => {
    containerRef.current?.classList.toggle('is-drawing', drawing);
  }, [drawing]);

  return (
    <div ref={frameRef} className="map" role="region" aria-label={t.region(cityName(model.detail.city, locale))}>
      <div ref={containerRef} className="map__canvas" />
      <svg ref={labelsRef} className="map__labels" aria-hidden="true" />
      <p ref={tipRef} className="map__tip" aria-hidden="true" />
      <p ref={noticeRef} className="map__notice" role="status">
        {t.basemapFailed}
      </p>
      {props.children}
    </div>
  );
});
