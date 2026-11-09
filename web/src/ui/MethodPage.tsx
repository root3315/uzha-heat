import type { CityModel } from '../domain/cityModel';
import { formatDeg, formatNumber, plural } from '../domain/format';
import { routeHref } from './routing';

const SOURCE_OF: Record<string, string> = {
  ndvi: 'Sentinel-2 L2A, летняя медиана',
  albedo: 'Sentinel-2, формула Liang (2001)',
  tree: 'ESA WorldCover 2021',
  built: 'ESA WorldCover 2021',
  bare: 'ESA WorldCover 2021',
  water_dist: 'ESA WorldCover и OpenStreetMap',
  roads: 'OpenStreetMap',
  buildings: 'OpenStreetMap',
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
      <p className="method__back">
        <a className="text-link" href={routeHref(city.id)}>
          Вернуться к карте
        </a>
      </p>
      <h1 className="method__title">Как это посчитано</h1>

      <p>
        {city.name} разбит на квадраты {grid.cellSizeM} × {grid.cellSizeM} м, их {formatNumber(grid.count, 0)}. Для каждого есть температура
        поверхности летом ({period.label}, медиана {period.lstScenes} {plural(period.lstScenes, ['снимка', 'снимков', 'снимков'])} Landsat 8/9 без
        облаков) и {n} {plural(n, ['фактор', 'фактора', 'факторов'])}, перечисленных ниже.
      </p>
      <p>
        Модель {fit.type} учится предсказывать температуру квадрата по его факторам. Проверка пространственная: город режется на блоки, и модель
        оценивают на тех, которых она не видела. На такой проверке R² {formatNumber(fit.r2Cv, 2)}, средняя ошибка {formatDeg(fit.maeCv)}.
      </p>
      <p>
        Вклад каждого фактора в градусах считает метод SHAP: от средней оценки по городу, {formatDeg(fit.baseValue)}, до температуры конкретного
        места. Сумма вкладов и есть отличие места от среднего.
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
        <li>Эффект мер взят из опыта других городов. Это ориентир, а не прогноз модели для конкретного участка.</li>
      </ul>
    </main>
  );
}
