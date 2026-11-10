import type { CityModel } from '../domain/cityModel';
import { formatDeg, formatNumber, plural } from '../domain/format';
import { Link } from './Link';
import { toolHref } from './routing';

const SOURCE_OF: Record<string, string> = {
  ndvi: 'Sentinel-2 L2A, летняя медиана',
  albedo: 'Sentinel-2, формула Liang (2001)',
  tree: 'ESA WorldCover 2021',
  built: 'ESA WorldCover 2021',
  bare: 'ESA WorldCover 2021',
  water_dist: 'ESA WorldCover и OpenStreetMap',
  roads: 'OpenStreetMap',
  buildings: 'OpenStreetMap',
  height: 'OpenStreetMap и GHSL Built-H 2018',
  volume: 'GHSL Built-S 2020 и Built-H 2018',
  elevation: 'Copernicus DEM GLO-30',
};

/** How the map was made, in the same plain voice as the map. Every number comes from the city's data. */
export function MethodPage({ model }: { model: CityModel }) {
  const { detail, levels } = model;
  const { grid, period, features, model: fit, city } = detail;
  const n = features.length;
  const step = (levels.thresholds[1] ?? 0) - (levels.thresholds[0] ?? 0);
  return (
    <main className="method">
      <h1 className="method__title">Как это посчитано</h1>
      <p className="method__lead">
        {city.name}. <Link className="text-link" href={toolHref(city.id)}>Вернуться к карте</Link>
      </p>

      <p>
        {city.name} разбит на участки {grid.cellSizeM} × {grid.cellSizeM} м, их {formatNumber(grid.count, 0)}. Для каждого есть температура
        поверхности летом ({period.label}, медиана {period.lstScenes} {plural(period.lstScenes, ['снимка', 'снимков', 'снимков'])} Landsat 8/9 без
        облаков, снимки NASA/USGS) и {n} {plural(n, ['фактор', 'фактора', 'факторов'])}, перечисленных ниже.
      </p>
      <p>
        Модель {fit.type} учится предсказывать температуру участка по его факторам. Проверка пространственная: город режется на блоки, и модель
        оценивают на тех, которых она не видела. На такой проверке R² {formatNumber(fit.r2Cv, 2)}, средняя ошибка {formatDeg(fit.maeCv)}.
      </p>
      <p>
        Вклад каждого фактора в градусах считает метод SHAP: от средней оценки по городу, {formatDeg(fit.baseValue)}, до температуры конкретного
        места. Сумма вкладов и есть отличие места от среднего.
      </p>
      <p>
        Остров тепла считаем так: медиана температуры участков внутри черты города (граница из OpenStreetMap) минус медиана участков в кольце вокруг неё.
        Медиана, а не среднее, чтобы аэродром или водохранилище не сдвигали число.
      </p>
      <p>
        Зелень меряем индексом NDVI по снимкам Sentinel-2: около 0 у асфальта и голой земли, ближе к 1 у густой листвы. Альбедо, доля отражённого света, здесь
        растёт вместе с жарой: светлее всего голая сухая земля, она же и горячее всего. Поэтому альбедо мы читаем как признак открытого грунта, а не как то, что
        стоит менять.
      </p>
      <p>
        Изотермы проведены по сглаженной поверхности через {formatNumber(step, 0)}°. Штриховка в разрезе и на карте показывает фактор, который
        сильнее всего меняет температуру на этом отрезке.
      </p>

      <h2 className="method__subtitle">Факторы</h2>
      <dl className="method__factors">
        {features.map((feature) => (
          <div key={feature.key}>
            <dt>{feature.label}</dt>
            <dd>{[feature.unit, SOURCE_OF[feature.key]].filter(Boolean).join(', ')}</dd>
          </div>
        ))}
      </dl>

      <h2 className="method__subtitle">Чего карта не знает</h2>
      <ul className="method__limits">
        <li>Это температура поверхности, а не воздуха. Днём она выше и меняется резче.</li>
        <li>Landsat снимает около 11 утра. Вечерний и ночной перегрев здесь не виден.</li>
        <li>Вклад фактора показывает связь в данных, а не эксперимент. Факторы связаны между собой: где мало зелени, там обычно плотнее застройка.</li>
        <li>Что дают меры, известно из обзоров по другим городам, ссылки у каждой меры. Там речь чаще о воздухе, а не о поверхности, это ориентир, а не прогноз для участка.</li>
        <li>Аэродромы и железнодорожные пути горячие из-за покрытия; там карта не советует деревья.</li>
      </ul>
    </main>
  );
}
