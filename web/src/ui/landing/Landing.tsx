import { useCallback, useMemo, useState } from 'react';
import type { CitySummary } from '../../data/contract';
import { cityAnswer, genitive, plainText, sectionAnswer } from '../../domain/answers';
import type { CityModel } from '../../domain/cityModel';
import { formatDeg, formatNumber, plural } from '../../domain/format';
import { findMessage, leadingFactor, registerFind, type HuntTarget } from '../../domain/hunt';
import { formatEffect, recommend } from '../../domain/recommendations';
import { sampleTransect, type LonLat } from '../../domain/transect';
import { CityMap } from '../../map/CityMap';
import { useAsync, useNear, useWidth } from '../hooks';
import { Link } from '../Link';
import { cityModel } from '../models';
import { Ramp } from '../panel/Ramp';
import { Phrase } from '../Phrase';
import { ProfileChart } from '../ProfileChart';
import { useReadout } from '../readout';
import { methodHref, toolHref } from '../routing';
import { CauseKey } from '../Section';
import { MiniMap } from './MiniMap';

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

const REPO = 'https://github.com/root3315/uzha-heat';
const TEAM = ['Амира', 'Oliya', 'max-s', 'Степан'];
const HERO_VIEW = { isolines: true, transect: false, interactive: false };
const HERO_PADDING = { top: 28, right: 28, bottom: 28, left: 28 };
const NO_TRANSECT: [LonLat, LonLat] = [
  [0, 0],
  [0, 0],
];

const coordinate = (value: number, positive: string, negative: string) => `${formatNumber(Math.abs(value), 2)}° ${value >= 0 ? positive : negative}`;

/** The opening map: the real isotherms, a readout under the pointer and the hunt for hot quarters. */
function HeroMap({ model, hunt, onHunt }: { model: CityModel; hunt: Hunt; onHunt(found: ReadonlySet<number>): void }) {
  const { detail } = model;
  const { cellUnder, describe } = useReadout(model);
  const [said, setSaid] = useState<string | null>(null);
  const found = useMemo(() => [...hunt.found].map((cell): LonLat => [detail.cells.lon[cell] ?? 0, detail.cells.lat[cell] ?? 0]), [hunt.found, detail]);

  const huntAt = useCallback(
    (point: LonLat) => {
      const cell = cellUnder(point);
      if (cell < 0) return;
      const t = detail.cells.lst[cell] ?? Number.NaN;
      const result = registerFind(hunt.found, cell, t, hunt.target);
      setSaid(findMessage(result.outcome, t, hunt.target, detail.stats.lstMean));
      if (result.found !== hunt.found) onHunt(result.found);
    },
    [cellUnder, detail, hunt, onHunt],
  );

  const [lon, lat] = detail.city.center;
  return (
    <section className="live" aria-labelledby="live-title">
      <div className="live__map">
        <header className="live__head">
          <h2 id="live-title" className="live__name">
            {detail.city.name}
          </h2>
          <p className="live__path">
            {coordinate(lat, 'с. ш.', 'ю. ш.')} {coordinate(lon, 'в. д.', 'з. д.')} · {formatNumber(detail.grid.count, 0)} квадратов по {detail.grid.cellSizeM} м
          </p>
        </header>
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
          />
        </div>
      </div>

      <aside className="live__side">
        <div className="gauge">
          <p className="gauge__label">найдено горячих кварталов</p>
          <p className="gauge__num" aria-live="polite">
            {formatNumber(hunt.found.size, 0)}
            <small>/ {formatNumber(hunt.target.total, 0)}</small>
          </p>
          <p className="gauge__log" aria-live="polite">
            {said ?? `горячий = от ${formatDeg(hunt.target.threshold)}, каждый десятый квартал`}
          </p>
        </div>
        <div className="gauge">
          <p className="gauge__label">температура поверхности, доля города</p>
          <Ramp levels={model.levels} shares={model.shares} min={detail.stats.lstMin} max={detail.stats.lstMax} value={detail.stats.lstMean} meanMark={null} />
          <p className="gauge__hint">Цвет значит только градусы. Линии проведены через каждые 2°, как горизонтали на карте гор.</p>
        </div>
        <Link className="pill pill--ink pill--big live__open" href={toolHref(detail.city.id)}>
          Открыть карту целиком
        </Link>
      </aside>
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
              Модель предсказывает температуру каждого квартала {genitive(detail.city.name)} по&nbsp;{detail.features.length} факторам.{' '}
              {leadingFeature.label} {leading.share > 0.5 ? 'весит больше, чем все остальные вместе' : 'весит больше любого другого'}.
            </p>
          </div>
        )}
        <p className="why__answer">
          <Phrase spans={cityAnswer(detail, model.facts)} />
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
          <ProfileChart profile={profile} levels={model.levels} cityMean={detail.stats.lstMean} features={detail.features} width={width} height={260} />
        </div>
        <footer className="why__foot">
          <CauseKey model={model} />
          <p className="why__hint">Штриховка внизу: что греет каждый отрезок сильнее всего. Ведите по графику.</p>
        </footer>
      </article>
    </section>
  );
}

