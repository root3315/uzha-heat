import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CitySummary } from '../data/contract';
import { genitive, sourcesLine } from '../domain/answers';
import type { CityModel } from '../domain/cityModel';
import { cellsToCsv, cellsToGeoJson } from '../domain/exportCells';
import { PRECISION, type NamePrecision } from '../domain/placeName';
import { cellProfile, districtAt } from '../domain/places';
import type { Site } from '../domain/sites';
import { sampleTransect, type LonLat, type Sample, type Transect } from '../domain/transect';
import { CityMap, type CityMapHandle, type MapMode } from '../map/CityMap';
import { Report } from '../report/Report';
import { CitySwitcher } from './CitySwitcher';
import { downloadText } from './download';
import { prefersReducedMotion, useViewport } from './hooks';
import { Link } from './Link';
import { MapHint } from './MapHint';
import { Panel } from './panel/Panel';
import { panelContent } from './panelContent';
import { useReadout } from './readout';
import { methodHref } from './routing';
import { Section } from './Section';

interface ToolProps {
  model: CityModel;
  cities: CitySummary[];
  onCity(id: string): void;
}

const UNNAMED = 'Участок без названия на карте';
const VIEW = { isolines: true, transect: true, interactive: true };
/** Below this width the panel and the section go under the map, and the controls move onto it. */
const NARROW_PX = 860;

interface PickedPlace {
  cell: number;
  point: LonLat;
  title: string;
  precision: NamePrecision;
  site: Site | null;
}

const isTouch = () => window.matchMedia('(pointer: coarse)').matches;

/** The working map: isotherms, a draggable section, the panel with one answer for the city or a place. */
export function Tool({ model, cities, onCity }: ToolProps) {
  const mapRef = useRef<CityMapHandle>(null);
  const mapFrameRef = useRef<HTMLDivElement>(null);
  const [transect, setTransect] = useState<Transect>(model.defaultTransect);
  const [drawing, setDrawing] = useState(false);
  const [mode, setMode] = useState<MapMode>('temperature');
  const [picked, setPicked] = useState<PickedPlace | null>(null);
  const [probe, setProbe] = useState<Sample | null>(null);
  const [report, setReport] = useState<string | null | undefined>(undefined);
  const { width } = useViewport();
  const narrow = width < NARROW_PX;
  const { detail } = model;
  const { cellUnder, describe } = useReadout(model);

  const profile = useMemo(() => sampleTransect(model.source, transect), [model, transect]);
  const place = useMemo(() => (picked ? cellProfile(detail, picked.cell) : null), [detail, picked]);
  const content = useMemo(() => panelContent(model, place, picked?.title ?? '', picked?.site ?? null), [model, place, picked]);
  const padding = useMemo(() => (narrow ? { top: 64, right: 24, bottom: 24, left: 24 } : { top: 32, right: 40, bottom: 32, left: 32 }), [narrow]);

  const pick = useCallback(
    (point: LonLat) => {
      const cell = cellUnder(point);
      if (cell < 0) return;
      const center: LonLat = [detail.cells.lon[cell] ?? point[0], detail.cells.lat[cell] ?? point[1]];
      const found = mapRef.current?.nameAt(center, districtAt(detail, center)) ?? null;
      const site = mapRef.current?.siteAt(point) ?? null;
      setPicked({ cell, point: center, title: found?.name ?? UNNAMED, precision: found?.precision ?? PRECISION.none, site });
    },
    [cellUnder, detail],
  );

  /** After zooming in, the basemap may know a closer name than it did at the first click. */
  const refineName = useCallback(() => {
    setPicked((current) => {
      if (!current || current.precision === PRECISION.place) return current;
      const found = mapRef.current?.nameAt(current.point, districtAt(detail, current.point)) ?? null;
      return found && found.precision > current.precision ? { ...current, title: found.name, precision: found.precision } : current;
    });
  }, [detail]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setDrawing(false);
      setPicked(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleDrawing = () => {
    const next = !drawing;
    setDrawing(next);
    // On a phone the button may sit below the map: bring the map back before the finger looks for it.
    if (next && narrow) mapFrameRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  };
  const toggleMode = () => setMode((current) => (current === 'causes' ? 'temperature' : 'causes'));
  const openReport = async () => setReport((await mapRef.current?.snapshot()) ?? null);

  const exportAs = (format: 'csv' | 'geojson') => {
    const name = `uzha-${detail.city.id}-cells`;
    if (format === 'csv') downloadText(`${name}.csv`, cellsToCsv(detail, model.inside), 'text/csv;charset=utf-8');
    else downloadText(`${name}.geojson`, cellsToGeoJson(detail, model.inside), 'application/geo+json');
  };

  const switcher = <CitySwitcher cities={cities} currentId={detail.city.id} onChange={onCity} />;
  const reportButton = (
    <button type="button" className="pill pill--small" onClick={openReport}>
      Отчёт
    </button>
  );
  const header = (
    <>
      {!narrow && switcher}
      <span className="panel__links">
        {picked && (
          <button type="button" className="pill pill--small" onClick={() => setPicked(null)}>
            Весь город
          </button>
        )}
        {!narrow && reportButton}
      </span>
    </>
  );
  const footer = (
    <div className="panel__foot">
      <p className="panel__export">
        <span>Все участки {genitive(detail.city.name)}: температура, факторы, вклады</span>
        <span className="panel__export-buttons">
          <button type="button" className="pill pill--small" onClick={() => exportAs('csv')}>
            CSV
          </button>
          <button type="button" className="pill pill--small" onClick={() => exportAs('geojson')}>
            GeoJSON
          </button>
        </span>
      </p>
      <p className="panel__sources">
        {sourcesLine(detail)}{' '}
        <Link className="text-link" href={methodHref(detail.city.id)}>
          Как это посчитано
        </Link>
      </p>
    </div>
  );

  return (
    <main className="tool">
      <div className="tool__map" ref={mapFrameRef}>
        <CityMap
          ref={mapRef}
          model={model}
          view={VIEW}
          padding={padding}
          transect={transect}
          onTransectChange={setTransect}
          drawing={drawing}
          onDrawingEnd={() => setDrawing(false)}
          place={picked?.point ?? null}
          onPick={pick}
          probe={probe?.point ?? null}
          found={[]}
          mode={mode}
          describe={describe}
          onIdle={refineName}
        >
          {narrow && (
            <div className="map-bar" role="toolbar" aria-label="Карта">
              {switcher}
              <button type="button" className="pill pill--small" aria-pressed={drawing} onClick={toggleDrawing}>
                {drawing ? 'Ведите' : 'Разрез'}
              </button>
              <button type="button" className="pill pill--small" aria-pressed={mode === 'causes'} onClick={toggleMode}>
                Причины
              </button>
              {reportButton}
            </div>
          )}
          <MapHint touch={narrow || isTouch()} />
        </CityMap>
      </div>
      <div className="tool__section">
        <Section
          model={model}
          profile={profile}
          isDefault={transect === model.defaultTransect}
          drawing={drawing}
          mode={mode}
          onDraw={toggleDrawing}
          onReset={() => setTransect(model.defaultTransect)}
          onModeChange={setMode}
          onProbe={setProbe}
          onPick={(sample) => pick(sample.point)}
        />
      </div>
      <aside className="tool__panel" aria-label="Что здесь происходит">
        <Panel model={model} content={content} header={header} footer={footer} />
      </aside>
      {report !== undefined && (
        <Report model={model} content={content} profile={profile} mapImage={report} placeTitle={picked ? content.title : null} onClose={() => setReport(undefined)} />
      )}
    </main>
  );
}
