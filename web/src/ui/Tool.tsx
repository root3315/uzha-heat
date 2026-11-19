import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CitySummary } from '../data/contract';
import { sourcesLine } from '../domain/answers';
import type { CityModel } from '../domain/cityModel';
import { cityName } from '../domain/dataTexts';
import { cellsToCsv, cellsToGeoJson } from '../domain/exportCells';
import { refinePlace, type PickedPlace } from '../domain/pickedPlace';
import { PRECISION } from '../domain/placeName';
import { cellProfile, districtAt } from '../domain/places';
import { sampleTransect, type LonLat, type Sample, type Transect } from '../domain/transect';
import { CityMap, type CityMapHandle, type MapMark, type MapMode } from '../map/CityMap';
import { Report } from '../report/Report';
import { CitySwitcher } from './CitySwitcher';
import { downloadText } from './download';
import { prefersReducedMotion, useViewport } from './hooks';
import { readSharedView, sharedViewQuery } from '../domain/shareLink';
import { Link } from './Link';
import { useLocale } from './locale';
import { MapHint } from './MapHint';
import { Panel } from './panel/Panel';
import { WeatherSummary } from './Weather';
import { panelContent } from './panelContent';
import { useReadout } from './readout';
import { methodHref } from './routing';
import { CauseKey, PeopleKey, Section } from './Section';
import { TOOL_TEXTS } from './ui.texts';

interface ToolProps {
  model: CityModel;
  cities: CitySummary[];
  onCity(id: string): void;
}

const VIEW = { isolines: true, transect: true, interactive: true };
/** Below this width the panel and the section go under the map, and the controls move onto it. */
const NARROW_PX = 860;

const isTouch = () => window.matchMedia('(pointer: coarse)').matches;

/** How long "Copied" stays on the button. */
const SHARED_NOTE_MS = 2200;

