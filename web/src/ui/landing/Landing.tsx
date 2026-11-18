import { useCallback, useMemo, useState } from 'react';
import type { CitySummary } from '../../data/contract';
import { hotTenthAnswer, sectionAnswer } from '../../domain/answers';
import type { CityModel } from '../../domain/cityModel';
import { cityName, featureLabel, periodText } from '../../domain/dataTexts';
import type { Formats } from '../../domain/format';
import { cityEnergy, cityEnergyLine, energyCaveat } from '../../domain/energy';
import type { HeatIsland } from '../../domain/heatIsland';
import { formatPeople, peopleFigure, peopleInHeat, sparseHeatNote } from '../../domain/people';
import { findMessage, huntCell, leadingFactor, registerFind, type HuntCandidate, type HuntTarget } from '../../domain/hunt';
import { plainText } from '../../domain/phrase';
import { recommend } from '../../domain/recommendations';
import { sampleTransect, type LonLat } from '../../domain/transect';
import { CityMap } from '../../map/CityMap';
import { useAsync, useNear, useWidth } from '../hooks';
import { CityPhoto } from '../CityPhoto';
import { EnergySummary } from '../Energy';
import { Link } from '../Link';
import { useFormats, useLocale, useTexts } from '../locale';
import { cityModel } from '../models';
import { Evidence } from '../panel/Panel';
import { Ramp } from '../panel/Ramp';
import { Phrase } from '../Phrase';
import { ProfileChart } from '../ProfileChart';
import { useReadout } from '../readout';
import { methodHref, toolHref } from '../routing';
import { CauseKey } from '../Section';
import { LANDING_TEXTS } from './landing.texts';
import { MiniMap } from './MiniMap';
import { PROBLEM_FACTS } from './problem.texts';
import { WeatherCompare } from '../Weather';

export interface Hunt {
  target: HuntTarget;
  found: ReadonlySet<number>;
}

interface LandingProps {
  cities: CitySummary[];
  /** The city of the opening map, already loaded. */
  model: CityModel;
  hunt: Hunt;
  onHunt(found: ReadonlySet<number>): void;
}

export const REPO = 'https://github.com/root3315/uzha-heat';
const HERO_VIEW = { isolines: true, transect: false, interactive: false };
const HERO_PADDING = { top: 64, right: 20, bottom: 20, left: 20 };
const NO_TRANSECT: [LonLat, LonLat] = [
  [0, 0],
  [0, 0],
];
/** The tapped cell, then its eight neighbours: a hit within one cell counts. */
const AROUND = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/** "+1.3°" for the heat island, or an ellipsis while there is nothing to compare. */
const islandFigure = (island: HeatIsland | null, { formatDegSigned }: Formats) => (island ? formatDegSigned(island.intensity) : '…');

