import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal, flushSync } from 'react-dom';
import type { CitySummary, Facility } from '../data/contract';
import { hotTenthAnswer, islandAnswer, sectionAnswer, sourcesLine } from '../domain/answers';
import { causeLabel, causeWords } from '../domain/causes';
import type { CityModel } from '../domain/cityModel';
import { cityName, periodText } from '../domain/dataTexts';
import { formats } from '../domain/format';
import { facilitiesNear, facilityTitle, formatPeople, hotPlacesByPeople, peopleFigure, peopleInHeat, peopleNoun, populationCaveat, sparseHeatNote } from '../domain/people';
import { cityEnergy, cityEnergyLine, energyCaveat } from '../domain/energy';
import { recommend } from '../domain/recommendations';
import { distinctByName, hotTenthCauses, hottestPlaces, keyFigures, reportTransect } from '../domain/report';
import { capitalize } from '../domain/phrase';
import { siteTitle } from '../domain/sites';
import type { Transect } from '../domain/transect';
import { overpassLine } from '../domain/weather';
import { MAP_TEXTS } from '../map/map.texts';
import { renderReportMap, type ReportMap } from '../map/snapshot';
import { readTokens } from '../map/tokens';
import { useAsync, useWidth } from '../ui/hooks';
import { CityPhoto } from '../ui/CityPhoto';
import { EnergyBlock, EnergySummary } from '../ui/Energy';
import { CauseIcon, FacilityIcon } from '../ui/icons';
import { useFormats, useLocale, useTexts } from '../ui/locale';
import { cityModel } from '../ui/models';
import { Evidence } from '../ui/panel/Panel';
import { Ramp } from '../ui/panel/Ramp';
import type { PanelContent } from '../ui/panelContent';
import { PatternScopeProvider, directionOf, usePatternFill } from '../ui/patterns';
import { Phrase } from '../ui/Phrase';
import { WeatherCompare } from '../ui/Weather';
import { ProfileChart } from '../ui/ProfileChart';
import { REPORT_TEXTS } from './report.texts';

interface ReportProps {
  model: CityModel;
  cities: CitySummary[];
  /** The section on screen; the report falls back to the default one when it missed the data. */
  transect: Transect;
  /** A picked place, as the panel describes it; null for the whole city. */
  place: PanelContent | null;
  onClose(): void;
}

/** Printable width of an A4 sheet at the report's margins, px: the width before the sheet is measured. */
const SHEET_W = 694;
const PROFILE_H = 210;
const SITE = 'uzha.mydevbox.xyz';
const SITE_URL = `https://${SITE}/`;
/** Hottest places listed, and how many candidates are named to find that many different ones. */
const PLACES = 5;
const CANDIDATES = 10;
/** Schools and clinics this close to a place are "nearby", m; at most this many are listed. */
const NEAR_M = 500;
const NEAR_MAX = 3;
/** Fewer people than this on a 200 m cell is not housing. */
const FEW_PEOPLE = 5;
const RESIDENTS = { en: ['resident', 'residents'], ru: ['житель', 'жителя', 'жителей'] } as const;