/** One city: its name, three numbers, its answer and its own small live map, loaded when it comes near. */
function CityBlock({ city }: { city: CitySummary }) {
  const [ref, near] = useNear<HTMLElement>();
  const state = useAsync(() => (near ? cityModel(city.id) : new Promise<null>(() => undefined)), [near, city.id]);
  const model = state.status === 'ready' ? state.data : null;
  const detail = model?.detail;
  const answer = model ? plainText(cityAnswer(model.detail, model.facts)) : null;

  return (
    <article ref={ref} className="town" aria-labelledby={`town-${city.id}`}>
      <header className="town__head">
        <h3 id={`town-${city.id}`}>{city.name}</h3>
        <p className="town__line">{answer ?? `В среднем ${formatDeg(city.lstMean)} на поверхности летом.`}</p>
      </header>
      <Link className="town__face" href={toolHref(city.id)} aria-label={`Открыть карту: ${city.name}`}>
        {model ? (
          <MiniMap model={model} height={440} label={`Изотермы поверхности: ${city.name}`} />
        ) : (
          <span className="town__wait">{state.status === 'error' ? 'Данные не загрузились' : 'Считаю изотермы'}</span>
        )}
      </Link>
      <div className="town__foot">
        {detail && (
          <p className="tag town__meta">
            {detail.period.lstScenes} {plural(detail.period.lstScenes, ['снимок', 'снимка', 'снимков'])} Landsat · {formatNumber(detail.grid.count, 0)} квадратов
          </p>
        )}
        <dl className="nums">
          <div>
            <dt>средняя поверхность</dt>
            <dd>{formatDeg(detail?.stats.lstMean ?? city.lstMean)}</dd>
          </div>
          <div>
            <dt>горячая десятая часть</dt>
            <dd>{detail ? `от ${formatDeg(detail.stats.lstP90)}` : '…'}</dd>
          </div>
          <div>
            <dt>R² модели</dt>
            <dd>{formatNumber(detail?.model.r2Cv ?? city.r2, 2)}</dd>
          </div>
        </dl>
        <Link className="pill" href={toolHref(city.id)}>
          Карта {genitive(city.name)} ↗
        </Link>
      </div>
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
          Для горячей десятой части {genitive(detail.city.name)}. Эффект взят из&nbsp;опыта других городов, это ориентир, а&nbsp;не&nbsp;прогноз для конкретного двора.
        </p>
      </div>
      <ol className="acts__list">
        {items.map((item) => (
          <li key={item.id} className="act">
            <p className="act__effect">
              <span>{formatEffect(item.effect)}</span>
              <small>обычно снимает с поверхности</small>
            </p>
            <h3 className="act__title">{item.title}</h3>
            <p className="act__why">{item.reasons.map((r) => r.text).join('; ')}.</p>
            <p className="act__todo">{item.actions[0]}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Method({ model }: { model: CityModel }) {
  const { detail } = model;
  const { period, grid, model: fit } = detail;
  return (
    <section className="how" id="method" aria-labelledby="how-title">
      <h2 id="how-title">Как посчитали</h2>
      <div className="how__text">
        <p>
          Город режем на&nbsp;квадраты {grid.cellSizeM} на&nbsp;{grid.cellSizeM}&nbsp;м. Для каждого берём температуру поверхности со&nbsp;спутников Landsat 8 и&nbsp;9: медиана
          безоблачных снимков за&nbsp;{period.label}. Рядом кладём {detail.features.length} факторов: зелень и&nbsp;альбедо по&nbsp;Sentinel-2, застройку и&nbsp;грунт по&nbsp;ESA
          WorldCover, дороги и&nbsp;воду по&nbsp;OpenStreetMap, высоту по&nbsp;Copernicus DEM.
        </p>
        <p>
          Модель {fit.type} учится предсказывать температуру по&nbsp;факторам, а&nbsp;проверяем её на&nbsp;кусках города, которых она не&nbsp;видела. Вклад каждого фактора
          в&nbsp;градусах считает SHAP. Это связь в&nbsp;данных, а&nbsp;не&nbsp;эксперимент, и&nbsp;температура поверхности около 11 утра, а&nbsp;не&nbsp;воздуха.
        </p>
        <p className="how__data">
          [{detail.city.nameEn.toLowerCase()}] {period.lstScenes} сцен Landsat · {period.s2Scenes} сцен Sentinel-2 · {formatNumber(grid.count, 0)} квадратов · R²{' '}
          {formatNumber(fit.r2Cv, 2)} · MAE {formatDeg(fit.maeCv)}
        </p>
        <Link className="pill" href={methodHref(detail.city.id)}>
          Весь метод и&nbsp;факторы
        </Link>
      </div>
    </section>
  );
}

/** The landing: what UzHa shows, live, before the full map. */
export function Landing({ cities, model, hunt, onHunt }: LandingProps) {
  const { detail } = model;
  const { stats } = detail;
  return (
    <main>
      <section className="hero" id="top">
        <h1 className="hero__title">Найдите самый горячий квартал {genitive(detail.city.name)}</h1>
        <div className="hero__foot">
          <p className="hero__data">
            [landsat 8/9] {detail.period.label}, {detail.period.lstScenes} снимков: в&nbsp;среднем <b>{formatDeg(stats.lstMean)}</b>, максимум{' '}
            <b>{formatDeg(stats.lstMax)}</b>
          </p>
          <p className="hero__side">
            UzHa показывает, где город перегревается летом и&nbsp;почему. Карта ниже живая: ведите по&nbsp;ней, она скажет градусы и&nbsp;причину. Каждый десятый квартал горячее{' '}
            {formatDeg(stats.lstP90)}. Найдёте такой, нажмите.
          </p>
        </div>
      </section>

      <HeroMap model={model} hunt={hunt} onHunt={onHunt} />
      <Why model={model} />

      <section className="towns" id="cities" aria-labelledby="towns-title">
        <div className="towns__head">
          <h2 id="towns-title">Три города</h2>
          <p>Одна методика, одни и&nbsp;те&nbsp;же спутники. Карты ниже тоже отвечают под&nbsp;курсором, а&nbsp;по&nbsp;клику открываются целиком.</p>
        </div>
        <div className="towns__list">
          {cities.map((city) => (
            <CityBlock key={city.id} city={city} />
          ))}
        </div>
      </section>

      <Actions model={model} />
      <Method model={model} />

      <section className="team" id="team" aria-labelledby="team-title">
        <h2 id="team-title">Команда</h2>
        <ul className="team__names">
          {TEAM.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <ul className="links">
          <li>
            <a className="pill pill--big pill--ink" href={REPO} target="_blank" rel="noopener">
              Код на GitHub ↗
            </a>
          </li>
          <li>
            <Link className="pill pill--big" href={toolHref(detail.city.id)}>
              Открыть карту
            </Link>
          </li>
        </ul>
      </section>
    </main>
  );
}