/** The opening map: the real isotherms, a readout under the pointer and the optional hunt for hot places. */
function HeroMap({ model, hunt, onHunt }: { model: CityModel; hunt: Hunt; onHunt(found: ReadonlySet<number>): void }) {
  const { detail } = model;
  const locale = useLocale();
  const { formatDeg, formatNumber } = useFormats();
  const t = useTexts(LANDING_TEXTS).map;
  const { cellUnder, describe } = useReadout(model);
  const [said, setSaid] = useState<string | null>(null);
  const found = useMemo(() => [...hunt.found].map((cell): LonLat => [detail.cells.lon[cell] ?? 0, detail.cells.lat[cell] ?? 0]), [hunt.found, detail]);

  const huntAt = useCallback(
    ([lon, lat]: LonLat) => {
      const [halfLon, halfLat] = detail.grid.halfSizeDeg;
      const candidates: HuntCandidate[] = AROUND.flatMap(([i, j]) => {
        const cell = cellUnder([lon + i * 2 * halfLon, lat + j * 2 * halfLat]);
        return cell < 0 ? [] : [{ cell, t: detail.cells.lst[cell] ?? Number.NaN }];
      });
      const hit = huntCell(candidates, hunt.found, hunt.target);
      if (!hit) return;
      const result = registerFind(hunt.found, hit.cell, hit.t, hunt.target);
      setSaid(findMessage(result.outcome, hit.t, hunt.target, detail.stats.lstMean, locale));
      if (result.found !== hunt.found) onHunt(result.found);
    },
    [cellUnder, detail, hunt, onHunt, locale],
  );

  return (
    <section className="live" aria-label={t.region(cityName(detail.city, locale))}>
      <div className="live__face">
        <CityMap
          model={model}
          view={HERO_VIEW}
          padding={HERO_PADDING}
          transect={NO_TRANSECT}
          onTransectChange={() => undefined}
          drawing={false}
          onDrawingEnd={() => undefined}
          place={null}
          onPick={huntAt}
          probe={null}
          found={found}
          mode="temperature"
          describe={describe}
          onIdle={() => undefined}
        >
          <div className="hunt-chip" aria-live="polite">
            {hunt.found.size > 0 && (
              <p>
                {t.foundBefore}
                <b>{formatNumber(hunt.found.size, 0)}</b>
                {t.foundOf(formatNumber(hunt.target.total, 0))}
              </p>
            )}
            <p className="hunt-chip__log">{said ?? t.prompt(formatDeg(hunt.target.threshold))}</p>
          </div>
        </CityMap>
      </div>

      <aside className="live__side">
        <div className="gauge">
          <p className="gauge__label">{t.gaugeLabel}</p>
          <Ramp levels={model.levels} shares={model.shares} min={detail.stats.lstMin} max={detail.stats.lstMax} value={detail.stats.lstMean} meanMark={null} />
          <p className="gauge__hint">{t.gaugeHint}</p>
        </div>
        <Link className="pill pill--ink pill--big live__open" href={toolHref(detail.city.id)}>
          {t.openFull}
        </Link>
      </aside>
    </section>
  );
}

