import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal, flushSync } from 'react-dom';
import type { CitySummary, Facility } from '../data/contract';
import { capitalize, genitive, hotTenthAnswer, islandAnswer, sectionAnswer, sourcesLine } from '../domain/answers';
import { causeLabel, causeWords } from '../domain/causes';
import type { CityModel } from '../domain/cityModel';
import { formatDeg, formatDegSigned, formatKm, formatNumber, formatPercent, plural } from '../domain/format';
import { facilitiesNear, facilityTitle, formatPeople, hotPlacesByPeople, peopleFigure, peopleInHeat, peopleNoun, populationCaveat } from '../domain/people';
import { recommend } from '../domain/recommendations';
import { distinctByName, hotTenthCauses, hottestPlaces, keyFigures, reportTransect } from '../domain/report';
import { siteTitle } from '../domain/sites';
import type { Transect } from '../domain/transect';
import { renderReportMap, type ReportMap } from '../map/snapshot';
import { readTokens } from '../map/tokens';
import { useAsync, useWidth } from '../ui/hooks';
import { CityPhoto } from '../ui/CityPhoto';
import { CauseIcon, FacilityIcon } from '../ui/icons';
import { cityModel } from '../ui/models';
import { Evidence } from '../ui/panel/Panel';
import { Ramp } from '../ui/panel/Ramp';
import type { PanelContent } from '../ui/panelContent';
import { PatternScopeProvider, directionOf, usePatternFill } from '../ui/patterns';
import { Phrase } from '../ui/Phrase';
import { ProfileChart } from '../ui/ProfileChart';

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
const UNNAMED = 'Участок без названия';
/** Hottest places listed, and how many candidates are named to find that many different ones. */
const PLACES = 5;
const CANDIDATES = 10;
/** Schools and clinics this close to a place are "nearby", m; at most this many are listed. */
const NEAR_M = 500;
const NEAR_MAX = 3;
/** Fewer people than this on a 200 m cell is not housing. */
const FEW_PEOPLE = 5;

