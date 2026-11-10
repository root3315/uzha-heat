import { useCallback, useMemo, useState } from 'react';
import type { CitySummary } from '../../data/contract';
import { genitive, hotTenthAnswer, plainText, sectionAnswer } from '../../domain/answers';
import type { CityModel } from '../../domain/cityModel';
import { formatDeg, formatDegSigned, formatNumber, plural } from '../../domain/format';
import type { HeatIsland } from '../../domain/heatIsland';
import { findMessage, huntCell, leadingFactor, registerFind, type HuntCandidate, type HuntTarget } from '../../domain/hunt';
import { recommend } from '../../domain/recommendations';
import { sampleTransect, type LonLat } from '../../domain/transect';
import { CityMap } from '../../map/CityMap';
import { useAsync, useNear, useWidth } from '../hooks';
import { CityPhoto } from '../CityPhoto';
import { Link } from '../Link';
import { cityModel } from '../models';
import { Evidence } from '../panel/Panel';
import { Ramp } from '../panel/Ramp';
import { Phrase } from '../Phrase';
import { ProfileChart } from '../ProfileChart';
import { useReadout } from '../readout';
import { methodHref, toolHref } from '../routing';
import { CauseKey } from '../Section';
import { MiniMap } from './MiniMap';
import { PROBLEM_FACTS } from './problem';

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
const TEAM = ['Амира', 'Олия', 'Макс', 'rabenvater', 'Степан'];
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

/** "+1,3°" for the heat island, or an ellipsis while there is nothing to compare. */
const islandFigure = (island: HeatIsland | null) => (island ? formatDegSigned(island.intensity) : '…');

/** The opening map: the real isotherms, a readout under the pointer and the optional hunt for hot places. */
function HeroMap({ model, hunt, onHunt }: { model: CityModel; hunt: Hunt; onHunt(found: ReadonlySet<number>): void }) {
  const { detail } = model;
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
      setSaid(findMessage(result.outcome, hit.t, hunt.target, detail.stats.lstMean));
      if (result.found !== hunt.found) onHunt(result.found);
    },
    [cellUnder, detail, hunt, onHunt],
  );

  return (
    <section className="live" aria-label={`Карта температуры поверхности: ${detail.city.name}`}>
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
            <p>
              горячих найдено <b>{formatNumber(hunt.found.size, 0)}</b>&nbsp;/&nbsp;{formatNumber(hunt.target.total, 0)}
            </p>
            <p className="hunt-chip__log">{said ?? `горячий: от ${formatDeg(hunt.target.threshold)}, нажмите на такой`}</p>
          </div>
        </CityMap>
      </div>

      <aside className="live__side">
        <div className="gauge">
          <p className="gauge__label">температура поверхности, доля города</p>
          <Ramp levels={model.levels} shares={model.shares} min={detail.stats.lstMin} max={detail.stats.lstMax} value={detail.stats.lstMean} meanMark={null} />
          <p className="gauge__hint">
            Цвет значит только градусы, линии через каждые 2°, как горизонтали на&nbsp;карте гор. Наведите или коснитесь: карта скажет градусы и&nbsp;причину.
          </p>
        </div>
        <Link className="pill pill--ink pill--big live__open" href={toolHref(detail.city.id)}>
          Открыть карту целиком
        </Link>
      </aside>
    </section>
  );
}

