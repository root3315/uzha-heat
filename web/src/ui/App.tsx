import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { CitySummary } from '../data/contract';
import { loadCities } from '../data/load';
import { genitive } from '../domain/answers';
import { huntTarget } from '../domain/hunt';
import { loadingLine } from '../domain/loading';
import { Bar } from './Bar';
import { endBoot, isBooting, showBootStage } from './boot';
import { scrollToId, useAsync } from './hooks';
import { Landing, REPO } from './landing/Landing';
import { MethodPage } from './MethodPage';
import { cityModel, watchLoad } from './models';
import { PatternDefs } from './patterns';
import { methodHref, navigate, redirect, toolHref, useRoute, type Route } from './routing';
import { Tool } from './Tool';

const HOME = import.meta.env.BASE_URL;

/** A loading or error line; with `onRetry`, a button to try again. */
function Status({ children, onRetry }: { children: string; onRetry?(): void }) {
  return (
    <div className="app-status" role="status">
      <p>{children}</p>
      {onRetry && (
        <button type="button" className="pill pill--ink" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}

/** The loading line once the first screen is gone: switching cities, trying again. */
function Loading({ cityId }: { cityId: string }) {
  const [line, setLine] = useState(() => loadingLine({ download: null, building: false }));
  useEffect(() => watchLoad(cityId, (stage) => setLine(loadingLine(stage))), [cityId]);
  return <Status>{line}</Status>;
}

function Footer() {
  return (
    <footer className="foot">
      <p>
        UzHa: острова тепла Ташкента, Самарканда и&nbsp;Бухары по&nbsp;снимкам NASA/USGS Landsat. Код открыт на&nbsp;
        <a href={REPO} target="_blank" rel="noopener">
          GitHub
        </a>
        .
      </p>
      <p>© 2026 UzHa</p>
    </footer>
  );
}

function Notice({ text, onClose }: { text: string; onClose(): void }) {
  return (
    <p className="notice" role="status">
      <span>{text}</span>
      <button type="button" className="notice__close" onClick={onClose} aria-label="Закрыть">
        ×
      </button>
    </p>
  );
}

function Page({ cities, route }: { cities: CitySummary[]; route: Route }) {
  const known = cities.find((c) => c.id === route.cityId);
  const city = known ?? cities[0];
  const landingCity = cities[0];
  const subject = route.view === 'story' ? landingCity : city;
  const [attempt, setAttempt] = useState(0);
  const state = useAsync(() => (subject ? cityModel(subject.id) : Promise.resolve(null)), [subject?.id, attempt]);
  const model = state.status === 'ready' ? state.data : null;
  const [found, setFound] = useState<ReadonlySet<number>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const target = useMemo(() => (route.view === 'story' && model ? huntTarget(model.detail, model.inside) : null), [route.view, model]);

  // An unknown city in the address: open the first one instead, and say so.
  useEffect(() => {
    if (route.view === 'story' || !route.cityId || known || !city) return;
    setNotice(`Города «${route.cityId}» в данных нет, открыт ${city.name}.`);
    redirect(route.view === 'tool' ? toolHref(city.id) : methodHref(city.id));
  }, [route.view, route.cityId, known, city]);

  const ready = state.status === 'ready';
  const subjectId = subject?.id;
  useEffect(() => (subjectId ? watchLoad(subjectId, (stage) => showBootStage(subjectId, stage)) : undefined), [subjectId]);
  // Swap the first screen for the page before the browser paints, so nothing is shown twice.
  useLayoutEffect(() => {
    if (state.status !== 'loading' || !subject) endBoot();
  }, [state.status, subject]);

  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (ready && id && !id.startsWith('/')) window.requestAnimationFrame(() => scrollToId(id, true));
    else window.scrollTo(0, 0);
  }, [route.view, route.cityId, ready]);

  useEffect(() => {
    const name = subject?.name ?? '';
    document.title =
      route.view === 'tool' ? `${name}: карта жары, UzHa` : route.view === 'method' ? `Как посчитано: ${name}, UzHa` : 'UzHa: где город перегревается летом';
  }, [route.view, subject?.name]);

  const bar = <Bar home={HOME} tool={route.view === 'tool' || !subject ? null : toolHref(subject.id)} onLanding={route.view === 'story'} />;
  const noticeLine = notice && <Notice text={notice} onClose={() => setNotice(null)} />;

  if (!subject) return <Status>В cities.json нет ни одного города.</Status>;
  if (state.status === 'loading' && isBooting()) return null;
  if (state.status !== 'ready' || !model) {
    // A failed load is dropped from the cache, so a new attempt fetches again.
    const retry = () => setAttempt((n) => n + 1);
    return (
      <>
        {bar}
        {state.status === 'loading' && <Loading cityId={subject.id} />}
        {state.status === 'error' && <Status onRetry={retry}>{`Не получилось загрузить данные ${genitive(subject.name)}. Проверьте связь и попробуйте ещё раз.`}</Status>}
        {state.status === 'ready' && <Status>{`Для ${genitive(subject.name)} данных пока нет.`}</Status>}
      </>
    );
  }

  return (
    <>
      {bar}
      {noticeLine}
      {route.view === 'tool' && <Tool key={model.detail.city.id} model={model} cities={cities} onCity={(id) => navigate(toolHref(id))} />}
      {route.view === 'method' && <MethodPage model={model} />}
      {route.view === 'story' && target && <Landing cities={cities} model={model} hunt={{ target, found }} onHunt={setFound} />}
      {route.view === 'method' && <Footer />}
    </>
  );
}

export function App() {
  const route = useRoute();
  const [attempt, setAttempt] = useState(0);
  const cities = useAsync(loadCities, [attempt]);

  useEffect(() => {
    window.history.scrollRestoration = 'manual';
  }, []);

  useLayoutEffect(() => {
    if (cities.status === 'error') endBoot();
  }, [cities.status]);

  if (cities.status === 'loading') return isBooting() ? null : <Status>Загружаю города</Status>;
  if (cities.status === 'error') {
    return <Status onRetry={() => setAttempt((n) => n + 1)}>Не получилось загрузить список городов. Проверьте связь и попробуйте ещё раз.</Status>;
  }
  return (
    <>
      <PatternDefs />
      <Page cities={cities.data} route={route} />
    </>
  );
}