const today = (locale: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

function Part({ n, title, children, className = '' }: { n: number; title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rp-part ${className}`.trim()} aria-labelledby={`rp-part-${n}`}>
      <h2 id={`rp-part-${n}`} className="rp-part__title">
        <span className="rp-part__n">{String(n).padStart(2, '0')}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

interface CauseRowData {
  key: string;
  label: string;
  value: number;
  note?: string;
}

/** Causes as hatched bars on one scale: the hatch says which, the icon says what, the number says how much. */
function CauseRows({ rows }: { rows: CauseRowData[] }) {
  const fill = usePatternFill();
  const { formatDegSigned } = useFormats();
  const scale = Math.max(0.5, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul className="rp-causes">
      {rows.map((row) => {
        const direction = directionOf(row.value);
        return (
          <li key={row.key} className="rp-cause">
            <p className="rp-cause__head">
              <CauseIcon cause={row.key} size={20} />
              <span className="rp-cause__label">{row.label}</span>
              <span className={`rp-cause__value num num--${direction === 'heats' ? 'hot' : 'cool'}`}>{formatDegSigned(row.value)}</span>
            </p>
            <svg className="rp-cause__bar" width="100%" height="12" aria-hidden="true">
              <rect className="rp-cause__track" x="0" y="0.5" width="100%" height="11" />
              <rect className="rp-cause__fill" x="0.5" y="0.5" height="11" style={{ width: `${(Math.abs(row.value) / scale) * 100}%`, fill: fill(row.key, direction) }} />
            </svg>
            {row.note && <p className="rp-cause__note">{row.note}</p>}
          </li>
        );
      })}
    </ul>
  );
}

/** Who lives on the cell and which schools and clinics stand near it. */
function PlacePeople({ people, near }: { people?: number; near: Facility[] }) {
  const locale = useLocale();
  const t = REPORT_TEXTS[locale];
  const { formatNumber } = formats(locale);
  return (
    <>
      {people !== undefined && (
        <p className="rp-place__people">{people < FEW_PEOPLE ? t.noHousing : t.lives(formatPeople(people, locale))}</p>
      )}
      {near.length > 0 && (
        <ul className="rp-place__near" aria-label={t.near(NEAR_M)}>
          {near.slice(0, NEAR_MAX).map((f) => (
            <li key={`${f.lon},${f.lat}`}>
              <FacilityIcon type={f.type} size={16} />
              {facilityTitle(f, locale)}
            </li>
          ))}
          {near.length > NEAR_MAX && <li>{t.andMore(formatNumber(near.length - NEAR_MAX, 0))}</li>}
        </ul>
      )}
    </>
  );
}

function Figure({ value, label, hot = false }: { value: string; label: string; hot?: boolean }) {
  return (
    <div className="rp-fig">
      <dt>{label}</dt>
      <dd className={hot ? 'is-hot' : undefined}>{value}</dd>
    </div>
  );
}

/** Every city's model for the comparison; the current one is already here, the others load once and are cached. */
function useCityModels(cities: CitySummary[], current: CityModel): (CityModel | null)[] | null {
  const ids = cities.map((c) => c.id).join(',');
  const state = useAsync(
    () => Promise.all(cities.map((c) => (c.id === current.detail.city.id ? Promise.resolve(current) : cityModel(c.id).catch(() => null)))),
    [ids, current],
  );
  return state.status === 'ready' ? state.data : null;
}

/**
 * True while the browser prints. The section is drawn at the sheet's width then, not the phone's,
 * so its labels keep their size on paper; flushSync gets the new drawing in before the page is laid out.
 */
function usePrinting(): boolean {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const on = () => flushSync(() => setPrinting(true));
    const off = () => setPrinting(false);
    window.addEventListener('beforeprint', on);
    window.addEventListener('afterprint', off);
    return () => {
      window.removeEventListener('beforeprint', on);
      window.removeEventListener('afterprint', off);
    };
  }, []);
  return printing;
}

/** A printable report: the city's answer, its numbers, hottest places, causes, measures, the map and the section, the method. */
export function Report({ model, cities, transect: current, place, onClose }: ReportProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const locale = useLocale();
  const t = useTexts(REPORT_TEXTS);
  const { formatDeg, formatDegSigned, formatKm, formatNumber, formatPercent } = formats(locale);
  const [endA, endB] = MAP_TEXTS[locale].ends;
  const { detail } = model;
  const { stats, features } = detail;
  const name = cityName(detail.city, locale);
  const [sectionRef, screenWidth] = useWidth<HTMLDivElement>(SHEET_W);
  const printing = usePrinting();
  const width = printing ? SHEET_W : screenWidth;

  const { transect, profile } = useMemo(() => reportTransect(model.source, current, model.defaultTransect), [model, current]);
  const places = useMemo(() => hottestPlaces(detail, model.inside, CANDIDATES), [detail, model.inside]);
  const crowded = useMemo(() => hotPlacesByPeople(detail, model.inside, PLACES), [detail, model.inside]);
  const inHeat = peopleInHeat(detail, model.inside);
  const coords = ([lon, lat]: [number, number]) => t.coords(formatNumber(lat, 3), formatNumber(lon, 3));
  const pop = detail.cells.pop;
  const causes = useMemo(() => hotTenthCauses(detail, model.hotspot), [detail, model.hotspot]);
  const energy = useMemo(() => cityEnergy(detail), [detail]);
  const measures = useMemo(
    () => recommend({ features, values: model.hotspot.values, contributions: model.hotspot.contributions, cityMeans: model.cityMeans }, locale).slice(0, 3),
    [features, model, locale],
  );
  const figures = keyFigures(stats);
  const all = useCityModels(cities, model);
  const [map, setMap] = useState<ReportMap | null>(null);

  useEffect(() => {
    let live = true;
    const points = [...places, ...crowded].map((p) => p.point);
    renderReportMap(model, transect, readTokens(), locale, points).then((result) => live && setMap(result));
    return () => {
      live = false;
    };
  }, [model, transect, places, crowded, locale]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('is-reporting');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('is-reporting');
    };
  }, []);

  const wordsOf = (key: string) => causeWords(features.find((f) => f.key === key) ?? { key, label: key, unit: '' }, locale);
  const { island } = model;
  const date = today(t.dateLocale);
  const cells = (count: number) => t.cells(count, formatNumber(count, 0));
  const placeName = (i: number): string | null => {
    const site = map?.sites[i] ?? null;
    return site ? siteTitle(site, locale) : (map?.names[i]?.name ?? null);
  };
  /** The crowded places were named after the hottest ones. */
  const crowdedName = (i: number) => placeName(places.length + i);
  const isoStep = (model.levels.thresholds[1] ?? 0) - (model.levels.thresholds[0] ?? 0);
  let n = 0;

  return createPortal(
    <div className="report" role="dialog" aria-modal="true" aria-label={t.dialog(name)}>
      <PatternScopeProvider scope="report-">
      <div className="report__bar no-print">
        <button type="button" className="pill pill--ink" onClick={() => window.print()}>
          <span className="report__print-long">{t.printLong}</span>
          <span className="report__print-short">{t.printShort}</span>
        </button>
        <button type="button" className="pill" ref={closeRef} onClick={onClose}>
          {t.close}
        </button>
      </div>

      <article className="report__sheet">
        <header className="rp-head">
          <p className="rp-kicker">
            <span>{t.kicker}</span>
            <span>{date}</span>
          </p>
          <h1 className="rp-title">{name}</h1>
          <p className="rp-subtitle">{t.subtitle}</p>
          <p className="rp-meta">
            {t.meta(periodText(detail.period.label, locale), detail.grid.cellSizeM)}
            {SITE}
          </p>
          <CityPhoto city={detail.city} className="rp-photo" eager />
        </header>

        <Part n={++n} title={t.parts.main}>
          {island && (
            <div className="rp-island">
              <p className={`rp-island__value ${island.intensity >= 0 ? 'is-hot' : 'is-cool'}`}>{formatDegSigned(island.intensity)}</p>
              <p className="rp-island__text">
                <Phrase spans={islandAnswer(name, island, locale)} />
                {t.island(cells(island.insideCount), formatDeg(island.inside), cells(island.outsideCount), formatDeg(island.outside))}
              </p>
            </div>
          )}
          <p className="rp-lead">
            <Phrase spans={hotTenthAnswer(detail, model.facts, locale)} />
          </p>
          {inHeat && (
            <p className="rp-people">
              <span className="rp-people__value">{formatPeople(inHeat.people, locale)}</span>
              {t.peopleInHeat(formatPercent(inHeat.people / (inHeat.total || 1)), sparseHeatNote(inHeat, locale) ?? '')}
            </p>
          )}
        </Part>

        <Part n={++n} title={t.parts.figures}>
          <dl className="rp-figs">
            <Figure label={t.figures.mean} value={formatDeg(figures.mean)} />
            <Figure label={t.figures.hot} value={formatDeg(figures.hot)} hot />
            <Figure label={t.figures.cool} value={formatDeg(figures.cool)} />
            <Figure label={t.figures.spread} value={formatDeg(figures.spread)} />
          </dl>
          <div className="rp-ramp">
            <Ramp levels={model.levels} shares={model.shares} min={stats.lstMin} max={stats.lstMax} value={stats.lstMean} meanMark={null} />
            <p className="rp-note">
              {t.scale(formatDeg(stats.lstMin, 0), formatDeg(stats.lstMax, 0))}
            </p>
          </div>
        </Part>

        {place && (
          <Part n={++n} title={t.parts.place(place.title)}>
            <p className="rp-lead">
              <Phrase spans={place.answer} />
            </p>
            <p className="rp-place-figure">
              <span>{formatDeg(place.figure)}</span> {place.figureCaption}
            </p>
            {place.cause && (
              <CauseRows
                rows={[
                  { key: place.cause.key, label: place.cause.label, value: place.cause.value, note: place.cause.note },
                  ...(place.rest?.rows ?? []).map((r) => ({ ...r, label: capitalize(r.label) })),
                ]}
              />
            )}
            {place.energy && <EnergyBlock view={place.energy.view} title={place.energy.title} />}
          </Part>
        )}

        <Part n={++n} title={t.parts.hottest}>
          <p className="rp-note rp-note--lead">
            {t.hottestLead(detail.grid.cellSizeM)}
          </p>
          <ol className="rp-places">
            {distinctByName(places, (_, i) => placeName(i), PLACES).map(({ item: p, index: i }, rank) => {
              const title = placeName(i) ?? (map ? t.unnamed : '…');
              const words = p.cause ? wordsOf(p.cause.key) : null;
              return (
                <li key={p.cell} className="rp-place">
                  <span className="rp-place__rank">{rank + 1}</span>
                  <div className="rp-place__body">
                    <p className="rp-place__name">{title}</p>
                    {p.cause && words && (
                      <p className="rp-place__cause">
                        <CauseIcon cause={p.cause.key} size={18} />
                        {causeLabel(words, p.cause.value)}, {formatDegSigned(p.cause.value)}
                      </p>
                    )}
                    <PlacePeople people={pop?.[p.cell]} near={facilitiesNear(detail.facilities, p.point, NEAR_M)} />
                    <p className="rp-place__where">{coords(p.point)}</p>
                  </div>
                  <p className="rp-place__t">
                    <span>{formatDeg(p.lst)}</span>
                    <small>
                      {formatDegSigned(p.lst - stats.lstMean)} {t.vsMean}
                    </small>
                  </p>
                </li>
              );
            })}
          </ol>
        </Part>

        {inHeat && crowded.length > 0 && (
          <Part n={++n} title={t.parts.crowded}>
            <p className="rp-note rp-note--lead">
              {t.crowdedLead(NEAR_M)}
            </p>
            <ol className="rp-places">
              {crowded.map((p, i) => (
                <li key={p.cell} className="rp-place">
                  <span className="rp-place__rank">{i + 1}</span>
                  <div className="rp-place__body">
                    <p className="rp-place__name">{crowdedName(i) ?? (map ? t.unnamed : '…')}</p>
                    <PlacePeople near={facilitiesNear(detail.facilities, p.point, NEAR_M)} />
                    <p className="rp-place__where">{coords(p.point)}</p>
                  </div>
                  <p className="rp-place__t rp-place__t--people">
                    <span>~{peopleFigure(p.people, locale)}</span>
                    <small>
                      {peopleNoun(p.people, RESIDENTS, locale)} · {formatDeg(p.lst)}
                    </small>
                  </p>
                </li>
              ))}
            </ol>
            {detail.population && <p className="rp-note">{populationCaveat(detail.population.year, locale)}</p>}
          </Part>
        )}

        <Part n={++n} title={t.parts.causes}>
          <p className="rp-note rp-note--lead">
            {t.causesLead(model.hotspot.cellCount, formatNumber(model.hotspot.cellCount, 0), formatDeg(stats.lstP90), formatDeg(model.hotspot.lst))}
          </p>
          <CauseRows
            rows={causes.map((c) => ({
              key: c.key,
              label: capitalize(c.value >= 0 ? wordsOf(c.key).heats : wordsOf(c.key).cools),
              value: c.value,
              note: `${wordsOf(c.key).measure(model.hotspot.values[c.key] ?? Number.NaN)}${c.leads >= 0.005 ? t.leads(formatPercent(c.leads)) : ''}`,
            }))}
          />
        </Part>

        {energy && detail.energy && (
          <Part n={++n} title={t.parts.physics}>
            <p className="rp-lead rp-lead--small">{cityEnergyLine(name, energy, locale)}</p>
            <EnergySummary summary={energy} />
            <p className="rp-note">
              {t.physicsNote(energyCaveat(detail.energy, locale))}
            </p>
          </Part>
        )}

        {measures.length > 0 && (
          <Part n={++n} title={t.parts.measures}>
            <p className="rp-note rp-note--lead">
              {t.measuresLead(name)}
            </p>
            <ol className="rp-measures">
              {measures.map((m, i) => (
                <li key={m.id} className="rp-measure">
                  <p className="rp-measure__head">
                    <span className="rp-measure__n">{i + 1}</span>
                    <span className="rp-measure__title">{m.title}</span>
                    <span className="rp-measure__heat num num--hot">{formatDegSigned(m.heating)}</span>
                  </p>
                  <ul className="rp-measure__why">
                    {m.reasons.map((r) => (
                      <li key={r.key}>
                        <CauseIcon cause={r.key} size={18} />
                        <span>
                          {capitalize(r.text)}
                          {t.byModel}
                          <span className="num num--hot">{formatDegSigned(r.contribution)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <ul className="rp-measure__todo">
                    {m.actions.map((a) => (
                      <li key={a}>{capitalize(a)}</li>
                    ))}
                  </ul>
                  <Evidence evidence={m.evidence} />
                </li>
              ))}
            </ol>
          </Part>
        )}

        <Part n={++n} title={t.parts.map} className="rp-part--map">
          <figure className="rp-map">
            {map?.image ? (
              <img src={map.image} alt={t.mapAlt(name, endA, endB)} />
            ) : (
              <p className="rp-note">{map ? t.mapFailed : t.mapDrawing}</p>
            )}
            <figcaption className="rp-note">
              {t.mapCaption(formatNumber(isoStep, 0), endA, endB, formatKm(profile.length))}
            </figcaption>
          </figure>
          <div className="rp-section" ref={sectionRef}>
            <p className="rp-lead rp-lead--small">
              <Phrase spans={sectionAnswer(profile, stats.lstMean, features, locale)} />
            </p>
            <ProfileChart profile={profile} levels={model.levels} cityMean={stats.lstMean} features={features} width={width} height={PROFILE_H} />
            <p className="rp-note">{t.sectionNote}</p>
          </div>
        </Part>

        {cities.length > 1 && (
          <Part n={++n} title={t.parts.cities}>
            <table className="rp-table">
              <thead>
                <tr>
                  <th scope="col">{t.table.city}</th>
                  <th scope="col">{t.table.island}</th>
                  <th scope="col">{t.table.mean}</th>
                  <th scope="col">{t.table.hot}</th>
                  <th scope="col">R²</th>
                </tr>
              </thead>
              <tbody>
                {cities.map((city, i) => {
                  const m = all?.[i] ?? null;
                  const isl = m?.island ?? null;
                  return (
                    <tr key={city.id} className={city.id === detail.city.id ? 'is-current' : undefined}>
                      <th scope="row">{cityName(city, locale)}</th>
                      <td className={`num ${isl && isl.intensity < 0 ? 'num--cool' : 'num--hot'}`}>{isl ? formatDegSigned(isl.intensity) : '…'}</td>
                      <td className="num">{formatDeg(m?.detail.stats.lstMean ?? city.lstMean)}</td>
                      <td className="num">{m ? t.table.from(formatDeg(m.detail.stats.lstP90)) : '…'}</td>
                      <td className="num">{formatNumber(m?.detail.model.r2Cv ?? city.r2, 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="rp-note">
              {t.tableNote}
            </p>
            {detail.city.weather && (
              <div className="rp-weather">
                <h3 className="rp-sub">{t.weather}</h3>
                <WeatherCompare cities={cities} currentId={detail.city.id} className="rp-table rp-table--wx" />
                {overpassLine(detail.city.weather, locale) && (
                  <p className="rp-note">
                    {name}. {overpassLine(detail.city.weather, locale)}
                  </p>
                )}
              </div>
            )}
          </Part>
        )}

        <Part n={++n} title={t.parts.method}>
          <p className="rp-text">
            {t.method(name, formatNumber(detail.grid.count, 0), detail.grid.cellSizeM, detail.period.lstScenes, detail.model.type, features.length)}
          </p>
          <ul className="rp-limits">
            {t.limits.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
            {detail.population && <li>{t.popLimit(populationCaveat(detail.population.year, locale))}</li>}
          </ul>
          <p className="rp-sources">
            {sourcesLine(detail, locale)}
            {t.basemap}
          </p>
        </Part>

        <footer className="rp-foot">
          <span>
            UzHa · {name} · {date}
          </span>
          <a href={SITE_URL}>{SITE}</a>
        </footer>
      </article>
      </PatternScopeProvider>
    </div>,
    document.body,
  );
}