/** Four sourced facts: why urban heat matters here at all. */
function Problem() {
  return (
    <section className="problem" id="problem" aria-labelledby="problem-title">
      <h2 id="problem-title" className="problem__title">
        Почему это важно
      </h2>
      <ul className="problem__list">
        {PROBLEM_FACTS.map((fact) => (
          <li key={fact.figure} className="fact">
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
  const [ref, width] = useWidth<HTMLDivElement>(800);
  const profile = useMemo(() => sampleTransect(model.source, model.defaultTransect), [model]);
  const leading = leadingFactor(detail.globalImportance);
  const leadingFeature = detail.features.find((f) => f.key === leading?.key);

  return (
    <section className="why" id="why" aria-labelledby="why-title">
      <div className="why__top">
        {leading && leadingFeature && (
          <div className="why__count">
            <h2 id="why-title">
              <span className="why__num">{formatNumber(leading.share * 100, 0)}%</span>
              <span className="why__cap">того, что объясняет модель, приходится на&nbsp;{leadingFeature.label.toLowerCase()}</span>
            </h2>
            <p>
              Модель предсказывает температуру каждого участка 200&nbsp;м по&nbsp;{detail.features.length} факторам. {leadingFeature.label}{' '}
              {leading.share > 0.5 ? 'весит больше, чем все остальные вместе' : 'весит больше любого другого'}. Зелень меряем индексом NDVI со&nbsp;спутника: около 0
              у&nbsp;асфальта и&nbsp;голой земли, ближе к&nbsp;1 у&nbsp;густой листвы.
            </p>
          </div>
        )}
        <p className="why__answer">
          <Phrase spans={hotTenthAnswer(detail, model.facts)} />
        </p>
      </div>

      <article className="why__panel" aria-label="Разрез через самое жаркое место">
        <header className="why__head">
          <h3>Разрез через самое жаркое место</h3>
          <p className="why__line">
            <Phrase spans={sectionAnswer(profile, detail.stats.lstMean, detail.features)} />
          </p>
        </header>
        <div ref={ref} className="why__chart">
          <ProfileChart profile={profile} levels={model.levels} cityMean={detail.stats.lstMean} features={detail.features} width={width} height={width < 560 ? 190 : 230} />
        </div>
        <footer className="why__foot">
          <CauseKey model={model} />
          <p className="why__hint">Полоса внизу: что греет каждый отрезок сильнее всего.</p>
        </footer>
      </article>
    </section>
  );
}

/** One city as a card: its heat island first, then what its hottest tenth is, and its own small map. */
function CityCard({ city }: { city: CitySummary }) {
  const [ref, near] = useNear<HTMLElement>();
  const state = useAsync(() => (near ? cityModel(city.id) : new Promise<null>(() => undefined)), [near, city.id]);
  const model = state.status === 'ready' ? state.data : null;
  const detail = model?.detail;
  const failed = state.status === 'error';

  return (
    <article ref={ref} className="town" aria-labelledby={`town-${city.id}`}>
      <CityPhoto city={city} className="town__photo" />
      <header className="town__head">
        <h3 id={`town-${city.id}`}>{city.name}</h3>
        <p className="town__island">
          <span className="town__figure">{model ? islandFigure(model.island) : '…'}</span>
          <span className="town__caption">поверхность в&nbsp;черте против кольца вокруг</span>
        </p>
      </header>
      <p className="town__line">{model ? plainText(hotTenthAnswer(model.detail, model.facts)) : failed ? 'Данные не загрузились.' : 'Считаю изотермы.'}</p>
      <Link className="town__face" href={toolHref(city.id)} aria-label={`Открыть карту: ${city.name}`}>
        {model ? <MiniMap model={model} label={`Изотермы поверхности: ${city.name}`} /> : <span className="town__wait">{failed ? 'Нет данных' : 'Считаю изотермы'}</span>}
      </Link>
      <dl className="nums">
        <div>
          <dt>средняя поверхность</dt>
          <dd>{formatDeg(detail?.stats.lstMean ?? city.lstMean)}</dd>
        </div>
        <div>
          <dt>горячая десятая часть</dt>
          <dd>{detail ? `от ${formatDeg(detail.stats.lstP90)}` : '…'}</dd>
        </div>
      </dl>
      <p className="tag town__meta">
        {detail
          ? `${detail.period.lstScenes} ${plural(detail.period.lstScenes, ['снимок', 'снимка', 'снимков'])} Landsat · R² ${formatNumber(detail.model.r2Cv, 2)}`
          : `R² ${formatNumber(city.r2, 2)}`}
      </p>
      <Link className="pill town__open" href={toolHref(city.id)}>
        Карта {genitive(city.name)} ↗
      </Link>
    </article>
  );
}

function Actions({ model }: { model: CityModel }) {
  const { detail } = model;
  const items = recommend({ features: detail.features, values: model.hotspot.values, contributions: model.hotspot.contributions, cityMeans: model.cityMeans }).slice(0, 3);
  if (items.length === 0) return null;
  return (
    <section className="acts" id="actions" aria-labelledby="acts-title">
      <div className="acts__head">
        <h2 id="acts-title">Что делать</h2>
        <p>
          Для горячей десятой части {genitive(detail.city.name)}. Число слева: сколько градусов поверхности эта причина даёт там по&nbsp;модели. Сколько снимет мера,
          известно из&nbsp;обзоров по&nbsp;другим городам, ссылка у&nbsp;каждой.
        </p>
      </div>
      <ol className="acts__list">
        {items.map((item) => (
          <li key={item.id} className="act">
            <p className="act__effect">
              <span>{formatDegSigned(item.heating)}</span>
              <small>даёт эта причина</small>
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
  return (
    <footer className="close" id="method" aria-labelledby="how-title">
      <div className="close__how">
        <h2 id="how-title">Как посчитали</h2>
        <p>
          Город режем на&nbsp;участки {grid.cellSizeM} на&nbsp;{grid.cellSizeM}&nbsp;м. Для каждого берём температуру поверхности со&nbsp;спутников NASA/USGS Landsat 8
          и&nbsp;9: медиана безоблачных снимков за&nbsp;{period.label}. Рядом {detail.features.length} факторов: зелень и&nbsp;альбедо по&nbsp;Sentinel-2, застройка
          и&nbsp;грунт по&nbsp;ESA WorldCover, дороги и&nbsp;вода по&nbsp;OpenStreetMap, высота по&nbsp;Copernicus DEM.
        </p>
        <p>
          Модель {fit.type} предсказывает температуру по&nbsp;факторам, проверяем её на&nbsp;кусках города, которых она не&nbsp;видела. Вклад фактора в&nbsp;градусах
          считает SHAP: это связь в&nbsp;данных, а&nbsp;не&nbsp;эксперимент. Остров тепла: медиана участков внутри черты города минус медиана кольца вокруг.
        </p>
        <p className="close__data">
          [{detail.city.nameEn.toLowerCase()}] {period.lstScenes} сцен Landsat · {period.s2Scenes} сцен Sentinel-2 · {formatNumber(grid.count, 0)} участков · R²{' '}
          {formatNumber(fit.r2Cv, 2)} · MAE {formatDeg(fit.maeCv)}
        </p>
        <Link className="pill" href={methodHref(detail.city.id)}>
          Весь метод и&nbsp;факторы
        </Link>
      </div>
      <div className="close__team" id="team">
        <h2 className="close__label">Команда</h2>
        <ul className="close__names">
          {TEAM.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <ul className="links">
          <li>
            <a className="pill pill--ink" href={REPO} target="_blank" rel="noopener">
              Код на&nbsp;GitHub ↗
            </a>
          </li>
          <li>
            <Link className="pill" href={toolHref(detail.city.id)}>
              Открыть карту
            </Link>
          </li>
        </ul>
        <p className="close__credit">
          Снимки NASA/USGS Landsat и&nbsp;ESA Sentinel-2, покрытие ESA WorldCover, подложка © OpenStreetMap, OpenFreeMap. © 2026 UzHa
        </p>
      </div>
    </footer>
  );
}

/** The landing: what UzHa shows, live, before the full map. */
export function Landing({ cities, model, hunt, onHunt }: LandingProps) {
  const { detail, island } = model;
  const name = genitive(detail.city.name);
  return (
    <main>
      <section className="hero" id="top">
        <h1 className="hero__title">Где {detail.city.name} перегревается летом и&nbsp;почему</h1>
        <div className="hero__island">
          <p className="hero__figure">{islandFigure(island)}</p>
          <p className="hero__caption">
            {island && island.intensity < 0
              ? `Поверхность в черте ${name} прохладнее, чем вокруг: голая земля за чертой нагревается сильнее.`
              : `Поверхность в черте ${name} горячее, чем в кольце вокруг: медианы участков 200 м, лето ${detail.period.label}.`}{' '}
            <span className="hero__note">Это температура поверхности по&nbsp;снимкам около 11 утра, не&nbsp;воздуха.</span>
          </p>
        </div>
      </section>

      <HeroMap model={model} hunt={hunt} onHunt={onHunt} />
      <Problem />
      <Why model={model} />

      <section className="towns" id="cities" aria-labelledby="towns-title">
        <div className="towns__head">
          <h2 id="towns-title">Три города</h2>
          <p>Одна методика, одни и&nbsp;те&nbsp;же спутники. Мини-карты отвечают на&nbsp;наведение и&nbsp;касание, по&nbsp;клику открываются целиком.</p>
        </div>
        <div className="towns__list">
          {cities.map((city) => (
            <CityCard key={city.id} city={city} />
          ))}
        </div>
      </section>

      <Actions model={model} />
      <Closing model={model} />
    </main>
  );
}