/** Four sourced facts: why urban heat matters here at all. */
function Problem() {
  const facts = useTexts(PROBLEM_FACTS);
  const title = useTexts(LANDING_TEXTS).problemTitle;
  return (
    <section className="problem" id="problem" aria-labelledby="problem-title">
      <h2 id="problem-title" className="problem__title">
        {title}
      </h2>
      <ul className="problem__list">
        {facts.map((fact) => (
          <li key={fact.url} className="fact">
            <p className="fact__figure">{fact.figure}</p>
            <p className="fact__text">
              {fact.text}{' '}
              <a className="text-link" href={fact.url} target="_blank" rel="noopener">
                {fact.source}&nbsp;↗
              </a>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Why it is hot: the honest headline number and the section through the hottest place, live. */
function Why({ model }: { model: CityModel }) {
  const { detail } = model;
  const locale = useLocale();
  const { formatNumber } = useFormats();
  const t = useTexts(LANDING_TEXTS).why;
  const [ref, width] = useWidth<HTMLDivElement>(800);
  const profile = useMemo(() => sampleTransect(model.source, model.defaultTransect), [model]);
  const leading = leadingFactor(detail.globalImportance);
  const leadingFeature = detail.features.find((f) => f.key === leading?.key);
  const leadingLabel = leadingFeature ? featureLabel(leadingFeature, locale) : '';
  const energy = useMemo(() => cityEnergy(detail), [detail]);

  return (
    <section className="why" id="why" aria-labelledby="why-title">
      <div className="why__top">
        {leading && leadingFeature && (
          <div className="why__count">
            <h2 id="why-title">
              <span className="why__num">{formatNumber(leading.share * 100, 0)}%</span>
              <span className="why__cap">{t.caption(leadingLabel)}</span>
            </h2>
            <p>{t.body(detail.features.length, leadingLabel, leading.share > 0.5)}</p>
          </div>
        )}
        <p className="why__answer">
          <Phrase spans={hotTenthAnswer(detail, model.facts, locale)} />
        </p>
      </div>

      <article className="why__panel" aria-label={t.sectionTitle}>
        <header className="why__head">
          <h3>{t.sectionTitle}</h3>
          <p className="why__line">
            <Phrase spans={sectionAnswer(profile, detail.stats.lstMean, detail.features, locale)} />
          </p>
        </header>
        <div ref={ref} className="why__chart">
          <ProfileChart profile={profile} levels={model.levels} cityMean={detail.stats.lstMean} features={detail.features} width={width} height={width < 560 ? 190 : 230} />
        </div>
        <footer className="why__foot">
          <CauseKey model={model} />
          <p className="why__hint">{t.sectionHint}</p>
        </footer>
      </article>

      {energy && detail.energy && (
        <article className="why__panel why__energy" aria-labelledby="why-energy-title">
          <header className="why__head">
            <h3 id="why-energy-title">{t.energyTitle}</h3>
            <p className="why__line">{cityEnergyLine(cityName(detail.city, locale), energy, locale)}</p>
          </header>
          <EnergySummary summary={energy} />
          <p className="why__hint">{energyCaveat(detail.energy, locale)}</p>
        </article>
      )}
    </section>
  );
}

/** One city as a card: its heat island first, then what its hottest tenth is, and its own small map. */
function CityCard({ city }: { city: CitySummary }) {
  const locale = useLocale();
  const f = useFormats();
  const { formatDeg, formatNumber } = f;
  const t = useTexts(LANDING_TEXTS).town;
  const name = cityName(city, locale);
  const [ref, near] = useNear<HTMLElement>();
  const state = useAsync(() => (near ? cityModel(city.id) : new Promise<null>(() => undefined)), [near, city.id]);
  const model = state.status === 'ready' ? state.data : null;
  const detail = model?.detail;
  const failed = state.status === 'error';
  const inHeat = model ? peopleInHeat(model.detail, model.inside) : null;
  const sparse = inHeat ? sparseHeatNote(inHeat, locale) : null;

  return (
    <article ref={ref} className="town" aria-labelledby={`town-${city.id}`}>
      <CityPhoto city={city} className="town__photo" />
      <header className="town__head">
        <h3 id={`town-${city.id}`}>{name}</h3>
        <p className="town__island">
          <span className="town__figure">{model ? islandFigure(model.island, f) : '…'}</span>
          <span className="town__caption">{t.islandCaption}</span>
        </p>
      </header>
      <p className="town__line">{model ? plainText(hotTenthAnswer(model.detail, model.facts, locale)) : failed ? t.failed : t.computing}</p>
      <Link className="town__face" href={toolHref(city.id)} aria-label={t.openMap(name)}>
        {model ? <MiniMap model={model} label={t.isotherms(name)} /> : <span className="town__wait">{failed ? t.noData : t.computingShort}</span>}
      </Link>
      <dl className="nums">
        <div>
          <dt>{t.meanSurface}</dt>
          <dd>{formatDeg(detail?.stats.lstMean ?? city.lstMean)}</dd>
        </div>
        <div>
          <dt>{t.hotTenth}</dt>
          <dd>{detail ? t.from(formatDeg(detail.stats.lstP90)) : '…'}</dd>
        </div>
        {inHeat && (
          <div>
            <dt>{t.livingHot}</dt>
            <dd>{peopleFigure(inHeat.people, locale)}</dd>
          </div>
        )}
      </dl>
      {sparse && <p className="town__note">{sparse}</p>}
      <p className="tag town__meta">
        {detail
          ? t.scenes(detail.period.lstScenes, formatNumber(detail.model.r2Cv, 2))
          : `R² ${formatNumber(city.r2, 2)}`}
      </p>
      <Link className="pill town__open" href={toolHref(city.id)}>
        {t.cityMap(name)}
      </Link>
    </article>
  );
}

/** The three summers side by side, under the cards: the weather the surface heats in. */
function TownsWeather({ cities }: { cities: CitySummary[] }) {
  const title = useTexts(LANDING_TEXTS).towns.weather;
  if (cities.filter((c) => c.weather).length < 2) return null;
  return (
    <div className="towns__weather" aria-labelledby="towns-weather-title">
      <h3 id="towns-weather-title">{title}</h3>
      <WeatherCompare cities={cities} currentId={null} />
    </div>
  );
}

function Actions({ model }: { model: CityModel }) {
  const { detail } = model;
  const locale = useLocale();
  const { formatDegSigned } = useFormats();
  const t = useTexts(LANDING_TEXTS).actions;
  const items = recommend(
    { features: detail.features, values: model.hotspot.values, contributions: model.hotspot.contributions, cityMeans: model.cityMeans },
    locale,
  ).slice(0, 3);
  if (items.length === 0) return null;
  return (
    <section className="acts" id="actions" aria-labelledby="acts-title">
      <div className="acts__head">
        <h2 id="acts-title">{t.title}</h2>
        <p>{t.intro(cityName(detail.city, locale))}</p>
      </div>
      <ol className="acts__list">
        {items.map((item) => (
          <li key={item.id} className="act">
            <p className="act__effect">
              <span>{formatDegSigned(item.heating)}</span>
              <small>{t.effectNote}</small>
            </p>
            <h3 className="act__title">{item.title}</h3>
            <p className="act__why">{item.reasons[0]?.text}.</p>
            <div className="act__todo">
              <p>{item.actions[0]}</p>
              <Evidence evidence={item.evidence} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The closing band: how it was computed, who made it, where the code and the data come from. */
function Closing({ model }: { model: CityModel }) {
  const { detail } = model;
  const { period, grid, model: fit } = detail;
  const locale = useLocale();
  const { formatDeg, formatNumber } = useFormats();
  const t = useTexts(LANDING_TEXTS).closing;
  return (
    <footer className="close" id="method" aria-labelledby="how-title">
      <div className="close__how">
        <h2 id="how-title">{t.title}</h2>
        <p>{t.data(grid.cellSizeM, periodText(period.label, locale), detail.features.length)}</p>
        <p>{t.model(fit.type)}</p>
        {detail.population && <p>{t.people(detail.population.year)}</p>}
        <p className="close__data">
          [{detail.city.nameEn.toLowerCase()}] {t.figures(period.lstScenes, period.s2Scenes, formatNumber(grid.count, 0), formatNumber(fit.r2Cv, 2), formatDeg(fit.maeCv))}
        </p>
        <Link className="pill" href={methodHref(detail.city.id)}>
          {t.method}
        </Link>
      </div>
      <div className="close__team" id="team">
        <h2 className="close__label">{t.team}</h2>
        <ul className="close__names">
          {t.names.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <ul className="links">
          <li>
            <a className="pill pill--ink" href={REPO} target="_blank" rel="noopener">
              {t.github}
            </a>
          </li>
          <li>
            <Link className="pill" href={toolHref(detail.city.id)}>
              {t.openMap}
            </Link>
          </li>
        </ul>
        <p className="close__credit">{t.credit}</p>
      </div>
    </footer>
  );
}

/** The landing: what UzHa shows, live, before the full map. */
export function Landing({ cities, model, hunt, onHunt }: LandingProps) {
  const { detail, island } = model;
  const locale = useLocale();
  const f = useFormats();
  const t = useTexts(LANDING_TEXTS);
  const name = cityName(detail.city, locale);
  const inHeat = peopleInHeat(detail, model.inside);
  return (
    <main>
      <section className="hero" id="top">
        <h1 className="hero__title">{t.hero.title(name)}</h1>
        <div className="hero__island">
          <p className="hero__figure">{islandFigure(island, f)}</p>
          <p className="hero__caption">
            {island && island.intensity < 0
              ? t.hero.cooler(name)
              : t.hero.hotter(name, periodText(detail.period.label, locale))}{' '}
            <span className="hero__note">{t.hero.surfaceNote}</span>
          </p>
          {inHeat && (
            <p className="hero__people">
              <b>{formatPeople(inHeat.people, locale)}</b>
              {t.hero.peopleRest(name, f.formatDeg(detail.stats.lstP90))}{' '}
              <span className="hero__note">{t.hero.peopleNote(detail.population?.year)}</span>
            </p>
          )}
        </div>
      </section>

      <HeroMap model={model} hunt={hunt} onHunt={onHunt} />
      <Problem />
      <Why model={model} />

      <section className="towns" id="cities" aria-labelledby="towns-title">
        <div className="towns__head">
          <h2 id="towns-title">{t.towns.title}</h2>
          <p>{t.towns.intro}</p>
        </div>
        <div className="towns__list">
          {cities.map((city) => (
            <CityCard key={city.id} city={city} />
          ))}
        </div>
        <TownsWeather cities={cities} />
      </section>

      <Actions model={model} />
      <Closing model={model} />
    </main>
  );
}