/** The working map: isotherms, a draggable section, the panel with one answer for the city or a place. */
export function Tool({ model, cities, onCity }: ToolProps) {
  const mapRef = useRef<CityMapHandle>(null);
  const mapFrameRef = useRef<HTMLDivElement>(null);
  const reportButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const locale = useLocale();
  const t = TOOL_TEXTS[locale];
  const [transect, setTransect] = useState<Transect>(model.defaultTransect);
  const [drawing, setDrawing] = useState(false);
  const [mode, setMode] = useState<MapMode>('temperature');
  const [people, setPeople] = useState(false);
  // 3D lives in the address: a reload, a shared link or the language switch keeps it; another city opens framed and flat,
  // since a 3D camera kept from the last city would land on a close-up of the new one.
  const [threeD, setThreeD] = useState(() => readSharedView(window.location.search).threeD);
  const [picked, setPicked] = useState<PickedPlace | null>(null);
  // The planting places stay on the map while the reader opens them one by one from the list.
  const [planMarks, setPlanMarks] = useState<MapMark[] | null>(null);
  // On a wide screen the list starts open, so the answer is on the map at once; a reader who closes it keeps it closed.
  const [planClosed, setPlanClosed] = useState(false);
  const showPlan = useCallback((marks: MapMark[] | null) => {
    setPlanMarks(marks);
    if (marks === null) setPlanClosed(true);
  }, []);
  const [probe, setProbe] = useState<Sample | null>(null);
  const [reporting, setReporting] = useState(false);
  const { width } = useViewport();
  const narrow = width < NARROW_PX;
  const { detail } = model;
  const { cellUnder, describe } = useReadout(model);
  const hasPeople = detail.cells.pop !== undefined;

  const profile = useMemo(() => sampleTransect(model.source, transect), [model, transect]);
  const place = useMemo(() => (picked ? cellProfile(detail, picked.cell) : null), [detail, picked]);
  const content = useMemo(() => panelContent(model, place, picked?.title ?? '', picked?.site ?? null, locale), [model, place, picked, locale]);
  const padding = useMemo(() => (narrow ? { top: 64, right: 24, bottom: 24, left: 24 } : { top: 32, right: 40, bottom: 32, left: 32 }), [narrow]);

  const pick = useCallback(
    (point: LonLat) => {
      const cell = cellUnder(point);
      if (cell < 0) return;
      const center: LonLat = [detail.cells.lon[cell] ?? point[0], detail.cells.lat[cell] ?? point[1]];
      const found = mapRef.current?.nameAt(center, districtAt(detail, center)) ?? null;
      const site = mapRef.current?.siteAt(point) ?? null;
      setPicked({ cell, point: center, at: point, title: found?.name ?? t.unnamed, precision: found?.precision ?? PRECISION.none, site, siteSettled: false });
    },
    [cellUnder, detail, t.unnamed],
  );

  // A shared link opens on its place, once.
  useEffect(() => {
    const { place } = readSharedView(window.location.search);
    if (place) pick(place);
  }, []);

  // The address always says what is on screen, so copying it from the bar shares this exact view.
  useEffect(() => {
    const query = sharedViewQuery({ place: picked?.point ?? null, threeD, locale });
    const url = `${window.location.pathname}${query}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, '', url);
  }, [picked?.point, threeD, locale]);

  const [shared, setShared] = useState(false);
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: document.title, url });
      else {
        await navigator.clipboard.writeText(url);
        setShared(true);
        window.setTimeout(() => setShared(false), SHARED_NOTE_MS);
      }
    } catch {
      /* the reader closed the share sheet, or the clipboard is not allowed: nothing to undo */
    }
  };

  // A new place starts at its own title: the panel may still be scrolled down to the previous place's sliders.
  useEffect(() => {
    if (picked) panelRef.current?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [picked?.cell]);

  /** After zooming in, the basemap may know a closer name, or a site it had not drawn yet at the first look. */
  const refineName = useCallback(() => {
    setPicked((current) =>
      current
        ? refinePlace(current, {
            name: () => mapRef.current?.nameAt(current.point, districtAt(detail, current.point)) ?? null,
            site: () => mapRef.current?.siteAt(current.at) ?? null,
          })
        : current,
    );
  }, [detail]);

  useEffect(() => {
    // With the report open, Escape is the report's: it closes the report and leaves the place picked.
    if (reporting) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setDrawing(false);
      setPicked(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reporting]);

  const toggleDrawing = () => {
    const next = !drawing;
    setDrawing(next);
    // On a phone the button may sit below the map: bring the map back before the finger looks for it.
    if (next && narrow) mapFrameRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  };
  const toggleMode = () => setMode((current) => (current === 'causes' ? 'temperature' : 'causes'));

  const exportAs = (format: 'csv' | 'geojson') => {
    const name = `uzha-${detail.city.id}-cells`;
    if (format === 'csv') downloadText(`${name}.csv`, cellsToCsv(detail, model.inside), 'text/csv;charset=utf-8');
    else downloadText(`${name}.geojson`, cellsToGeoJson(detail, model.inside), 'application/geo+json');
  };

  const switcher = <CitySwitcher cities={cities} currentId={detail.city.id} onChange={onCity} />;
  // On a phone it sits in the chip row on the map, elsewhere as a third cell under the zoom buttons.
  const threeDButton = (
    <button
      type="button"
      className={narrow ? 'pill pill--small' : 'map-3d'}
      aria-pressed={threeD}
      aria-label={threeD ? t.flat : t.threeD}
      title={threeD ? t.flatShort : t.threeDShort}
      onClick={() => setThreeD(!threeD)}
    >
      3D
    </button>
  );
  // Back to the button that opened it, so a keyboard reader is not left at the top of the page.
  const closeReport = () => {
    setReporting(false);
    requestAnimationFrame(() => reportButtonRef.current?.focus());
  };
  // Both labels share one grid cell, so the button keeps its width and the header does not reflow when it flips.
  const shareButton = (
    <button type="button" className="pill pill--small pill--swap" onClick={() => void share()} aria-live="polite">
      <span className={shared ? 'pill__label pill__label--off' : 'pill__label'}>{t.share}</span>
      <span className={shared ? 'pill__label' : 'pill__label pill__label--off'}>{t.copied}</span>
    </button>
  );
  const reportButton = (
    <button ref={reportButtonRef} type="button" className="pill pill--small" onClick={() => setReporting(true)}>
      {t.report}
    </button>
  );
  const header = (
    <>
      {!narrow && switcher}
      <span className="panel__links">
        {picked && (
          <button type="button" className="pill pill--small" onClick={() => setPicked(null)}>
            {t.wholeCity}
          </button>
        )}
        {!narrow && shareButton}
        {!narrow && reportButton}
      </span>
    </>
  );
  const footer = (
    <div className="panel__foot">
      {!picked && detail.city.weather && <WeatherSummary weather={detail.city.weather} />}
      <p className="panel__export">
        <span>{t.exportAll(cityName(detail.city, locale))}</span>
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
        {sourcesLine(detail, locale)}{' '}
        <Link className="text-link" href={methodHref(detail.city.id)}>
          {t.howCalculated}
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
          people={people}
          threeD={threeD}
          marks={planMarks ?? undefined}
          describe={describe}
          onIdle={refineName}
        >
          {narrow && (
            <div className="map-bar" role="toolbar" aria-label={t.mapToolbar}>
              {switcher}
              <button type="button" className="pill pill--small" aria-pressed={drawing} onClick={toggleDrawing}>
                {drawing ? t.drawing : t.section}
              </button>
              <button type="button" className="pill pill--small" aria-pressed={mode === 'causes'} onClick={toggleMode}>
                {t.causes}
              </button>
              {hasPeople && (
                <button type="button" className="pill pill--small" aria-pressed={people} onClick={() => setPeople(!people)}>
                  {t.people}
                </button>
              )}
              {threeDButton}
              {shareButton}
              {reportButton}
            </div>
          )}
          {!narrow && threeDButton}
          {/* On a wide screen the keys sit on the map, next to what they explain, and the map never changes size. */}
          {!narrow && (mode === 'causes' || people) && (
            <div className="map-legend">
              {mode === 'causes' && <CauseKey model={model} />}
              {people && <PeopleKey model={model} />}
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
          people={hasPeople ? people : undefined}
          onPeopleChange={setPeople}
          onProbe={setProbe}
          keys={narrow}
          onPick={(sample) => pick(sample.point)}
        />
      </div>
      <aside ref={panelRef} className="tool__panel" aria-label={t.panel}>
        <Panel model={model} content={content} header={header} footer={footer} onPick={pick} onPlan={showPlan} planOpen={planMarks !== null || (!narrow && !planClosed)} />
      </aside>
      {reporting && <Report model={model} cities={cities} transect={transect} place={picked ? content : null} onClose={closeReport} />}
    </main>
  );
}
