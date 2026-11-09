import { useEffect, useMemo, useState } from 'react';
import type { CitySummary } from '../data/contract';
import { loadCities } from '../data/load';
import { genitive } from '../domain/answers';
import { huntTarget } from '../domain/hunt';
import { Bar } from './Bar';
import { scrollToId, useAsync } from './hooks';
import { Landing } from './landing/Landing';
import { MethodPage } from './MethodPage';
import { cityModel } from './models';
import { PatternDefs } from './patterns';
import { navigate, toolHref, useRoute, type Route } from './routing';
import { Tool } from './Tool';

const REPO = 'https://github.com/root3315/uzha-heat';
const HOME = import.meta.env.BASE_URL;

function Status({ children }: { children: string }) {
  return (
    <p className="app-status" role="status">
      {children}
    </p>
  );
}

function Footer() {
  return (
    <footer className="foot">
      <p>
        UzHa: острова тепла Ташкента, Самарканда и&nbsp;Бухары по&nbsp;снимкам Landsat. Код открыт на&nbsp;
        <a href={REPO} target="_blank" rel="noopener">
          GitHub
        </a>
        .
      </p>
      <p>© 2026 UzHa</p>
    </footer>
  );
}

function Page({ cities, route }: { cities: CitySummary[]; route: Route }) {
  const city = cities.find((c) => c.id === route.cityId) ?? cities[0];
  const landingCity = cities[0];
  const subject = route.view === 'story' ? landingCity : city;
  const state = useAsync(() => (subject ? cityModel(subject.id) : Promise.resolve(null)), [subject?.id]);
  const model = state.status === 'ready' ? state.data : null;
  const [found, setFound] = useState<ReadonlySet<number>>(() => new Set());
  const target = useMemo(() => (route.view === 'story' && model ? huntTarget(model.detail) : null), [route.view, model]);

  const ready = state.status === 'ready';
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

  const bar = (
    <Bar
      home={HOME}
      tool={route.view === 'tool' || !subject ? null : toolHref(subject.id)}
      onLanding={route.view === 'story'}
      found={found.size}
      total={target?.total ?? null}
    />
  );

  if (!subject) return <Status>В cities.json нет ни одного города.</Status>;
  if (state.status !== 'ready' || !model) {
    const message =
      state.status === 'loading'
        ? `Считаю изотермы ${genitive(subject.name)}`
        : state.status === 'error'
          ? `Не получилось открыть данные: ${state.message}`
          : `Для ${genitive(subject.name)} данных пока нет.`;
    return (
      <>
        {bar}
        <Status>{message}</Status>
      </>
    );
  }

  return (
    <>
      {bar}
      {route.view === 'tool' && <Tool key={model.detail.city.id} model={model} cities={cities} onCity={(id) => navigate(toolHref(id))} />}
      {route.view === 'method' && <MethodPage model={model} />}
      {route.view === 'story' && target && <Landing cities={cities} model={model} hunt={{ target, found }} onHunt={setFound} />}
      {route.view !== 'tool' && <Footer />}
    </>
  );
}

export function App() {
  const route = useRoute();
  const cities = useAsync(loadCities, []);

  useEffect(() => {
    window.history.scrollRestoration = 'manual';
  }, []);

  if (cities.status !== 'ready') {
    return <Status>{cities.status === 'loading' ? 'Загружаю города' : `Не получилось загрузить список городов: ${cities.message}`}</Status>;
  }
  return (
    <>
      <PatternDefs />
      <Page cities={cities.data} route={route} />
    </>
  );
}