const today = () => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
const coords = ([lon, lat]: [number, number]) => `${formatNumber(lat, 3)}° с.ш., ${formatNumber(lon, 3)}° в.д.`;

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
  return (
    <>
      {people !== undefined && (
        <p className="rp-place__people">{people < FEW_PEOPLE ? 'жилья на участке почти нет' : `живёт ~${formatPeople(people)}`}</p>
      )}
      {near.length > 0 && (
        <ul className="rp-place__near" aria-label={`Рядом, до ${NEAR_M} м`}>
          {near.slice(0, NEAR_MAX).map((f) => (
            <li key={`${f.lon},${f.lat}`}>
              <FacilityIcon type={f.type} size={16} />
              {facilityTitle(f)}
            </li>
          ))}
          {near.length > NEAR_MAX && <li>и ещё {formatNumber(near.length - NEAR_MAX, 0)}</li>}
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
  const { detail } = model;
  const { stats, features } = detail;
  const [sectionRef, screenWidth] = useWidth<HTMLDivElement>(SHEET_W);
  const printing = usePrinting();
  const width = printing ? SHEET_W : screenWidth;

  const { transect, profile } = useMemo(() => reportTransect(model.source, current, model.defaultTransect), [model, current]);
  const places = useMemo(() => hottestPlaces(detail, model.inside, CANDIDATES), [detail, model.inside]);
  const crowded = useMemo(() => hotPlacesByPeople(detail, PLACES), [detail]);
  const inHeat = peopleInHeat(detail);
  const pop = detail.cells.pop;
  const causes = useMemo(() => hotTenthCauses(detail, model.hotspot), [detail, model.hotspot]);
  const measures = useMemo(
    () => recommend({ features, values: model.hotspot.values, contributions: model.hotspot.contributions, cityMeans: model.cityMeans }).slice(0, 3),
    [features, model],
  );
  const figures = keyFigures(stats);
  const all = useCityModels(cities, model);
  const [map, setMap] = useState<ReportMap | null>(null);

  useEffect(() => {
    let live = true;
    const points = [...places, ...crowded].map((p) => p.point);
    renderReportMap(model, transect, readTokens(), points).then((result) => live && setMap(result));
    return () => {
      live = false;
    };
  }, [model, transect, places, crowded]);

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

  const wordsOf = (key: string) => causeWords(features.find((f) => f.key === key) ?? { key, label: key, unit: '' });
  const { island } = model;
  const date = today();
  const cells = (count: number) => `${formatNumber(count, 0)} ${plural(count, ['участка', 'участков', 'участков'])}`;
  const placeName = (i: number): string | null => {
    const site = map?.sites[i] ?? null;
    return site ? siteTitle(site) : (map?.names[i]?.name ?? null);
  };
  /** The crowded places were named after the hottest ones. */
  const crowdedName = (i: number) => placeName(places.length + i);
  const isoStep = (model.levels.thresholds[1] ?? 0) - (model.levels.thresholds[0] ?? 0);
  let n = 0;

  return createPortal(
    <div className="report" role="dialog" aria-modal="true" aria-label={`Отчёт: ${detail.city.name}`}>
      <PatternScopeProvider scope="report-">
      <div className="report__bar no-print">
        <button type="button" className="pill pill--ink" onClick={() => window.print()}>
          <span className="report__print-long">Распечатать или сохранить в PDF</span>
          <span className="report__print-short">Сохранить PDF</span>
        </button>
        <button type="button" className="pill" ref={closeRef} onClick={onClose}>
          Закрыть
        </button>
      </div>

      <article className="report__sheet">
        <header className="rp-head">
          <p className="rp-kicker">
            <span>UzHa · отчёт</span>
            <span>{date}</span>
          </p>
          <h1 className="rp-title">{detail.city.name}</h1>
          <p className="rp-subtitle">Где поверхность перегревается летом и&nbsp;почему</p>
          <p className="rp-meta">
            Снимки Landsat, {detail.period.label} · участки {detail.grid.cellSizeM}&nbsp;×&nbsp;{detail.grid.cellSizeM}&nbsp;м · {SITE}
          </p>
          <CityPhoto city={detail.city} className="rp-photo" eager />
        </header>

        <Part n={++n} title="Главное">
          {island && (
            <div className="rp-island">
              <p className={`rp-island__value ${island.intensity >= 0 ? 'is-hot' : 'is-cool'}`}>{formatDegSigned(island.intensity)}</p>
              <p className="rp-island__text">
                <Phrase spans={islandAnswer(detail.city.name, island)} /> Это остров тепла: медиана температуры поверхности {cells(island.insideCount)} внутри черты
                города, {formatDeg(island.inside)}, минус медиана {cells(island.outsideCount)} в&nbsp;кольце вокруг, {formatDeg(island.outside)}.
              </p>
            </div>
          )}
          <p className="rp-lead">
            <Phrase spans={hotTenthAnswer(detail, model.facts)} />
          </p>
          {inHeat && (
            <p className="rp-people">
              <span className="rp-people__value">{formatPeople(inHeat.people)}</span> живут на&nbsp;самых горячих участках, это{' '}
              {formatPercent(inHeat.people / (inHeat.total || 1))} жителей карты.
            </p>
          )}
        </Part>

        <Part n={++n} title="Ключевые цифры">
          <dl className="rp-figs">
            <Figure label="в среднем по городу" value={formatDeg(figures.mean)} />
            <Figure label="горячая десятая часть, от" value={formatDeg(figures.hot)} hot />
            <Figure label="прохладная десятая часть, до" value={formatDeg(figures.cool)} />
            <Figure label="разброс между ними" value={formatDeg(figures.spread)} />
          </dl>
          <div className="rp-ramp">
            <Ramp levels={model.levels} shares={model.shares} min={stats.lstMin} max={stats.lstMax} value={stats.lstMean} meanMark={null} />
            <p className="rp-note">
              Шкала: доля площади города в&nbsp;каждом классе температуры, от&nbsp;{formatDeg(stats.lstMin, 0)} до&nbsp;{formatDeg(stats.lstMax, 0)}, отмечено среднее.
              Это температура поверхности, а&nbsp;не&nbsp;воздуха.
            </p>
          </div>
        </Part>

        {place && (
          <Part n={++n} title={`Выбранное место: ${place.title}`}>
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
          </Part>
        )}

        <Part n={++n} title="Самые горячие места">
          <p className="rp-note rp-note--lead">
            Пять самых горячих участков {detail.grid.cellSizeM}&nbsp;м внутри черты города, не&nbsp;ближе 1,5&nbsp;км друг к&nbsp;другу. Причина: фактор, который по&nbsp;модели
            греет участок сильнее всего.
          </p>
          <ol className="rp-places">
            {distinctByName(places, (_, i) => placeName(i), PLACES).map(({ item: p, index: i }, rank) => {
              const name = placeName(i) ?? (map ? UNNAMED : '…');
              const words = p.cause ? wordsOf(p.cause.key) : null;
              return (
                <li key={p.cell} className="rp-place">
                  <span className="rp-place__rank">{rank + 1}</span>
                  <div className="rp-place__body">
                    <p className="rp-place__name">{name}</p>
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
                    <small>{formatDegSigned(p.lst - stats.lstMean)} к&nbsp;среднему</small>
                  </p>
                </li>
              );
            })}
          </ol>
        </Part>

        {inHeat && crowded.length > 0 && (
          <Part n={++n} title="Где в жаре живёт больше всего людей">
            <p className="rp-note rp-note--lead">
              Участки горячей десятой части, где живёт больше всего людей, не&nbsp;ближе 1&nbsp;км друг к&nbsp;другу. Рядом: школы, детские сады и&nbsp;поликлиники
              до&nbsp;{NEAR_M}&nbsp;м по&nbsp;OpenStreetMap.
            </p>
            <ol className="rp-places">
              {crowded.map((p, i) => (
                <li key={p.cell} className="rp-place">
                  <span className="rp-place__rank">{i + 1}</span>
                  <div className="rp-place__body">
                    <p className="rp-place__name">{crowdedName(i) ?? (map ? UNNAMED : '…')}</p>
                    <PlacePeople near={facilitiesNear(detail.facilities, p.point, NEAR_M)} />
                    <p className="rp-place__where">{coords(p.point)}</p>
                  </div>
                  <p className="rp-place__t rp-place__t--people">
                    <span>~{peopleFigure(p.people)}</span>
                    <small>
                      {peopleNoun(p.people, ['житель', 'жителя', 'жителей'])} · {formatDeg(p.lst)}
                    </small>
                  </p>
                </li>
              ))}
            </ol>
            {detail.population && <p className="rp-note">{populationCaveat(detail.population.year)}</p>}
          </Part>
        )}

        <Part n={++n} title="Что греет горячую десятую часть">
          <p className="rp-note rp-note--lead">
            {formatNumber(model.hotspot.cellCount, 0)} {plural(model.hotspot.cellCount, ['участок', 'участка', 'участков'])} горячее {formatDeg(stats.lstP90)}, в&nbsp;среднем{' '}
            {formatDeg(model.hotspot.lst)}. Полоса: сколько градусов фактор добавляет там в&nbsp;среднем по&nbsp;модели; под ней: значение фактора и&nbsp;в&nbsp;какой доле
            участков он главный.
          </p>
          <CauseRows
            rows={causes.map((c) => ({
              key: c.key,
              label: capitalize(c.value >= 0 ? wordsOf(c.key).heats : wordsOf(c.key).cools),
              value: c.value,
              note: `${wordsOf(c.key).measure(model.hotspot.values[c.key] ?? Number.NaN)}${c.leads >= 0.005 ? ` · главный в ${formatPercent(c.leads)}` : ''}`,
            }))}
          />
        </Part>

        {measures.length > 0 && (
          <Part n={++n} title="Что делать">
            <p className="rp-note rp-note--lead">
              Меры для горячей десятой части {genitive(detail.city.name)}, по&nbsp;тому, что её греет. Сколько снимет мера, известно из&nbsp;обзоров по&nbsp;другим
              городам, ссылка у&nbsp;каждой.
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
                          {capitalize(r.text)}; по&nbsp;модели это <span className="num num--hot">{formatDegSigned(r.contribution)}</span>
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

        <Part n={++n} title="Карта и разрез" className="rp-part--map">
          <figure className="rp-map">
            {map?.image ? (
              <img src={map.image} alt={`Изотермы поверхности: ${detail.city.name}, линия разреза от А до Б`} />
            ) : (
              <p className="rp-note">{map ? 'Карта не нарисовалась, разрез ниже.' : 'Рисую карту…'}</p>
            )}
            <figcaption className="rp-note">
              Изотермы поверхности через {formatNumber(isoStep, 0)}°, цвет: класс температуры. Линия А–Б: разрез длиной {formatKm(profile.length)}.
            </figcaption>
          </figure>
          <div className="rp-section" ref={sectionRef}>
            <p className="rp-lead rp-lead--small">
              <Phrase spans={sectionAnswer(profile, stats.lstMean, features)} />
            </p>
            <ProfileChart profile={profile} levels={model.levels} cityMean={stats.lstMean} features={features} width={width} height={PROFILE_H} />
            <p className="rp-note">Полоса под кривой: что сильнее всего меняет температуру на&nbsp;каждом отрезке.</p>
          </div>
        </Part>

        {cities.length > 1 && (
          <Part n={++n} title="Города рядом">
            <table className="rp-table">
              <thead>
                <tr>
                  <th scope="col">Город</th>
                  <th scope="col">Остров тепла</th>
                  <th scope="col">Среднее</th>
                  <th scope="col">Горячая 1/10</th>
                  <th scope="col">R²</th>
                </tr>
              </thead>
              <tbody>
                {cities.map((city, i) => {
                  const m = all?.[i] ?? null;
                  const isl = m?.island ?? null;
                  return (
                    <tr key={city.id} className={city.id === detail.city.id ? 'is-current' : undefined}>
                      <th scope="row">{city.name}</th>
                      <td className={`num ${isl && isl.intensity < 0 ? 'num--cool' : 'num--hot'}`}>{isl ? formatDegSigned(isl.intensity) : '…'}</td>
                      <td className="num">{formatDeg(m?.detail.stats.lstMean ?? city.lstMean)}</td>
                      <td className="num">{m ? `от ${formatDeg(m.detail.stats.lstP90)}` : '…'}</td>
                      <td className="num">{formatNumber(m?.detail.model.r2Cv ?? city.r2, 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="rp-note">
              Остров тепла: поверхность в&nbsp;черте города против кольца вокруг. R²: какую долю разницы температур модель объясняет на&nbsp;кусках города, которых
              не&nbsp;видела.
            </p>
          </Part>
        )}

        <Part n={++n} title="Как посчитано и чего карта не знает">
          <p className="rp-text">
            {detail.city.name} разбит на&nbsp;{formatNumber(detail.grid.count, 0)} участков {detail.grid.cellSizeM}&nbsp;×&nbsp;{detail.grid.cellSizeM}&nbsp;м. Температура
            поверхности: медиана {detail.period.lstScenes} {plural(detail.period.lstScenes, ['снимка', 'снимков', 'снимков'])} Landsat 8/9 без облаков. Модель{' '}
            {detail.model.type} предсказывает её по&nbsp;{features.length} факторам, вклад каждого в&nbsp;градусах считает SHAP.
          </p>
          <ul className="rp-limits">
            <li>Это температура поверхности, а&nbsp;не&nbsp;воздуха. Днём она выше и&nbsp;меняется резче.</li>
            <li>Landsat снимает около 11 утра. Вечерний и&nbsp;ночной перегрев здесь не&nbsp;виден.</li>
            <li>Вклад фактора показывает связь в&nbsp;данных, а&nbsp;не&nbsp;эксперимент. Где мало зелени, там обычно плотнее застройка.</li>
            <li>Эффект мер взят из&nbsp;обзоров по&nbsp;другим городам: это ориентир, а&nbsp;не&nbsp;прогноз для участка.</li>
            {detail.population && <li>{populationCaveat(detail.population.year)} Она показывает, где люди живут, а&nbsp;не&nbsp;где они днём.</li>}
          </ul>
          <p className="rp-sources">{sourcesLine(detail)} Подложка: © OpenStreetMap, OpenFreeMap.</p>
        </Part>

        <footer className="rp-foot">
          <span>
            UzHa · {detail.city.name} · {date}
          </span>
          <a href={SITE_URL}>{SITE}</a>
        </footer>
      </article>
      </PatternScopeProvider>
    </div>,
    document.body,
  );
}
