import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CitySummary } from '../data/contract';
import { MissingDataError, loadBoundary, loadCity } from '../data/load';
import { genitive, sourcesLine } from '../domain/answers';
import { buildCityModel, type CityModel } from '../domain/cityModel';
import { PRECISION, type NamePrecision } from '../domain/placeName';
import { cellProfile, districtAt } from '../domain/places';
import { sampleTransect, type LonLat, type Sample, type Transect } from '../domain/transect';
import { CityMap, type CityMapHandle, type MapMode } from '../map/CityMap';
import { Report } from '../report/Report';
import { CitySwitcher } from './CitySwitcher';
import { useAsync } from './hooks';
import { MethodPage } from './MethodPage';
import { Panel } from './panel/Panel';
import { panelContent } from './panelContent';
import { routeHref, type Route } from './routing';
import { Section } from './Section';

interface CityScreenProps {
  cities: CitySummary[];
  city: CitySummary;
  page: Route['page'];
}

const UNNAMED = 'Участок без названия на карте';

async function loadModel(id: string): Promise<CityModel | null> {
  const [detail, outline] = await Promise.all([
    loadCity(id).catch((error: unknown) => {
      if (error instanceof MissingDataError) return null;
      throw error;
    }),
    loadBoundary(id),
  ]);
  if (!detail) return null;
  // Let the loading state paint before the surface is computed.
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  return buildCityModel(detail, outline);
}

export function CityScreen({ cities, city, page }: CityScreenProps) {
  const state = useAsync(() => loadModel(city.id), [city.id]);
  const switcher = <CitySwitcher cities={cities} currentId={city.id} />;

  if (state.status === 'ready' && state.data) {
    if (page === 'method') return <MethodPage model={state.data} />;
    return <Workspace key={city.id} model={state.data} switcher={switcher} />;
  }
  const message =
    state.status === 'loading'
      ? `Считаем изотермы ${genitive(city.name)}`
      : state.status === 'error'
        ? `Не получилось открыть данные: ${state.message}`
        : `Для ${genitive(city.name)} данных пока нет.`;
  return (
    <main className="workspace is-empty">
      <div className="workspace__map" />
      <aside className="workspace__panel">
        <div className="panel">
          <div className="panel__header">{switcher}</div>
          <p className="panel__status" role="status">
            {message}
          </p>
        </div>
      </aside>
    </main>
  );
}

interface PickedPlace {
  cell: number;
  point: LonLat;
  title: string;
  precision: NamePrecision;
}

function Workspace({ model, switcher }: { model: CityModel; switcher: ReactNode }) {
  const mapRef = useRef<CityMapHandle>(null);
  const [transect, setTransect] = useState<Transect>(model.defaultTransect);
  const [drawing, setDrawing] = useState(false);
  const [mode, setMode] = useState<MapMode>('temperature');
  const [picked, setPicked] = useState<PickedPlace | null>(null);
  const [probe, setProbe] = useState<Sample | null>(null);
  const [report, setReport] = useState<string | null | undefined>(undefined);
  const { detail } = model;

  const profile = useMemo(() => sampleTransect(model.source, transect), [model, transect]);
  const place = useMemo(() => (picked ? cellProfile(detail, picked.cell) : null), [detail, picked]);
  const content = useMemo(() => panelContent(model, place, picked?.title ?? ''), [model, place, picked]);

  const pick = useCallback(
    (point: LonLat) => {
      const cell = model.source.cellAt(point);
      if (cell < 0 || !model.source.inside(point)) return;
      const center: LonLat = [detail.cells.lon[cell] ?? point[0], detail.cells.lat[cell] ?? point[1]];
      const found = mapRef.current?.nameAt(center, districtAt(detail, center)) ?? null;
      setPicked({ cell, point: center, title: found?.name ?? UNNAMED, precision: found?.precision ?? PRECISION.none });
    },
    [model, detail],
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

  const openReport = async () => setReport((await mapRef.current?.snapshot()) ?? null);

  const header = (
    <>
      {switcher}
      <span className="panel__links">
        {picked && (
          <button type="button" className="text-button" onClick={() => setPicked(null)}>
            Весь город
          </button>
        )}
        <button type="button" className="text-button" onClick={openReport}>
          Отчёт
        </button>
      </span>
    </>
  );
  const footer = (
    <p className="panel__sources">
      {sourcesLine(detail)}{' '}
      <a className="text-link" href={routeHref(detail.city.id, 'method')}>
        Как это посчитано
      </a>
    </p>
  );

  return (
    <main className="workspace">
      <div className="workspace__map">
        <CityMap
          ref={mapRef}
          model={model}
          transect={transect}
          onTransectChange={setTransect}
          drawing={drawing}
          onDrawingEnd={() => setDrawing(false)}
          place={picked?.point ?? null}
          onPick={pick}
          probe={probe?.point ?? null}
          mode={mode}
          onIdle={refineName}
        />
      </div>
      <Section
        model={model}
        profile={profile}
        isDefault={transect === model.defaultTransect}
        drawing={drawing}
        mode={mode}
        onDraw={() => setDrawing((on) => !on)}
        onReset={() => setTransect(model.defaultTransect)}
        onModeChange={setMode}
        onProbe={setProbe}
        onPick={(sample) => pick(sample.point)}
      />
      <aside className="workspace__panel" aria-label="Что здесь происходит">
        <Panel model={model} content={content} header={header} footer={footer} />
      </aside>
      {report !== undefined && (
        <Report model={model} content={content} profile={profile} mapImage={report} placeTitle={picked ? picked.title : null} onClose={() => setReport(undefined)} />
      )}
    </main>
  );
}
